const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {setTimeout: wait} = require('node:timers/promises');
const {createReaderResponse} = require('../lib/reader-stream');
const {generateReaderAnalysis} = require('../lib/reader-response');
const html = fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'), 'utf8');
const context = vm.createContext({TextDecoder});
vm.runInContext(html.slice(html.indexOf('        function readerServiceError'),
    html.indexOf('        document.querySelectorAll(\'input[name="vocab-mode-a"]\')')), context);
const read = context.readApiResponse;
const frame = event => 'data: ' + JSON.stringify(event) + '\n\n';
function response() {
    return Object.assign(new EventEmitter(), {
        chunks: [], headers: {}, status(code) {this.code = code; return this;},
        setHeader(name, value) {this.headers[name] = value;}, flushHeaders() {this.flushed = true;},
        write(chunk) {this.chunks.push(chunk);}, end(chunk) {this.write(chunk); this.finished = true;},
        json(body) {this.body = body; return this;}
    });
}
const headers = {'content-type': 'text/event-stream; charset=utf-8'};

test('progress and heartbeats arrive before the checked result; timers stop on completion', async () => {
    const res = response(), output = createReaderResponse({headers: {accept: 'text/event-stream'}}, res, {heartbeatMs: 5});
    try {
        output.progress('generation');
        assert.equal(res.code, 200); assert.equal(res.flushed, true);
        assert.match(res.headers['Cache-Control'], /no-store, no-transform/);
        assert.match(res.chunks[0], /"type":"progress"/);
        await wait(20);
        assert.ok(res.chunks.some(chunk => chunk === ': keep-alive\n\n'));
        assert.ok(!res.chunks.join('').includes('"type":"result"'));
        output.progress('analysis-repair');
        output.send(200, {text: 'כותרת\nספר'});
        const count = res.chunks.length;
        await wait(20);
        assert.equal(res.chunks.length, count);
        assert.equal(res.listenerCount('close'), 0);
        assert.equal(output.signal.aborted, false);
        assert.equal((await read(new Response(res.chunks.join(''), {headers}))).text, 'כותרת\nספר');
    } finally {output.dispose();}
});

test('a disconnected browser cancels provider work and stops heartbeats or late output', async () => {
    const res = response(), output = createReaderResponse({headers: {accept: 'text/event-stream'}}, res, {heartbeatMs: 5});
    try {
        output.progress('generation'); res.emit('close');
        const count = res.chunks.length;
        assert.equal(output.signal.aborted, true);
        output.progress('dicta'); output.send(200, {text: 'Late'});
        await wait(20);
        assert.equal(res.chunks.length, count);
    } finally {output.dispose();}
});

test('legacy requests retain JSON and HTTP errors; streamed failures remain specific errors', async () => {
    for (const accept of [undefined, 'application/json', 'text/event-stream']) {
        const res = response(), output = createReaderResponse({headers: {accept}}, res);
        output.progress('dicta'); output.send(503, {error: 'The Hebrew vowel service took too long. Please try again.'});
        output.dispose();
        if (accept === 'text/event-stream') {
            assert.equal(res.code, 200);
            await assert.rejects(read(new Response(res.chunks.join(''), {headers})), /Hebrew vowel service took too long/);
        } else {
            assert.equal(res.code, 503); assert.equal(res.chunks.length, 0);
            assert.equal(output.signal, undefined);
            assert.match(res.body.error, /Hebrew vowel service/);
        }
    }
});

test('stream parsing handles split UTF-8, split records, comments, and progress without returning partial text', async () => {
    let streamController;
    const stream = new ReadableStream({start(controller) {streamController = controller;}});
    const stages = [], encoder = new TextEncoder(); let finished = false;
    const pending = read(new Response(stream, {headers}), 'reading', stage => stages.push(stage)).then(result => {finished = true; return result;});
    const data = ': keep-alive\n\n' + frame({type: 'progress', stage: 'analysis-repair'}).replaceAll('\n', '\r\n');
    for (const byte of encoder.encode(data)) streamController.enqueue(Uint8Array.of(byte));
    await wait(0);
    assert.equal(finished, false); assert.deepEqual(stages, ['analysis-repair']);
    const result = {text: 'סֵפֶר\nהַיֶּלֶד קוֹרֵא.'};
    for (const byte of encoder.encode(frame({type: 'result', status: 200, data: result}))) streamController.enqueue(Uint8Array.of(byte));
    assert.equal((await pending).text, result.text);
});

test('truncated or malformed streams never become a reading, including silent EOF after progress', async () => {
    for (const body of ['', ': keep-alive\n\n', frame({type: 'progress', stage: 'dicta'}),
        'data: {bad}\n\n', frame({type: 'unexpected'}), 'data: {"type":"result"']) {
        await assert.rejects(read(new Response(body, {headers})), /connection ended before the result arrived/);
    }
    await assert.rejects(read(new Response(frame({type: 'result', status: 503, data: {text: 'Incomplete'}}), {headers})), /HTTP 503/);
    const aborted = Object.assign(new Error('Cancelled'), {name: 'AbortError'});
    const stream = new ReadableStream({start(controller) {controller.error(aborted);}});
    await assert.rejects(read(new Response(stream, {headers})), error => error === aborted);
});

test('Reader records repair versus service retry without logging input or changing the two-call policy', async () => {
    const profile = {mode: 'complete', words: ['ספר'], verbs: [], nouns: [], adjs: [], forms: []};
    const data = {text: 'כותרת\nספר', words: ['כותרת', 'ספר'].map(word => ({word, mastered: false, translation: 'meaning', match: '', form: ''})), phrases: []};
    for (const retry of [false, true]) {
        const reports = [], stages = [], signal = new AbortController().signal; let calls = 0, clock = 0;
        const result = await generateReaderAnalysis('private topic', profile, undefined, async (_, options) => {
            assert.equal(options.timeoutMs, 110000); assert.equal(options.maxAttempts, 1);
            assert.equal(options.signal, signal);
            clock += ++calls === 1 ? 90000 : 86000;
            if (calls === 1) {
                if (retry) throw Object.assign(new Error('private provider body'), {retryable: true, code: 'OPENAI_NETWORK'});
                return JSON.stringify({...data, words: []});
            }
            return JSON.stringify(data);
        }, undefined, {signal, now: () => clock, onStage: stage => stages.push(stage), onGeneration: report => reports.push(report)});
        assert.equal(calls, 2); assert.equal(result.words.length, 2);
        assert.deepEqual(reports.map(report => report.stage), ['generation', retry ? 'generation-retry' : 'analysis-repair']);
        assert.deepEqual(reports.map(report => report.durationMs), [90000, 86000]);
        assert.ok(stages.includes('analysis-validation'));
        assert.doesNotMatch(JSON.stringify(reports), /private|ספר|כותרת|meaning/);
    }
});

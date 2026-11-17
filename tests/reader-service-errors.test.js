const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'), 'utf8');
const context = vm.createContext({TextDecoder});
vm.runInContext(html.slice(html.indexOf('        function readerServiceError'),
    html.indexOf('        document.querySelectorAll(\'input[name="vocab-mode-a"]\')')), context);
const readApiResponse = context.readApiResponse;

test('Reader identifies non-JSON gateway, timeout, access and service responses', async () => {
    for (const [status, message] of [
        [502, /gateway error \(HTTP 502\)/], [408, /timed out.*HTTP 408/],
        [504, /timed out.*HTTP 504/], [503, /temporarily unavailable.*HTTP 503/],
        [524, /timed out.*HTTP 524/],
        [429, /temporarily unavailable.*HTTP 429/], [500, /unreadable response.*HTTP 500/],
        [401, /sign-in has expired/], [403, /account cannot access/]
    ]) {
        await assert.rejects(readApiResponse(new Response('<html>Gateway error</html>', {status})), message);
    }
    await assert.rejects(readApiResponse(new Response('<html>Bad Gateway</html>', {status: 502}), 'worksheet'),
        /worksheet server returned a gateway error/);
});

test('Reader preserves specific JSON errors, rejects malformed successes and retains valid output', async () => {
    const failure = {error: 'The Hebrew vowel service is temporarily unavailable. Please try again.'};
    await assert.rejects(readApiResponse(Response.json(failure, {status: 503})), {message: failure.error});
    for (const value of [null, [], 'text', 12, {}, {text: ''}, {text: ' '}, {error: {detail: 'secret'}}]) {
        await assert.rejects(readApiResponse(Response.json(value)), /unreadable response \(HTTP 200\)/);
    }
    await assert.rejects(readApiResponse(Response.json({text: 'Partial result'}, {status: 503})), /HTTP 503/);
    const result = {text: 'ספר\nהילד קורא ספר', readerResult: {words: [], notes: []}};
    assert.deepEqual(await readApiResponse(Response.json(result)), result);
});

test('Reader preserves cancellation during response parsing for stale worksheets', async () => {
    const error = Object.assign(new Error('Cancelled'), {name: 'AbortError'});
    await assert.rejects(readApiResponse({status: 200, json: async () => {throw error;}}, 'worksheet'),
        caught => caught === error);
});

function handler(fetchImpl, generate = async () => 'ספר\nהילד קורא ספר') {
    const logs = [], requests = [];
    const context = vm.createContext({
        module: {exports: {}}, process: {env: {DICTA_API_KEY: 'test-secret-key'}}, AbortSignal,
        console: {error: (...args) => logs.push(args)},
        require(name) {
            if (name === '../lib/openai-text') return {generateOpenAIText: generate};
            if (name === '../lib/reader-response') return require('../lib/reader-response');
            if (name === '../lib/reader-stream') return require('../lib/reader-stream');
            if (name === '../lib/dicta-nikkud') return require('../lib/dicta-nikkud');
            throw new Error(name);
        },
        fetch: async (url, options) => {requests.push({url, options}); return fetchImpl(url, options);}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../api/generate'), 'utf8'), context);
    return {logs, requests, async run(body = {prompt: 'Write a story about a private topic'}) {
        const res = {status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
        await context.module.exports({method: 'POST', body}, res);
        return res;
    }};
}

test('Dicta HTTP failures stay JSON application errors with private diagnostics', async () => {
    for (const status of [401, 429, 500, 502, 503, 504]) {
        const h = handler(async () => new Response('<html>secret provider error</html>', {status}));
        const res = await h.run();
        assert.equal(res.code, 503);
        assert.match(res.body.error, /Hebrew vowel service is temporarily unavailable/);
        assert.equal(res.body.text, undefined);
        assert.equal(h.requests.length, 1);
        assert.equal(h.logs[0][1].stage, 'dicta');
        assert.equal(h.logs[0][1].code, 'DICTA_HTTP');
        assert.equal(h.logs[0][1].upstreamStatus, status);
        assert.equal(typeof h.logs[0][1].durationMs, 'number');
        assert.doesNotMatch(JSON.stringify([h.logs, res.body]), /secret|private topic|ספר/);
        await assert.rejects(readApiResponse(Response.json(res.body, {status: res.code})), {message: res.body.error});
    }
});

test('Dicta network, body parsing and timeout errors do not expose raw provider details', async () => {
    for (const [fetchImpl, code, message] of [
        [async () => {throw new Error('secret connection details');}, 'DICTA_NETWORK', /temporarily unavailable/],
        [async () => {throw Object.assign(new Error('secret timeout details'), {name: 'TimeoutError'});}, 'DICTA_TIMEOUT', /took too long/],
        [async () => new Response('<html>secret provider response</html>'), 'DICTA_RESPONSE', /unreadable response/],
        [async () => ({ok: true, json: async () => {throw Object.assign(new Error('secret body timeout'), {name: 'AbortError'});}}), 'DICTA_TIMEOUT', /took too long/]
    ]) {
        const h = handler(fetchImpl), res = await h.run();
        assert.equal(res.code, 503);
        assert.match(res.body.error, message);
        assert.equal(h.logs[0][1].stage, 'dicta');
        assert.equal(h.logs[0][1].code, code);
        assert.doesNotMatch(JSON.stringify([h.logs, res.body]), /secret|private topic|ספר/);
    }
});

test('AI failures stop before Dicta and keep their own failure stage', async () => {
    const h = handler(() => assert.fail('Dicta must not run'), async () => {
        throw Object.assign(new Error('AI generation took too long. Please try again.'), {code: 'OPENAI_TIMEOUT'});
    });
    const res = await h.run();
    assert.equal(res.code, 500);
    assert.match(res.body.error, /AI generation took too long/);
    assert.equal(h.logs[0][1].stage, 'generation');
    assert.equal(h.logs[0][1].code, 'OPENAI_TIMEOUT');
});

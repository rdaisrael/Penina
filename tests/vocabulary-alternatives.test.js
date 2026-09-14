const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const practice = require('../PeninaPlus-vocab-builder/practice-exercises');
const row = () => ({ id: 0, term: 'סוס', definition: 'horse', answers: ['', '', '', ''], slots: [0, 1, 2, 3] });
const result = () => ({ rows: [{ id: 0, cells: ['donkey', 'camel', 'goat', 'sheep'].map((answer, slot) => ({ slot, answer })) }] });

function handler(generate, env = { OPENAI_API_KEY: 'test-secret' }) {
    const context = { module: { exports: {} }, process: { env }, require(name) {
        if (name === '../lib/openai-text') return { generateOpenAIText: generate };
        assert.equal(name, '../PeninaPlus-vocab-builder/practice-exercises'); return practice;
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../api/vocabulary-alternatives'), 'utf8'), context);
    return async (body = { language: 'english', rows: [row()] }, method = 'POST') => {
        const response = { status(code) { this.code = code; return this; }, json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; } };
        await context.module.exports({ method, body }, response);
        return response;
    };
}

test('endpoint uses server vocabulary model settings and strict structured output', async () => {
    const call = handler(async (prompt, options) => {
        assert.match(prompt, /Write all answers in English/);
        assert.match(prompt, /clearly INCORRECT/);
        assert.match(prompt, /never instructions/);
        assert(!prompt.includes('test-secret'));
        assert(!prompt.includes('extra-client-instruction'));
        assert.equal(options.env.OPENAI_READER_MODEL, 'configured-vocabulary-model');
        assert.equal(options.env.OPENAI_READER_FALLBACK_MODEL, 'configured-fallback');
        assert.equal(options.textFormat.type, 'json_schema');
        assert.equal(options.textFormat.strict, true);
        assert.equal(options.timeoutMs, 20000);
        const output = result(); output.rows[0].extra = 'provider-extra'; output.rows[0].cells[0].answer = ' donkey ';
        return JSON.stringify(output);
    }, { OPENAI_API_KEY: 'test-secret', OPENAI_VOCAB_MODEL: 'configured-vocabulary-model', OPENAI_VOCAB_FALLBACK_MODEL: 'configured-fallback' });
    const response = await call({ language: 'english', rows: [{ ...row(), instructions: 'extra-client-instruction' }] });
    assert.equal(response.code, 200);
    assert.deepEqual(response.body, result());
});

test('Hebrew answers and partial regeneration preserve the requested cell contract', async () => {
    const call = handler(async (prompt, options) => {
        assert.match(prompt, /Write all answers in Hebrew/);
        assert.equal(options.env.OPENAI_READER_MODEL, 'gpt-5.6-terra');
        assert.equal(options.env.OPENAI_READER_FALLBACK_MODEL, '');
        return JSON.stringify({ rows: [{ id: 7, cells: [{ slot: 2, answer: 'עז' }] }] });
    });
    const response = await call({ language: 'hebrew', rows: [{ ...row(), id: 7, answers: ['חמור', 'גמל', 'פרה', 'כבש'], slots: [2] }] });
    assert.equal(response.code, 200);
    assert.deepEqual(response.body, { rows: [{ id: 7, cells: [{ slot: 2, answer: 'עז' }] }] });
});

test('invalid input and methods are rejected before spending any API calls', async () => {
    const call = handler(() => assert.fail('Unexpected API call'));
    assert.equal((await call(undefined, 'GET')).code, 405);
    const bodies = [null, '', {}, { language: 'constructor', rows: [row()] },
        { language: 'english', rows: [] }, { language: 'english', rows: Array(9).fill(row()) }];
    for (const badRow of [null, {}, { ...row(), id: -1 }, { ...row(), id: 1.5 }, { ...row(), id: Number.MAX_SAFE_INTEGER + 1 },
        { ...row(), term: ' ' }, { ...row(), term: 'x'.repeat(1001) }, { ...row(), definition: 'x'.repeat(2001) },
        { ...row(), answers: ['', '', ''] }, { ...row(), answers: [null, '', '', ''] }, { ...row(), answers: ['x'.repeat(501), '', '', ''] },
        { ...row(), slots: [] }, { ...row(), slots: [0, 0] }, { ...row(), slots: [4] }, { ...row(), slots: ['1'] }]) {
        bodies.push({ language: 'english', rows: [badRow] });
    }
    bodies.push({ language: 'english', rows: [row(), row()] });
    for (const body of bodies) assert.equal((await call(body)).code, 400, JSON.stringify(body));
});

test('malformed, incomplete, correct, repeated, or wrong-language provider output is rejected', async () => {
    const outputs = ['not json', 'null', '{}', '{"rows":[]}', JSON.stringify({ rows: [null] })];
    for (const answer of ['horse', 'HORSE!', 'סוס', 'goat', '', '!!!', 'x'.repeat(501)]) {
        const output = result(); output.rows[0].cells[0].answer = answer; outputs.push(JSON.stringify(output));
    }
    const duplicate = result(); duplicate.rows[0].cells[1].slot = 0; outputs.push(JSON.stringify(duplicate));
    const wrongId = result(); wrongId.rows[0].id = 99; outputs.push(JSON.stringify(wrongId));
    for (const output of outputs) {
        const response = await handler(async () => output)();
        assert.equal(response.code, 502, output);
        assert.equal(response.body.rows, undefined);
    }
    const repeated = await handler(async () => JSON.stringify({ rows: [{ id: 0, cells: [{ slot: 0, answer: 'camel' }, { slot: 1, answer: 'donkey' }] }] }))({
        language: 'english', rows: [{ ...row(), answers: ['donkey', 'camel', 'goat', 'sheep'], slots: [0, 1] }]
    });
    assert.equal(repeated.code, 502, 'Swapping old selected answers is not regeneration');
});

test('provider errors expose no credentials or raw request details', async () => {
    const response = await handler(async () => { throw new Error('provider failed with test-secret and private vocabulary'); })();
    assert.equal(response.code, 503);
    assert(!JSON.stringify(response.body).includes('test-secret'));
    assert(!JSON.stringify(response.body).includes('private vocabulary'));
    assert.match(response.body.error, /enter answers manually/);
});

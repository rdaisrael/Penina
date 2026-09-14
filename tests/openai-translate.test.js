const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function handler(generate, env = { OPENAI_API_KEY: 'test-only' }) {
    const context = vm.createContext({ module: { exports: {} }, process: { env }, console: { error() {} },
        require(name) { assert.equal(name, '../lib/openai-text'); return { generateOpenAIText: generate }; }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../api/translate'), 'utf8'), context);
    return async body => {
        let status, result;
        await context.module.exports({ method: 'POST', body }, {
            status(code) { status = code; return this; }, json(data) { result = JSON.parse(JSON.stringify(data)); }
        });
        return { status, result };
    };
}
test('vocabulary keeps single-response contract and uses its own model settings', async () => {
    const call = handler(async (prompt, options) => {
        assert.equal(prompt, 'translate שלום');
        assert.equal(options.env.OPENAI_READER_MODEL, 'gpt-5.6-terra');
        assert.equal(options.env.OPENAI_READER_FALLBACK_MODEL, '');
        assert.equal(options.timeoutMs, 20000);
        return 'hello';
    });
    assert.deepEqual(await call({ promptText: ' translate שלום ' }), { status: 200, result: { text: 'hello' } });
});
test('batches preserve order, concurrency limit, and partial failures', async () => {
    let active = 0, peak = 0;
    const call = handler(async prompt => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, prompt === 'one' ? 10 : 1));
        active--;
        if (prompt === 'bad') throw new Error('request failed');
        return prompt.toUpperCase();
    }, { OPENAI_API_KEY: 'test-only', OPENAI_BATCH_CONCURRENCY: '2' });
    const { status, result } = await call({ prompts: ['one', 'two', 'bad', ''] });
    assert.equal(status, 200); assert.equal(peak, 2);
    assert.deepEqual(result.results.map(item => item.text), ['ONE', 'TWO', '', '']);
    assert.equal(result.okCount, 2); assert.equal(result.failCount, 2);
    assert.equal(result.firstError, 'request failed');
});
test('missing credentials and oversized batches do not call OpenAI', async () => {
    const noNetwork = () => assert.fail('Unexpected API call');
    assert.equal((await handler(noNetwork, {})({ promptText: 'hello' })).status, 500);
    assert.equal((await handler(noNetwork)({ prompts: Array(151).fill('hello') })).status, 413);
    assert.equal((await handler(noNetwork)({})).status, 400);
});

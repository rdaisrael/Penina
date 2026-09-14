const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { generateOpenAIText, readResponse } = require('../lib/openai-text');
const completed = text => ({ status: 'completed', output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
] });
const ok = text => ({ ok: true, json: async () => completed(text) });
const env = { OPENAI_API_KEY: 'test-only' };
const wait = async () => {};

test('Responses request keeps prompt, privacy setting, and extracts text after reasoning', async () => {
    const text = await generateOpenAIText('כתוב סיפור', { env, wait, fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer test-only');
        const body = JSON.parse(options.body);
        assert.equal(body.input, 'כתוב סיפור');
        assert.equal(body.model, 'gpt-5.6-terra');
        assert.equal(body.store, false);
        assert.equal(body.reasoning.effort, 'low');
        return ok('ילד קורא');
    } });
    assert.equal(text, 'ילד קורא');
});

test('transient failures retry primary then use stronger fallback', async () => {
    const models = [];
    const text = await generateOpenAIText('story', { env, wait, fetchImpl: async (_, options) => {
        models.push(JSON.parse(options.body).model);
        return models.length < 3 ? { ok: false, status: 503, json: async () => ({}) } : ok('story');
    } });
    assert.equal(text, 'story');
    assert.deepEqual(models, ['gpt-5.6-terra', 'gpt-5.6-terra', 'gpt-6-astra']);
});

for (const [status, code] of [[401, 'invalid_api_key'], [403, 'access_denied'], [429, 'insufficient_quota'], [400, 'invalid_request_error'], [404, 'model_not_found']]) {
    test(`HTTP ${status} ${code} does not retry or leak provider details`, async () => {
        let calls = 0;
        await assert.rejects(generateOpenAIText('story', { env, wait, fetchImpl: async () => {
            calls++;
            return { ok: false, status, json: async () => ({ error: { code, message: 'SECRET provider details' } }) };
        } }), error => !error.message.includes('SECRET'));
        assert.equal(calls, 1);
    });
}

test('partial output and refusal are rejected, even when text is present', () => {
    assert.throws(() => readResponse({ ...completed('partial'), status: 'incomplete' }), /did not complete/);
    const data = completed('some text');
    data.output[1].content.push({ type: 'refusal', refusal: 'refused' });
    assert.throws(() => readResponse(data), /could not fulfill/);
});

test('timeouts abort requests and exhaust only the configured attempts', async () => {
    let calls = 0;
    await assert.rejects(generateOpenAIText('story', { env: { ...env, OPENAI_READER_FALLBACK_MODEL: '' }, wait, timeoutMs: 5,
        fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
            calls++;
            signal.addEventListener('abort', () => reject(new Error('abort')));
        })
    }), /temporarily unavailable/);
    assert.equal(calls, 2);
});

test('missing API key fails without making a request', async () => {
    await assert.rejects(generateOpenAIText('story', { env: {}, fetchImpl: () => assert.fail('network called') }), /Missing OPENAI_API_KEY/);
});

test('reader passes generated text to Dicta and stops on generation failure', async () => {
    const dicta = require('../lib/dicta-nikkud');
    for (const fail of [false, true]) {
        let calls = 0;
        const context = vm.createContext({AbortSignal,
            module: { exports: {} }, process: { env: { DICTA_API_KEY: 'test-only' } },
            require(name) {
                if (name === '../lib/reader-response') return require('../lib/reader-response');
            if (name === '../lib/dicta-nikkud') return dicta;
                if (name === '../lib/openai-text') return { generateOpenAIText: async prompt => {
                    assert.equal(prompt, 'write story');
                    if (fail) throw new Error('generation failed');
                    return 'כל ילד';
                } };
                throw new Error(name);
            },
            fetch: async (_, options) => {
                calls++;
                const body = JSON.parse(options.body);
                assert.equal(body.data, 'כל ילד');
                assert.equal(body.keepqq, true);
                return { ok: true, json: async () => ({ data: [{ str: 'כל', nakdan: { options: [{ w: 'כׇּל' }] } }] }) };
            }
        });
        vm.runInContext(fs.readFileSync(require.resolve('../api/generate'), 'utf8'), context);
        let status;
        const res = { status(value) { status = value; return this; }, json() {} };
        await context.module.exports({ method: 'POST', body: { prompt: 'write story', dictaOptions: { keepqq: true } } }, res);
        assert.equal(calls, fail ? 0 : 1);
        assert.equal(status, fail ? 500 : 200);
    }
});

test('structured reader schema is sent through Responses text.format', async () => {
    const {readerFormat}=require('../lib/reader-response');
    await generateOpenAIText('Analyze words', {env,wait,textFormat:readerFormat,maxOutputTokens:32000,fetchImpl:async (_,options)=>{
        const body=JSON.parse(options.body);
        assert.deepEqual(body.text.format,readerFormat);
        assert.equal(body.max_output_tokens,32000);
        return ok('{"text":"test","words":[]}');
    }});
});

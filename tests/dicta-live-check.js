// Run with DICTA_API_KEY securely supplied in the environment. Never prints the key.
// DICTA_TEST_ENDPOINT can select Dicta's public service for a separate compatibility check.
const assert = require('node:assert/strict');
const { createDictaRequest, readDictaResponse } = require('../lib/dicta-nikkud');

async function main() {
    const endpoint = process.env.DICTA_TEST_ENDPOINT || 'https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud';
    if (!process.env.DICTA_API_KEY && endpoint.endsWith('/addnikud')) {
        throw new Error('Set DICTA_API_KEY in the environment to test the production endpoint.');
    }
    const text = 'כל ילד לומד חכמה. הילדה חכמה מאוד. הָֽאִישׁ קורא ספר.';
    const outputs = [];
    for (const enabled of [false, true]) {
        const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify(createDictaRequest({
                text, apiKey: process.env.DICTA_API_KEY, genre: 'modern',
                options: { keepqq: enabled, addmorph: enabled,
                    nodageshdefmem: false, patachma: false }
            }))
        });
        if (!response.ok) throw new Error(`Dicta returned HTTP ${response.status}.`);
        const result = readDictaResponse(await response.json(), { includeAnalysis: enabled });
        outputs.push(result);
        console.log(enabled ? 'Options enabled:' : 'Options disabled:', result.text);
    }
    assert.ok(!outputs[0].text.includes('\u05c7'), 'Baseline should use ordinary kamatz.');
    assert.ok(outputs[1].text.includes('\u05c7'), 'Native kamatz katan is missing.');
    assert.ok(outputs[1].text.includes('חֲכָמָה'), 'Ordinary kamatz must remain in the adjective.');
    assert.ok(outputs[1].text.includes('הָאִישׁ'), 'Existing supplied vowel pointing was changed.');
    console.log('Supplied meteg preserved:', outputs[1].text.includes('\u05bd'));
    // keepmetagim does not guarantee preservation of an arbitrary user-supplied meteg.
    assert.ok(outputs[1].dictaTokens.some(t => t.nakdan?.options?.some(o => o.lex && o.morph)),
        'Lexical and morphological analysis is missing.');
    console.log('PASS: native kamatz katan, preserved ordinary kamatz/partial pointing, and morphology.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

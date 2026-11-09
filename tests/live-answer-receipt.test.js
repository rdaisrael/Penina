const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/live-harness');

async function setup(database, options = {}) {
    const h = harness({ database });
    const { code, hostToken } = (await h.create(options)).body;
    const studentToken = (await h.join(code)).body.studentToken;
    assert.equal((await h.request('start', { code, version: 0 }, hostToken)).code, 200);
    return { h, code, hostToken, studentToken };
}

for (const database of [false, true]) {
    const store = database ? 'database' : 'Blob';

    test(`${store}: answer receipt confirms the saved choice without revealing correctness or scores`, async () => {
        const { h, code, studentToken } = await setup(database);
        const response = await h.request('answer', { code, index: 0, choice: 2, version: 0 }, studentToken);
        assert.equal(response.code, 200);
        assert.deepEqual(response.body, { saved: true, round: 0, index: 0, choice: 2 });
        const view = (await h.request(null, { code }, studentToken)).body;
        assert.equal(view.me.choice, response.body.choice);
        assert.equal(view.me.score, 0);
        assert.equal(view.question.correct, undefined);
    });

    test(`${store}: identical and conflicting retries confirm the first answer without another write`, async () => {
        const { h, code, studentToken } = await setup(database);
        const first = await h.request('answer', { code, index: 0, choice: 1 }, studentToken);
        const writes = { ...h.operations };
        for (const choice of [1, 3, 0]) {
            const repeat = await h.request('answer', { code, index: 0, choice }, studentToken);
            assert.equal(repeat.code, 200);
            assert.deepEqual(repeat.body, first.body);
        }
        assert.equal(h.operations.writes, writes.writes);
        assert.equal(h.operations.dbWrites, writes.dbWrites);
    });

    test(`${store}: racing conflicting answers receive the same authoritative receipt`, async () => {
        const { h, code, studentToken } = await setup(database);
        const writesBefore = database ? h.operations.dbWrites : h.operations.writes;
        const responses = await Promise.all([0, 3].map(choice =>
            h.request('answer', { code, index: 0, choice }, studentToken)));
        assert(responses.every(response => response.code === 200));
        const writesAfter = database ? h.operations.dbWrites : h.operations.writes;
        assert.equal(writesAfter - writesBefore, 2, 'Both requests attempted the immutable write');
        const view = (await h.request(null, { code }, studentToken)).body;
        const receipt = { saved: true, round: 0, index: 0, choice: view.me.choice };
        responses.forEach(response => assert.deepEqual(response.body, receipt));
        assert.equal(view.answeredCount, 1);
    });

    test(`${store}: replay receipts identify the new round and reject old-round submissions`, async () => {
        const { h, code, hostToken, studentToken } = await setup(database);
        const previous = await h.request('answer', { code, index: 0, choice: 0 }, studentToken);
        assert.equal(previous.body.round, 0);
        await h.request('end', { code, version: 1 }, hostToken);
        await h.request('restart', { code, version: 2 }, hostToken);
        await h.request('start', { code, version: 3 }, hostToken);
        const stale = await h.request('answer', { code, index: 0, round: 0, choice: 1 }, studentToken);
        assert.equal(stale.code, 409);
        assert.equal(stale.body.saved, undefined);
        const current = await h.request('answer', { code, index: 0, round: 1, choice: 2 }, studentToken);
        assert.deepEqual(current.body, { saved: true, round: 1, index: 0, choice: 2 });
        const repeat = await h.request('answer', { code, index: 0, round: 1, choice: 0 }, studentToken);
        assert.deepEqual(repeat.body, current.body);
    });

    test(`${store}: invalid, paused, revealed and expired submissions never receive a saved receipt`, async () => {
        const { h, code, hostToken, studentToken } = await setup(database, { seconds: 5 });
        for (const extra of [{ index: 1 }, { round: 1 }, { choice: -1 }, { choice: 4 }, { choice: '1' }]) {
            const response = await h.request('answer', { code, index: 0, choice: 1, ...extra }, studentToken);
            assert.equal(response.code, 409);
            assert.equal(response.body.saved, undefined);
        }
        assert.equal((await h.request('answer', { code, index: 0, choice: 1 }, hostToken)).code, 403);
        await h.request('pause', { code, version: 1 }, hostToken);
        assert.equal((await h.request('answer', { code, index: 0, choice: 1 }, studentToken)).code, 409);
        await h.request('resume', { code, version: 2 }, hostToken);
        const saved = await h.request('answer', { code, index: 0, choice: 1 }, studentToken);
        assert.equal(saved.body.saved, true);
        h.advance(5000);
        const expired = await h.request('answer', { code, index: 0, choice: 1 }, studentToken);
        assert.equal(expired.code, 409);
        assert.equal(expired.body.saved, undefined);
        const view = (await h.request(null, { code }, studentToken)).body;
        assert.equal(view.phase, 'reveal');
        const revealed = await h.request('answer', { code, index: 0, choice: 2 }, studentToken);
        assert.equal(revealed.code, 409);
        assert.equal(revealed.body.saved, undefined);
    });

    test(`${store}: failed storage writes cannot produce a saved receipt`, async () => {
        const { h, code, studentToken } = await setup(database);
        const set = h.storage.set.bind(h.storage);
        h.storage.set = (path, value) => {
            if (path.includes('/answers/')) throw new Error('Simulated storage failure');
            return set(path, value);
        };
        const response = await h.request('answer', { code, index: 0, choice: 1 }, studentToken);
        assert.equal(response.code, 503);
        assert.equal(response.body.saved, undefined);
        const view = (await h.request(null, { code }, studentToken)).body;
        assert.equal(view.me.choice, null);
    });
}

test('A database conflict without a readable winning record is not acknowledged as saved', async () => {
    const { h, code, studentToken } = await setup(true);
    const has = h.storage.has.bind(h.storage);
    h.storage.has = path => path.includes('/answers/') || has(path);
    const response = await h.request('answer', { code, index: 0, choice: 2 }, studentToken);
    assert.equal(response.code, 503);
    assert.equal(response.body.saved, undefined);
    assert.match(response.body.error, /could not be confirmed/);
});

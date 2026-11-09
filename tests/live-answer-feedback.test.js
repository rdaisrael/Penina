const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/flash-cards/live/live.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function question(overrides = {}) {
    return {
        code: '123456', phase: 'question', round: 1, index: 1, version: 2,
        serverNow: Date.now(), className: 'Demo', playerCount: 20, answeredCount: 0,
        total: 5, paused: false, deadline: null,
        question: { term: 'בית', options: ['House', 'Water', 'Book', 'Light'] },
        me: { name: 'AB', avatar: 1, score: 0, choice: null },
        lastReveal: { phase: 'reveal', round: 1, index: 0, version: 1, serverNow: Date.now() },
        ...overrides
    };
}

// Run the complete student client, with only DOM rendering, timers, and network
// replaced. In particular, do not stub act(), request(), present(), or draw().
function setup({ hidden = true } = {}) {
    let markup = '', timerId = 0;
    const requests = [], listeners = {}, timers = new Map();
    const count = { textContent: '' }, error = {}, connection = {};
    const stage = {
        set innerHTML(value) { markup = value; },
        get innerHTML() { return markup; },
        querySelector(selector) { return selector === '[data-answered-count]' ? count : null; },
        querySelectorAll() { return []; },
        addEventListener(event, handler) { listeners[event] = handler; }
    };
    const document = {
        hidden,
        createElement: () => ({}), head: { append() {} },
        getElementById: id => id === 'stage' ? stage : id === 'error' ? error : connection,
        addEventListener() {}
    };
    const context = {
        URLSearchParams, URL, AbortController, location: { search: '?code=123456' },
        document, window: { matchMedia: () => ({ matches: true }), addEventListener() {} },
        setInterval() {},
        setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch(url, options) {
            return new Promise((resolve, reject) => {
                const entry = {
                    url, method: options.method, body: options.body ? JSON.parse(options.body) : null,
                    respond(body, status = 200) { resolve({ ok: status < 400, status, json: async () => body }); },
                    reject
                };
                requests.push(entry);
            });
        }
    };
    vm.runInNewContext(source.slice(0, source.indexOf(" auth=stored(storageKey())")) +
        " auth='test-student-token'; globalThis.client={present,act,poll,getSnapshot:()=>snapshot};})();", context);
    const button = choice => ({ disabled: false, dataset: { choice: String(choice) }, hasAttribute: () => false });
    const click = node => listeners.click({ pointerType: 'mouse', target: { closest: () => node } });
    return {
        client: context.client, requests, listeners, document, error, timers, button, click,
        get markup() { return markup; },
        get posts() { return requests.filter(request => request.method === 'POST'); },
        answerTag(choice) {
            const tag = markup.match(new RegExp('<button[^>]*data-choice="' + choice + '"[^>]*>'));
            assert(tag, 'Expected answer button ' + choice);
            return tag[0];
        }
    };
}

function selected(h, choice) {
    assert.match(h.answerTag(choice), /class="[^"]*\bselected\b/);
    assert.match(h.answerTag(choice), /aria-pressed="true"/);
}

function locked(h) {
    for (let choice = 0; choice < 4; choice++) assert.match(h.answerTag(choice), /\bdisabled\b/);
}

test('Live shows the selected answer and sending feedback on the first click, before any response', async () => {
    const h = setup(), data = question();
    h.client.present(data);
    const action = h.click(h.button(1));
    assert.equal(h.posts.length, 1);
    selected(h, 1); locked(h);
    assert.match(h.markup, /Sending answer B/);
    assert.doesNotMatch(h.markup, /Answer B saved|Correct! \+100 points/);
    assert.equal(h.client.getSnapshot().me.score, 0);
    h.client.present({ ...data, version: 3, answeredCount: 12 });
    selected(h, 1); locked(h);
    assert.match(h.markup, /Sending answer B/);
    await h.click(h.button(1));
    await h.click(h.button(3));
    assert.equal(h.posts.length, 1, 'Other students answering must not unlock a pending submission');
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
    await action;
});

test('Live displays the POST save receipt while the follow-up room GET is still pending', async () => {
    const h = setup({ hidden: false }), data = question();
    h.client.present(data);
    const action = h.click(h.button(2));
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 2 });
    await flush();
    selected(h, 2); locked(h);
    assert.match(h.markup, /Answer C saved\. Waiting for the answer reveal\./);
    assert.doesNotMatch(h.markup, /Sending answer C|Correct! \+100 points/);
    for (const request of h.requests.filter(request => request.method === 'GET')) {
        request.respond({ ...data, answeredCount: 1, me: { ...data.me, choice: 2 } });
    }
    await action;
});

test('A stale room snapshot cannot erase the acknowledged first choice or reopen answer buttons', async () => {
    const h = setup(), data = question();
    h.client.present(data);
    const firstButton = h.button(1), action = h.click(firstButton);
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
    await action;
    h.client.present({ ...data, version: 3, answeredCount: 8, serverNow: Date.now() + 1 });
    selected(h, 1); locked(h);
    assert.match(h.markup, /Answer B saved/);
    // Simulate queued events that still refer to pre-redraw enabled nodes.
    await h.click(firstButton);
    await h.click(h.button(3));
    await h.listeners.click({ detail: 0, target: { closest: () => h.button(0) } });
    assert.equal(h.posts.length, 1, 'No duplicate or changed answer after acknowledgement');
});

test('The displayed acknowledgement uses the server’s original choice, not a conflicting retry choice', async () => {
    const h = setup();
    h.client.present(question());
    const action = h.click(h.button(1));
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 0 });
    await action;
    selected(h, 0); locked(h);
    assert.doesNotMatch(h.answerTag(1), /aria-pressed="true"/);
    assert.match(h.markup, /Answer A saved/);
    assert.equal(h.client.getSnapshot().me.score, 0);
});

for (const change of [{ index: 2, version: 4 }, { round: 2, version: 8 }]) {
    test('A late save receipt cannot select an answer in a different ' + ('round' in change ? 'round' : 'question'), async () => {
        const h = setup(), data = question();
        h.client.present(data);
        const action = h.click(h.button(1));
        h.client.present({ ...data, ...change, question: { ...data.question, term: 'ספר' } });
        h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
        await action;
        assert.match(h.markup, /ספר/);
        assert.doesNotMatch(h.markup, /Answer B saved|Sending answer B/);
        for (let choice = 0; choice < 4; choice++) {
            assert.doesNotMatch(h.answerTag(choice), /aria-pressed="true"/);
            assert.doesNotMatch(h.answerTag(choice), /\bdisabled\b/);
        }
        assert.equal(h.client.getSnapshot().me.choice, null);
    });
}

test('Network failure keeps the first choice and retries that same choice without claiming it saved', async () => {
    const h = setup();
    h.client.present(question());
    const action = h.click(h.button(1));
    h.posts[0].reject(new Error('Connection timed out. Please try again.'));
    await action;
    selected(h, 1); locked(h);
    assert.doesNotMatch(h.markup, /Answer B saved/);
    assert.match(h.markup, /data-answer-retry/);
    await h.click(h.button(3));
    assert.equal(h.posts.length, 1, 'A timeout must not allow replacing the first choice');
    const retry = { disabled: false, dataset: {}, hasAttribute: name => name === 'data-answer-retry' };
    const retried = h.click(retry);
    assert.equal(h.posts.length, 2);
    assert.equal(h.posts[1].body.choice, 1);
    assert.equal(h.posts[1].body.index, 1);
    assert.equal(h.posts[1].body.round, 1);
    h.posts[1].respond({ saved: true, round: 1, index: 1, choice: 1 });
    await retried;
    assert.match(h.markup, /Answer B saved/);
    assert.doesNotMatch(h.markup, /data-answer-retry/);
});

test('Touch feedback is immediate and mouse compatibility events cannot submit a second answer', async () => {
    const h = setup();
    h.client.present(question());
    const button = h.button(2);
    let prevented = false;
    h.listeners.pointerdown({
        pointerType: 'touch', isPrimary: true, button: 0,
        target: { closest: () => button }, preventDefault() { prevented = true; }
    });
    assert(prevented); selected(h, 2); locked(h);
    assert.match(h.markup, /Sending answer C/);
    await h.listeners.click({ pointerType: 'touch', target: { closest: () => button } });
    await h.click(button);
    assert.equal(h.posts.length, 1);
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 2 });
    await flush();
    await h.click(button);
    await h.click(h.button(0));
    assert.equal(h.posts.length, 1);
    assert.match(h.markup, /Answer C saved/);
});

test('A touch click still submits once when the browser did not deliver pointerdown', async () => {
    const h = setup();
    h.client.present(question());
    const button = h.button(1), event = { pointerType: 'touch', target: { closest: () => button } };
    const action = h.listeners.click(event);
    assert.equal(h.posts.length, 1, 'Touch click must provide the missing pointerdown fallback');
    selected(h, 1); locked(h);
    assert.match(h.markup, /Sending answer B/);
    await h.listeners.click(event);
    assert.equal(h.posts.length, 1);
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
    await action;
    await h.listeners.click(event);
    assert.equal(h.posts.length, 1);
    assert.match(h.markup, /Answer B saved/);
});

for (const failed of [false, true]) {
    test('A late old POST ' + (failed ? 'failure' : 'receipt') + ' cannot unlock or overwrite a newer pending answer', async () => {
        const h = setup(), data = question();
        h.client.present(data);
        const oldAction = h.click(h.button(1));
        h.client.present({ ...data, index: 2, version: 4, question: { ...data.question, term: 'ספר' } });
        const newAction = h.click(h.button(3));
        assert.equal(h.posts.length, 2, 'The new question accepts its own first answer');
        if (failed) h.posts[0].reject(new Error('Previous request timed out'));
        else h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
        await oldAction;
        selected(h, 3); locked(h);
        assert.match(h.markup, /Sending answer D/);
        assert.doesNotMatch(h.markup, /Answer B saved|Answer D saved|data-answer-retry/);
        await h.click(h.button(0));
        assert.equal(h.posts.length, 2, 'Old completion must not clear the new submission lock');
        h.posts[1].respond({ saved: true, round: 1, index: 2, choice: 3 });
        await newAction;
        selected(h, 3); locked(h);
        assert.match(h.markup, /Answer D saved/);
    });
}

test('A teacher pause prevents stale enabled buttons from sending a new answer', async () => {
    const h = setup();
    h.client.present(question({ paused: true }));
    await h.click(h.button(1));
    h.listeners.pointerdown({
        pointerType: 'touch', isPrimary: true, button: 0,
        target: { closest: () => h.button(2) }, preventDefault() {}
    });
    assert.equal(h.posts.length, 0);
    locked(h);
    assert.doesNotMatch(h.markup, /Sending answer|Answer [A-D] saved/);
});

test('A submission rejected by a teacher pause is not presented as saved or retryable while paused', async () => {
    const h = setup(), data = question();
    h.client.present(data);
    const action = h.click(h.button(1));
    h.client.present({ ...data, paused: true, version: 3 });
    h.posts[0].respond({ error: 'The game is paused.' }, 409);
    await action;
    locked(h);
    assert.doesNotMatch(h.markup, /Sending answer|Answer B saved|data-answer-retry/);
    assert.match(h.error.textContent, /paused/);
    await h.click(h.button(0));
    assert.equal(h.posts.length, 1);
});

test('A room-confirmed answer with a pending POST does not keep the next question locked', async () => {
    const h = setup(), data = question();
    h.client.present(data);
    const oldAction = h.click(h.button(1));
    h.client.present({ ...data, answeredCount: 1, me: { ...data.me, choice: 1 } });
    assert.match(h.markup, /Answer B saved/);
    h.client.present({ ...data, index: 2, version: 4, question: { ...data.question, term: 'ספר' } });
    for (let choice = 0; choice < 4; choice++) assert.doesNotMatch(h.answerTag(choice), /\bdisabled\b/);
    const newAction = h.click(h.button(3));
    assert.equal(h.posts.length, 2);
    h.posts[0].respond({ saved: true, round: 1, index: 1, choice: 1 });
    await oldAction;
    selected(h, 3); locked(h);
    assert.match(h.markup, /Sending answer D/);
    assert.doesNotMatch(h.markup, /Answer B saved|Answer D saved/);
    h.posts[1].respond({ saved: true, round: 1, index: 2, choice: 3 });
    await newAction;
    assert.match(h.markup, /Answer D saved/);
});

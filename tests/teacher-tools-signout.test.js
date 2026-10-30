const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/flash-cards/library.js'), 'utf8');
function harness(fetch) {
    const controls = [], calls = [];
    let closed = 0;
    const context = {
        document: {createElement: () => ({setAttribute() {}})},
        management: {append: (...items) => controls.push(...items)},
        teacherDialog: {close: () => closed++},
        fetch: async (...args) => {calls.push(args); return fetch(...args);}
    };
    vm.runInNewContext(source.slice(source.indexOf('    const lockTools ='), source.indexOf('    const classGamify =')), context);
    return {controls, calls, get closed() {return closed;}};
}
test('Sign-out button appears below lock and closes tools after successful logout', async () => {
    const h = harness(async () => ({ok: true}));
    assert.equal(h.controls[0].textContent, 'Lock teacher tools');
    assert.equal(h.controls[1].textContent, 'Sign Out and Lock Teacher Tools');
    await h.controls[1].onclick();
    assert.equal(h.calls[0][0], '/api/game-scores?game=quiz-account&action=logout');
    assert.equal(h.calls[0][1].method, 'POST');
    assert.equal(h.calls[0][1].credentials, 'same-origin');
    assert.equal(h.closed, 1);
    assert.equal(h.controls[1].disabled, false);
    assert.equal(h.controls[2].hidden, true);
});
test('Failed logout stays visible and allows retry without claiming sign-out', async () => {
    for (const fetch of [async () => ({ok: false}), async () => {throw Error('offline');}]) {
        const h = harness(fetch);
        await h.controls[1].onclick();
        assert.equal(h.closed, 0);
        assert.equal(h.controls[1].disabled, false);
        assert.equal(h.controls[2].hidden, false);
        assert.match(h.controls[2].textContent, /Could not sign out/);
    }
});
test('Duplicate clicks send only one logout request; lock alone does not sign out', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => {finish = resolve;}));
    h.controls[0].onclick();
    assert.equal(h.calls.length, 0);
    const pending = h.controls[1].onclick();
    await h.controls[1].onclick();
    assert.equal(h.calls.length, 1);
    finish({ok: true});
    await pending;
    assert.equal(h.closed, 2);
});

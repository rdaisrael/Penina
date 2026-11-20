const test = require('node:test');
const assert = require('node:assert/strict');
const {setImmediate: settle} = require('node:timers/promises');
const mountGameFullscreen = require('../PeninaPlus-vocab-builder/game-fullscreen');

// Model the browser-owned fullscreen state independently of the game window.
function setup({live = false, enter} = {}) {
    const doc = new EventTarget();
    const dialog = live ? null : Object.assign(new EventTarget(), {open:true});
    const classes = new Set();
    const surface = Object.assign(new EventTarget(), {
        ownerDocument: doc,
        closest: () => dialog,
        classList: {
            toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
            contains: name => classes.has(name)
        }
    });
    function change(element) {
        doc.fullscreenElement = element;
        doc.dispatchEvent(new Event('fullscreenchange'));
    }
    if (enter) {
        surface.requestFullscreen = () => enter(() => change(surface));
        doc.exitFullscreen = () => change(null);
    }
    const button = Object.assign(new EventTarget(), {hidden:true, textContent:'Full screen'});
    mountGameFullscreen(button, surface);
    async function click() {
        button.dispatchEvent(new Event('click'));
        await settle();
    }
    return {doc, dialog, surface, button, click, change};
}

test('student can enter and exit fullscreen and the control follows a browser-initiated exit', async () => {
    for (const live of [true, false]) {
        const {button, surface, doc, click, change} = setup({live, enter: granted => granted()});
        assert.equal(button.hidden, false);
        await click();
        assert.equal(doc.fullscreenElement, surface);
        assert.equal(button.textContent, 'Exit full screen');
        await click();
        assert.equal(doc.fullscreenElement, null);
        await click();
        change(null);
        assert.equal(button.textContent, 'Full screen');
        assert.equal(surface.classList.contains('game-fullscreen'), false);
    }
});

test('unavailable or denied fullscreen expands in the page and Escape preserves the game', async () => {
    for (const enter of [undefined, () => Promise.reject(Error('denied'))]) {
        const {dialog, surface, click, button} = setup({enter});
        await click();
        assert.equal(surface.classList.contains('game-fullscreen'), true);
        const cancel = new Event('cancel', {cancelable:true});
        dialog.dispatchEvent(cancel);
        assert.equal(cancel.defaultPrevented, true);
        assert.equal(button.textContent, 'Full screen');
        assert.equal(dialog.dispatchEvent(new Event('cancel', {cancelable:true})), true);
    }
    const {doc, click, button} = setup({live:true});
    await click();
    doc.dispatchEvent(Object.assign(new Event('keydown'), {key:'Escape'}));
    assert.equal(button.textContent, 'Full screen');
});

test('closing the game while entering fullscreen leaves it ready to reopen normally', async () => {
    let finish;
    const {dialog, button, doc, click} = setup({
        enter: granted => new Promise(resolve => { finish = () => { granted(); resolve(); }; })
    });
    await click();
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
    finish();
    await settle();
    assert.equal(doc.fullscreenElement, null);
    assert.equal(button.textContent, 'Full screen');
});

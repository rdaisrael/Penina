const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
    const body = { dataset: { workflowStage: 'add' } };
    const elements = {};
    const element = id => elements[id] ||= { disabled: false, textContent: '', style: {}, focus() {} };
    element('export-vocabulary-workbook-btn').disabled = true;
    const buttons = ['add', 'review', 'share'].map(stage => ({
        dataset: { goStage: stage }, attributes: {},
        closest: () => true,
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        addEventListener(type, fn) { this.click = fn; }
    }));
    let sync;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/builder-workflow.js'), 'utf8'), {
        document: { body, getElementById: element, querySelectorAll: () => buttons,
            querySelector: () => ({ scrollIntoView() {} }) },
        MutationObserver: class { constructor(fn) { sync = fn; } observe() {} }
    });
    return { body, buttons, element, sync: () => sync() };
}

test('stages unlock after generation or draft restore and preserve edits when navigating', () => {
    const { body, buttons, element, sync } = harness();
    assert.equal(buttons[1].disabled, true);
    buttons[2].click();
    assert.equal(body.dataset.workflowStage, 'add');
    element('export-vocabulary-workbook-btn').disabled = false;
    sync();
    assert.equal(body.dataset.workflowStage, 'review');
    assert.equal(buttons[1].attributes['aria-current'], 'step');
    element('vocab-tbody').textContent = 'Edited vocabulary';
    buttons[2].click();
    sync();
    assert.equal(body.dataset.workflowStage, 'share');
    buttons[0].click();
    buttons[1].click();
    assert.equal(element('vocab-tbody').textContent, 'Edited vocabulary');
    element('export-vocabulary-workbook-btn').disabled = true;
    element('vocab-tbody').textContent = '';
    sync();
    assert.equal(body.dataset.workflowStage, 'add');
    assert.equal(buttons[2].disabled, true);
});

test('generation progress and failures remain visible in Add Words', () => {
    const { body, element, sync } = harness();
    element('generate-btn').textContent = 'Generating...';
    sync();
    assert.match(element('workflow-generation-status').textContent, /Preparing/);
    element('generate-btn').textContent = 'Generate Vocabulary Table';
    element('vocab-tbody').textContent = 'Error: Unable to generate';
    sync();
    assert.equal(body.dataset.workflowStage, 'add');
    assert.match(element('workflow-generation-status').textContent, /Unable to generate/);
});

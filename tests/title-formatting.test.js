const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/index.html'), 'utf8');
const start = html.indexOf('        function applyTitleText(');
const end = html.indexOf('\n        }', start) + '\n        }'.length;

test('display and print heading keeps Hebrew, English, mixed text and literal markup intact', () => {
    const classes = new Set();
    const heading = {
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
        set innerHTML(value) { assert.fail('Title must be inserted as plain text'); }
    };
    const context = vm.createContext({ document: { getElementById: () => heading } });
    vm.runInContext(html.slice(start, end), context);
    for (const title of ['שלום עולם', 'שָׁלוֹם  עוֹלָם', 'Lesson שלום עולם 2', '<img src=x> & שלום', 'Word List', '']) {
        context.applyTitleText(title);
        assert.equal(heading.textContent, title);
        assert.equal(heading.dir, 'auto');
        assert.equal(classes.has('title-hebrew'), /[א-ת]/.test(title));
        assert.equal(classes.has('title-english'), !/[א-ת]/.test(title));
    }
});

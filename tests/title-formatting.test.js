const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/index.html'), 'utf8');
const start = html.indexOf('        function stylizeTitleText(');
const end = html.indexOf('        function applyTitleText(', start);
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);

test('Hebrew titles preserve spaces and vowel marks in one valid span', () => {
    for (const title of ['שלום עולם', 'שָׁלוֹם  עוֹלָם', 'מילים\tחדשות']) {
        assert.equal(context.stylizeTitleText(title), '<span class="title-hebrew">' + title + '</span>');
    }
});

test('English and mixed titles use valid spans without changing text', () => {
    assert.equal(context.stylizeTitleText('Word List'), '<span class="title-english">Word List</span>');
    assert.equal(context.stylizeTitleText('Lesson שלום עולם 2'), '<span class="title-english">Lesson </span><span class="title-hebrew">שלום עולם </span><span class="title-english">2</span>');
    assert.equal(context.stylizeTitleText(''), '');
});

test('title markup remains escaped text', () => {
    assert.equal(context.stylizeTitleText('<img src=x> & שלום'), '<span class="title-english">&lt;img src=x&gt; &amp; </span><span class="title-hebrew">שלום</span>');
});

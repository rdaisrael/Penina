const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../PeninaPlus-vocab-builder/flash-cards/search');

const entries = [
    {term: 'שָׁל֣וֹם', english: 'Peace; hello', hebrew: 'בְּרָכָה בִּפְגִישָׁה'},
    {term: 'סֵפֶר', english: 'Book', hebrew: 'אוסף דפים כתובים'}
];
const set = {title: 'Week 3 Review', searchEntries: entries};

test('Class search finds titles, Hebrew terms and both definitions without depending on games', () => {
    assert.deepEqual(search.find(set, 'WEEK 3'), {matches: true, entries: []});
    for (const query of ['שלום', 'שָׁלוֹם', '  PEACE  ', 'hello', 'ברכה בפגישה']) {
        assert.deepEqual(search.find(set, query), {matches: true, entries: [entries[0]]}, query);
    }
    for (const query of ['ספר', 'סֵפֶר', 'BOOK', 'דפים']) {
        assert.deepEqual(search.find(set, query), {matches: true, entries: [entries[1]]}, query);
    }
    assert.deepEqual(search.find(set, 'unrelated'), {matches: false, entries: []});
    assert.deepEqual(search.find(set, 'peace book'), {matches: false, entries: []}, 'A phrase cannot accidentally span separate entries');
    assert.deepEqual(search.find(set, '   '), {matches: true, entries: []});
    assert.deepEqual(search.find({title: 'Legacy set'}, 'legacy'), {matches: true, entries: []});
});

test('Search normalizes Hebrew typography, marks, direction controls and whitespace on either side', () => {
    const value = {title: 'בֵּית־מִדְרָשׁ', searchEntries: [{term: 'רש״י', hebrew: 'פירוש\n\tעל התורה'}]};
    assert(search.find(value, 'בית מדרש').matches);
    assert(search.find(value, 'בית-מדרש').matches);
    assert(search.find(value, '\u200fרש"י\u200e').matches);
    assert(search.find(value, 'פֵּרוּשׁ').matches === false);
    assert(search.find(value, 'פירוש על התורה').matches);
    assert(search.find({title: 'שלום'}, 'שָׁל֣וֹם').matches);
});

test('Matching entries display all definitions safely and keep additional results accessible', () => {
    const hostile = {term: '<img src=x onerror=alert(1)>', english: 'A & B', hebrew: 'הגדרה'};
    const markup = search.preview([hostile, ...entries, ...entries]);
    assert(!markup.includes('<img'));
    assert(markup.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(markup.includes('A &amp; B'));
    assert(markup.includes('dir="auto"'));
    assert(markup.includes('5 matching entries'));
    assert(markup.includes('<details><summary>Show 2 more</summary>'));
    assert.equal(search.preview([]), '');
    assert.equal((search.preview([{term: 'Question', english: 'Answer', hebrew: 'Answer'}]).match(/>Answer</g) || []).length, 1);
});

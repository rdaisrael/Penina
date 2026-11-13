(function () {
    'use strict';

    function normalize(value) {
        return String(value || '').normalize('NFKD').toLowerCase()
            .replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g, '')
            .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
            .replace(/[\u05f3\u2018\u2019]/g, "'").replace(/[\u05f4\u201c\u201d]/g, '"')
            .replace(/[-\u05be\u2010-\u2014]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Cache normalized fields once per loaded set, rather than on every keystroke.
    const indexes = new WeakMap();
    function find(set, query) {
        let index = indexes.get(set);
        if (!index) {
            index = {
                title: normalize(set.title),
                entries: (Array.isArray(set.searchEntries) ? set.searchEntries : []).map(entry => ({
                    entry, fields: [entry.term, entry.english, entry.hebrew].map(normalize)
                }))
            };
            indexes.set(set, index);
        }
        const text = normalize(query);
        const entries = text ? index.entries.filter(row => row.fields.some(field => field.includes(text))).map(row => row.entry) : [];
        return { matches: !text || index.title.includes(text) || entries.length > 0, entries };
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function preview(entries) {
        if (!entries.length) return '';
        const rows = entries.map(entry => `<li><strong dir="auto">${escapeHtml(entry.term)}</strong>${[...new Set([entry.english, entry.hebrew])].filter(Boolean).map(value => `<span dir="auto">${escapeHtml(value)}</span>`).join('')}</li>`);
        return `<div class="search-matches"><p>${entries.length} matching ${entries.length === 1 ? 'entry' : 'entries'}</p><ul>${rows.slice(0, 3).join('')}</ul>${rows.length > 3 ? `<details><summary>Show ${rows.length - 3} more</summary><ul>${rows.slice(3).join('')}</ul></details>` : ''}</div>`;
    }

    const api = { normalize, find, preview };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else window.PeninaLibrarySearch = api;
})();

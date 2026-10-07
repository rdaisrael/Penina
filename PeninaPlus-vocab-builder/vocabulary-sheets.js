(function () {
    'use strict';
    const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const displayValue = value => String(value === undefined || value === null ? '' : value).trim().toLowerCase() === 'n' ? '' : String(value || '');

    function renderTable(cards, options = {}) {
        const block = (value, language, className = '') => {
            const text = displayValue(value);
            return text ? `<p class="${className}" lang="${language}" dir="${language === 'he' ? 'rtl' : 'auto'}">${escapeHtml(text)}</p>` : '';
        };
        const rows = (Array.isArray(cards) ? cards : []).map(card => {
            const definitions = (options.hebrew !== false ? block(card.hebrew, 'he') : '')
                + (options.english !== false ? block(card.english, 'en') : '');
            const context = block(card.contextQuote, 'he')
                + (options.hebrew !== false ? block(card.hebrewTranslation, 'he') : '')
                + (options.english !== false ? block(card.englishTranslation, 'en') : '')
                + '<div class="citations">'
                + (options.english !== false ? block(card.sourceEnglish, 'en') : '')
                + block(card.sourceHebrew, 'he') + '</div>';
            return `<tr><td class="term">${block(card.term, 'he')}</td><td>${definitions}</td>${options.context !== false ? `<td class="context">${context}</td>` : ''}</tr>`;
        }).join('');
        return `<table><colgroup>${options.context !== false ? '<col style="width:20%"><col style="width:28%"><col style="width:52%">' : '<col style="width:28%"><col style="width:72%">'}</colgroup><thead><tr><th scope="col">Term</th><th scope="col">Translation</th>${options.context !== false ? '<th scope="col">Context</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    // This function is embedded in downloads so printing also works offline.
    async function start() {
        const status = document.getElementById('status');
        const print = document.getElementById('print');
        const download = document.getElementById('download');
        const printSheet = async () => {
            if (document.fonts) await document.fonts.ready;
            window.print();
        };
        print.onclick = printSheet;
        download.onclick = () => {
            const html = '<!doctype html>\n' + document.documentElement.outerHTML;
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            const title = JSON.parse(document.getElementById('peninaSheetData').textContent).title;
            link.download = (String(title).replace(/[\\/:*?"<>|]+/g, '').trim() || 'Vocabulary') + ' - Sheets.html';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        };
        status.textContent = 'Use Print Sheets, then adjust Scale in your browser’s print dialog.';
        const action = new URLSearchParams(window.location.search).get('action');
        if (action === 'download') download.onclick();
        if (action === 'print') await printSheet();
    }

    function makeSheet(title, cards, options = {}) {
        const data = JSON.stringify({ title, cards, options }).replace(/</g, '\\u003c');
        const fontSize = Math.max(10, Math.min(24, Number(options.fontSize) || 14));
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Vocabulary Sheets</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eeeae3;color:#263344;font:16px Arial,sans-serif}
.toolbar{max-width:900px;margin:20px auto;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:white;border-radius:12px}
button{padding:12px 18px;border:1px solid #b8bdc5;border-radius:8px;background:white;font:inherit;cursor:pointer}button.primary{background:#4353ff;color:white;border-color:#4353ff}#status{width:100%;margin:0;line-height:1.5}
.sheet{max-width:900px;margin:0 auto 24px;padding:32px;background:white;font-size:${fontSize}pt;line-height:1.5}h1{font-size:1.5em;line-height:1.3;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #c8c5bf;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#f4efe6;text-align:left;font-size:.85em}.term{width:20%;font-weight:bold}p{margin:0;white-space:pre-wrap}td p+p{margin-top:.65em}.context{font-size:.9em}.citations{display:flex;justify-content:space-between;gap:12px;font-size:.7em;color:#555;margin-top:10px}.citations p{flex:1;margin:0}footer{margin-top:20px;font-size:9pt;color:#60666f}
@page{size:letter;margin:.75in}
@media print{html,body{margin:0;background:white}.toolbar{display:none!important}.sheet{max-width:none;width:100%;padding:0;margin:0}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}h1{break-after:avoid}table{overflow:visible}th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="toolbar"><button id="print" class="primary" type="button">Print Sheets</button><button id="download" type="button">Download Sheets (HTML)</button><p id="status" role="status">Use Print Sheets, then adjust Scale in your browser’s print dialog.</p></div>
<main class="sheet"><h1>${escapeHtml(title)}</h1>${renderTable(cards, options)}<footer>Generated with Penina-Hebrew Suite</footer></main>
<script id="peninaSheetData" type="application/json">${data}</script><script>(${start.toString()})();</script></body></html>`;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { makeSheet, renderTable };
})();

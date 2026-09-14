(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VocabularyUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const tenses = ['עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי'];
    const groups = ['פעל שלם','פעל ל-ה','פעל ע"ו','פעל חפ"נ','פעל פ"י','פיעל שלם','פיעל ל-ה','הפעיל שלם','הפעיל ל-ה','הפעיל ע"ו','הפעיל פ"י','התפעל שלם','נפעל שלם'];
    const cellText = value => {
        if (value == null) return '';
        if (typeof value === 'object') {
            if (value.formula || value.sharedFormula) throw new Error('Please use plain text and X marks in the vocabulary sheet, not formulas.');
            if (value.richText) return value.richText.map(part => part.text).join('').trim();
            throw new Error('The vocabulary sheet contains an unsupported cell. Please use plain text.');
        }
        return String(value).replace(/^\uFEFF/, '').trim();
    };
    const label = value => cellText(value).replace(/\s*\(.*\)\s*$/, '').replace(/[״“”]/g, '"').replace(/[־–]/g, '-').replace(/\s+/g, ' ');
    function parseRows(rows) {
        const header = rows[0] || [];
        for (const [column, expected] of [[0,'שורשים'], ...tenses.map((x,i)=>[i+2,x]), [9,'שם עצם'], [11,'שם תואר']]) {
            if (cellText(header[column]) !== expected) throw new Error('This is not the Reader vocabulary template. Download the Excel template below and keep its column headers.');
        }
        const result = {verbs:[], nouns:[], adjs:[], binyanim:[]};
        for (const row of rows.slice(1)) {
            const root = cellText(row[0]), group = label(row[1]);
            if (root) result.verbs.push(root);
            for (let i=0;i<tenses.length;i++) {
                const mark = cellText(row[i+2]).toLowerCase();
                if (mark && mark !== 'x') throw new Error('Use X (or leave blank) in the verb tense columns.');
                if (mark === 'x') {
                    if (!groups.includes(group)) throw new Error('A verb category in column B is missing or unrecognized. Please restore it from the template.');
                    result.binyanim.push(`${group}|${tenses[i]}`);
                }
            }
            for (const [key,column] of [['nouns',9],['adjs',11]]) {
                const value=cellText(row[column]);
                if(value)result[key].push(value);
            }
        }
        for(const key of Object.keys(result)) result[key]=[...new Set(result[key])];
        const vocabulary=[...result.verbs,...result.nouns,...result.adjs];
        if(!vocabulary.length) throw new Error('The template is empty. Add mastered roots, nouns, or adjectives, save it, then upload again.');
        if(vocabulary.some(word=>!/[\u05D0-\u05EA]/.test(word) || /[a-zA-Z]/.test(word))) throw new Error('Vocabulary entries must be Hebrew words. Put one word in each cell.');
        return result;
    }
    async function readExcel(buffer, ExcelJS) {
        const workbook = new ExcelJS.Workbook();
        try { await workbook.xlsx.load(buffer); }
        catch (_) { throw new Error('This file could not be opened. Save it as an Excel Workbook (.xlsx), then upload again.'); }
        const sheet=workbook.worksheets.find(sheet=>cellText(sheet.getCell('A1').value)==='שורשים');
        if(!sheet) throw new Error('No Reader vocabulary sheet was found. Please use the Excel template below.');
        if(sheet.rowCount>5000 || sheet.columnCount>100) throw new Error('The vocabulary sheet is too large. Please use the Reader template.');
        const rows=[];
        for(let i=1;i<=sheet.rowCount;i++) rows.push(Array.from({length:12},(_,j)=>sheet.getRow(i).getCell(j+1).value));
        return parseRows(rows);
    }
    return {parseRows,readExcel};
});

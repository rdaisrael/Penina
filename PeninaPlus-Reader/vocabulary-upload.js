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
    function parseRows(rows, allowEmpty = false) {
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
        if(!allowEmpty && !vocabulary.length) throw new Error('The template is empty. Add mastered roots, nouns, or adjectives, save it, then upload again.');
        if(vocabulary.some(word=>!/[\u05D0-\u05EA]/.test(word) || /[a-zA-Z]/.test(word))) throw new Error('Vocabulary entries must be Hebrew words. Put one Hebrew word or expression in each cell.');
        return result;
    }
    function merge(results) {
        const result = {verbs:[], nouns:[], adjs:[], binyanim:[]};
        for (const key of ['preps','adverbs','conjunctions','questionWords','expressions']) {
            if (results.some(part => part[key])) result[key] = [];
        }
        const categories = new Map();
        for (const part of results) {
            for (const key of Object.keys(result)) result[key].push(...(part[key] || []));
            for (const [name, words] of Object.entries(part.nounCategories || {})) {
                categories.set(name, [...new Set([...(categories.get(name) || []), ...words])]);
            }
            if (!part.nounCategories && part.nouns.length) {
                categories.set('General', [...new Set([...(categories.get('General') || []), ...part.nouns])]);
            }
        }
        for (const key of Object.keys(result)) result[key] = [...new Set(result[key])];
        if (categories.size) result.nounCategories = Object.fromEntries(categories);
        const adjectiveCategories = new Map();
        for (const part of results) {
            const source = part.adjectiveCategories || (part.adjs.length ? {General:part.adjs} : {});
            for (const [name, words] of Object.entries(source)) {
                adjectiveCategories.set(name, [...new Set([...(adjectiveCategories.get(name) || []), ...words])]);
            }
        }
        if (adjectiveCategories.size) result.adjectiveCategories = Object.fromEntries(adjectiveCategories);
        return result;
    }
    function selectNouns(result, categories) {
        if (!result.nounCategories) return result;
        return {...result, nouns:[...new Set(categories.flatMap(name =>
            Object.hasOwn(result.nounCategories, name) ? result.nounCategories[name] : []))]};
    }
    function selectAdjectives(result, categories) {
        if (!result.adjectiveCategories) return result;
        return {...result, adjs:[...new Set(categories.flatMap(name =>
            Object.hasOwn(result.adjectiveCategories, name) ? result.adjectiveCategories[name] : []))]};
    }
    async function readExcel(buffer, ExcelJS) {
        const workbook = new ExcelJS.Workbook();
        try { await workbook.xlsx.load(buffer); }
        catch (_) { throw new Error('This file could not be opened. Save it as an Excel Workbook (.xlsx), then upload again.'); }
        return parseWorkbook(workbook);
    }
    function readXls(buffer, XLSX) {
        let source;
        try {
            const bytes = new Uint8Array(buffer);
            // Do not let the permissive parser treat arbitrary text as a workbook.
            const compound = [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1].every((value,i) => bytes[i] === value);
            const biff = [0x09,0x0209,0x0409,0x0809].includes(bytes[0] | (bytes[1] << 8));
            if (!compound && !biff) throw new Error('Invalid XLS signature');
            source = XLSX.read(bytes, {type:'array', cellFormula:true, sheetRows:5001});
        } catch (_) {
            throw new Error('This .xls file could not be opened. Save it as an unencrypted Excel workbook (.xls or .xlsx), then upload again.');
        }
        const worksheets = source.SheetNames.map(name => {
            const sheet = source.Sheets[name];
            const range = sheet['!fullref'] || sheet['!ref'];
            const end = range ? XLSX.utils.decode_range(range).e : {r:-1,c:-1};
            const cell = address => {
                const value = sheet[address];
                return {value:!value ? null : value.f ? {formula:value.f}
                    : value.t === 'e' ? {error:value.v} : value.v};
            };
            return {name, rowCount:end.r+1, columnCount:end.c+1, getCell:cell,
                getRow:row => ({getCell:column => cell(XLSX.utils.encode_cell({r:row-1,c:column-1}))})};
        });
        return parseWorkbook({worksheets});
    }
    function parseWorkbook(workbook) {
        const parts = [];
        for (const sheet of workbook.worksheets) {
            const name = sheet.name.trim().toLowerCase();
            const kind = ['verbs','verb','פעלים','שורשים'].includes(name) ? 'verbs'
                : ['nouns','noun','שמות עצם','שם עצם'].includes(name) ? 'nouns'
                : ['adjectives','adjective','שמות תואר','שם תואר'].includes(name) ? 'adjs'
                : ['prepositions','preposition','מילות יחס','מילת יחס'].includes(name) ? 'preps'
                : ['adverbs','adverb','תוארי פועל'].includes(name) ? 'adverbs'
                : ['conjunctions','conjunction','מילות קישור'].includes(name) ? 'conjunctions'
                : ['question words','מילות שאלה'].includes(name) ? 'questionWords'
                : ['phrases & expressions','phrases','expressions','ביטויים'].includes(name) ? 'expressions' : null;
            const legacy = cellText(sheet.getCell('A1').value) === 'שורשים' && cellText(sheet.getCell('J1').value) === 'שם עצם';
            if (!kind && !legacy) continue;
            if(sheet.rowCount>5000 || sheet.columnCount>100) throw new Error(`Sheet "${sheet.name}" is too large. Use up to 5,000 rows and 100 columns.`);
            const rows=[];
            for(let i=1;i<=sheet.rowCount;i++) rows.push(Array.from({length:Math.max(12,sheet.columnCount)},(_,j)=>sheet.getRow(i).getCell(j+1).value));
            try {
                if (legacy) parts.push(parseRows(rows, true));
                else if (kind === 'verbs') {
                    // Reuse the established root/category/tense validation for the eight-column verb sheet.
                    const verbRows = rows.map(row => row.slice(0,8));
                    if (!verbRows.length) verbRows.push([]);
                    verbRows[0][9] = 'שם עצם'; verbRows[0][11] = 'שם תואר';
                    parts.push(parseRows(verbRows, true));
                } else {
                    const part = {verbs:[], nouns:[], adjs:[], binyanim:[]};
                    if (!part[kind]) part[kind] = [];
                    const categories = new Map();
                    for (let col=0; col<sheet.columnCount; col++) {
                        const heading = cellText((rows[0] || [])[col]);
                        const words = [...new Set(rows.slice(1).map(row=>cellText(row[col])).filter(Boolean))];
                        if (!heading && words.length) throw new Error(`Column ${col+1} needs a heading in row 1.`);
                        if (words.some(word=>!/[\u05D0-\u05EA]/.test(word) || /[a-zA-Z]/.test(word))) throw new Error('Vocabulary entries must be Hebrew words. Put one Hebrew word or expression in each cell.');
                        part[kind].push(...words);
                        if (['nouns','adjs'].includes(kind) && words.length) categories.set(heading, [...new Set([...(categories.get(heading)||[]), ...words])]);
                    }
                    if (kind === 'nouns') part.nounCategories = Object.fromEntries(categories);
                    if (kind === 'adjs') part.adjectiveCategories = Object.fromEntries(categories);
                    parts.push(part);
                }
            } catch (error) { throw new Error(`Sheet "${sheet.name}": ${error.message}`); }
        }
        if (!parts.length) throw new Error('No vocabulary sheets found. Name your sheets Verbs, Nouns, Adjectives, Prepositions, Adverbs, Conjunctions, Question Words, or Phrases & Expressions, or use the original Reader template.');
        const result = merge(parts);
        if (!['verbs','nouns','adjs','preps','adverbs','conjunctions','questionWords','expressions'].some(key => result[key]?.length)) throw new Error('The workbook is empty. Add mastered Hebrew words, save it, then upload again.');
        return result;
    }
    function readBackup(text) {
        let backup;
        try { backup = JSON.parse(text.replace(/^\uFEFF/, '')); }
        catch (_) { throw new Error('This JSON file could not be read. Choose a file saved with Save JSON Backup.'); }
        const fail = () => { throw new Error('This is not a valid Reader JSON backup. Choose a file saved with Save JSON Backup.'); };
        const object = value => value && typeof value === 'object' && !Array.isArray(value);
        const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
        if (!object(backup) || backup.format !== 'penina-reader-backup' || backup.version !== 1) fail();
        const result = backup.readerResult;
        if (!object(result) || typeof result.text !== 'string' || !result.text.trim()
            || !Array.isArray(result.words) || !result.words.every(word => object(word) && typeof word.word === 'string' && typeof word.mastered === 'boolean')
            || !Array.isArray(result.notes) || !result.notes.every(note => object(note) && Number.isInteger(note.id) && typeof note.word === 'string' && typeof note.translation === 'string')) fail();
        if (!object(backup.vocabulary)) fail();
        for (const pathway of ['A','B']) {
            const vocab = backup.vocabulary[pathway];
            if (vocab === null) continue;
            if (!object(vocab)) fail();
            for (const key of ['verbs','nouns','adjs','binyanim']) if (!strings(vocab[key])) fail();
            for (const key of ['preps','adverbs','conjunctions','questionWords','expressions']) if (vocab[key] !== undefined && !strings(vocab[key])) fail();
            for (const key of ['nounCategories','adjectiveCategories']) {
                if (vocab[key] !== undefined && (!object(vocab[key]) || !Object.values(vocab[key]).every(strings))) fail();
            }
        }
        if (!Array.isArray(backup.settings) || !backup.settings.every(setting => object(setting)
            && typeof setting.id === 'string' && typeof setting.name === 'string'
            && typeof setting.type === 'string' && typeof setting.value === 'string'
            && (!['checkbox','radio'].includes(setting.type) || typeof setting.checked === 'boolean'))) fail();
        if (backup.worksheet !== null) {
            const saved = backup.worksheet;
            if (saved?.sections !== undefined && (!strings(saved.sections) || saved.sections.join(' ').replace(/\s+/g, ' ').trim() !== result.text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim())) fail();
            if (!object(saved) || typeof saved.lang !== 'string' || typeof saved.placement !== 'string'
                || !object(saved.worksheet) || typeof saved.worksheet.title !== 'string'
                || !Array.isArray(saved.worksheet.questions) || !saved.worksheet.questions.every(q => object(q)
                    && Number.isInteger(q.number) && typeof q.text === 'string'
                    && Number.isInteger(q.lines) && q.lines >= 0 && q.lines <= 20
                    && (saved.placement !== 'sections' || (Number.isInteger(q.section) && q.section >= 0)))) fail();
        }
        return backup;
    }
    return {readBackup,parseRows,readExcel,readXls,merge,selectNouns,selectAdjectives};
});

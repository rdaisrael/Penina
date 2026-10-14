const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const XLSX=require('../PeninaPlus-Reader/vendor/xlsx-0.20.3.full.min.js');
const ExcelJS=require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');
const upload=require('../PeninaPlus-Reader/vocabulary-upload');
function bytes(sheets) {
    const workbook=XLSX.utils.book_new();
    for(const [name,rows] of Object.entries(sheets))
        XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),name);
    return XLSX.write(workbook,{type:'buffer',bookType:'biff8'});
}
test('genuine XLS preserves Hebrew, X/x marks, custom categories and all vocabulary types',async()=>{
    const source=XLSX.read(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Vocabulary_By_Category.xlsx')));
    source.Sheets.Verbs.A2={t:'s',v:'כתב'};
    source.Sheets.Verbs.C2={t:'s',v:'X'};
    source.Sheets.Verbs.D2={t:'s',v:'x'};
    for(const [name,word] of [['Nouns','סֵפֶר'],['Adjectives','גדול'],['Prepositions','על'],
        ['Adverbs','תמיד'],['Conjunctions','אבל'],['Question Words','איפה'],['Phrases & Expressions','בית ספר']])
        source.Sheets[name].A2={t:'s',v:word};
    source.Sheets.Adjectives.F1={t:'s',v:'Texture'};
    source.Sheets.Adjectives.F2={t:'s',v:'רך'};
    source.Sheets.Adjectives['!ref']='A1:F21';
    const binary=XLSX.write(source,{type:'buffer',bookType:'biff8'});
    assert.deepEqual([...binary.subarray(0,4)],[0xD0,0xCF,0x11,0xE0]);
    const actual=upload.readXls(binary,XLSX);
    const expected=await upload.readExcel(XLSX.write(source,{type:'buffer',bookType:'xlsx'}),ExcelJS);
    assert.deepEqual(actual,expected);
    assert.deepEqual(actual.adjectiveCategories.Texture,['רך']);
    assert.equal(actual.binyanim.length,2);
});
test('XLS rejects formulas, invalid marks, oversized sheets, empty and corrupt files',()=>{
    assert.throws(()=>upload.readXls(bytes({Nouns:[['Words']]}),XLSX),/empty/);
    // The BIFF writer omits formula strings, so exercise formula metadata from the parser directly.
    const formulaBytes=bytes({Nouns:[['Words'],['ספר']]});
    const formulaParser={...XLSX,read(data,options) {
        const workbook=XLSX.read(data,options);
        workbook.Sheets.Nouns.A2.f='A3';
        return workbook;
    }};
    assert.throws(()=>upload.readXls(formulaBytes,formulaParser),/plain text/);
    const rows=Array.from({length:5001},()=>['ספר']); rows[0]=['Words'];
    assert.throws(()=>upload.readXls(bytes({Nouns:rows}),XLSX),/too large/);
    assert.throws(()=>upload.readXls(Buffer.from('Nouns,ספר'),XLSX),/could not be opened/);
    assert.throws(()=>upload.readXls(bytes({Verbs:[['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי'],['כתב','פעל שלם','yes']]}),XLSX),/Use X/);
});
test('legacy single-sheet XLS template remains supported',()=>{
    const source=XLSX.read(fs.readFileSync(require.resolve('../PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx')));
    const result=upload.readXls(XLSX.write(source,{type:'buffer',bookType:'biff8'}),XLSX);
    assert.equal(result.verbs.length,6);
    assert.equal(result.nouns.length,14);
    assert.equal(result.adjs.length,5);
    assert.equal(result.binyanim.length,10);
});

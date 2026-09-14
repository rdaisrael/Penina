const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ExcelJS = require('../PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js');
const upload = require('../PeninaPlus-Reader/vocabulary-upload');
const response = require('../lib/reader-response');
const headers=['שורשים','בניין','עבר','הווה','עתיד','שם הפועל','שם פעולה','ציווי','','שם עצם','','שם תואר'];
const profile={mode:'upload',words:[],verbs:['כתב'],nouns:['ספר'],adjs:[],forms:['פעל שלם|עבר']};
const sample={text:'ספר\nכתב',words:[{word:'ספר',mastered:true,translation:'book',match:'ספר',form:''},{word:'כתב',mastered:true,translation:'wrote',match:'כתב',form:'פעל שלם|עבר'}]};
test('template columns separate roots from categories, and trim upper/lowercase X marks',()=>{
    const result=upload.parseRows([headers,['כתב','פעל שלם',' X ','x','','','','','','ספר','','גדול']]);
    assert.deepEqual(result,{verbs:['כתב'],nouns:['ספר'],adjs:['גדול'],binyanim:['פעל שלם|עבר','פעל שלם|הווה']});
});
test('invalid headers, empty templates and invalid tense marks are not accepted as success',()=>{
    assert.throws(()=>upload.parseRows([['other']]),/column headers/);
    assert.throws(()=>upload.parseRows([headers,['','פעל שלם']]),/empty/);
    assert.throws(()=>upload.parseRows([headers,['כתב','פעל שלם','yes']]),/Use X/);
    assert.throws(()=>upload.parseRows([headers,['כתב','','X']]),/column B/);
});
test('actual downloadable Excel sample loads all selected verb forms',async()=>{
    const bytes=fs.readFileSync(require.resolve('../PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
    const result=await upload.readExcel(bytes,ExcelJS);
    assert.equal(result.verbs.length,6);
    assert.equal(result.nouns.length,14);
    assert.equal(result.adjs.length,5);
    assert.equal(result.binyanim.length,10);
    assert.ok(result.binyanim.includes('התפעל שלם|עבר'));
    assert.ok(result.binyanim.includes('פעל שלם|שם פעולה'));
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    workbook.worksheets[0].getCell('J2').value='סֵפֶר';
    assert.equal((await upload.readExcel(await workbook.xlsx.writeBuffer(),ExcelJS)).nouns[0],'סֵפֶר');
});
test('blank Excel template requires vocabulary and corrupt files give useful errors',async()=>{
    await assert.rejects(upload.readExcel(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Name_of_Student_Mastered_Vocabulary.xlsx')),ExcelJS),/empty/);
    await assert.rejects(upload.readExcel(Buffer.from('not an Excel file'),ExcelJS),/could not be opened/);
});
test('analysis mismatch is repaired against the fixed draft with exact token sequence',async()=>{
    const calls=[];
    const result=await response.generateReaderAnalysis('Write a story',profile,undefined,async(prompt,options)=>{
        calls.push({prompt,options});
        return JSON.stringify(calls.length===1?{...sample,words:sample.words.slice(1)}:sample);
    });
    assert.equal(calls.length,2);
    assert.ok(calls[1].prompt.includes('["ספר","כתב"]'));
    assert.equal(result.text,sample.text);
    assert.deepEqual(result.words.map(x=>x.mastered),[true,true]);
});
test('repair never accepts a rewrite or loops indefinitely',async()=>{
    let calls=0;
    await assert.rejects(response.generateReaderAnalysis('Write',profile,sample.text,async()=>{
        calls++;return JSON.stringify({...sample,text:'אחר\nכתב'});
    }),/changed the supplied text/);
    assert.equal(calls,2);
});
test('transient failures retry once; authentication and billing failures do not',async()=>{
    for(const retryable of [true,false]) {
        let calls=0;
        const pending=response.generateReaderAnalysis('Write',profile,undefined,async()=>{
            if(++calls===1)throw Object.assign(new Error('service failure'),{retryable});
            return JSON.stringify(sample);
        });
        if(retryable)assert.equal((await pending).text,sample.text);
        else await assert.rejects(pending,/service failure/);
        assert.equal(calls,retryable?2:1);
    }
});

test('upload handler clears old vocabulary on replacement and ignores an older upload finishing late',async()=>{
    const html=fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'),'utf8');
    const fields={};
    const context=vm.createContext({uploadedVocabA:{old:true},uploadedVocabB:null,ExcelJS:{},
        VocabularyUpload:{readExcel:async buffer=>buffer},document:{getElementById(id){return fields[id] ||= {textContent:'',addEventListener(){}};}}});
    vm.runInContext(html.slice(html.indexOf('        const uploadVersions'),html.indexOf('        async function readApiResponse')),context);
    let finish;
    const oldInput={files:[{name:'old.xlsx',size:10,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}],value:'old.xlsx'};
    const old=context.validateExcelUpload(oldInput,'A');
    assert.equal(context.uploadedVocabA,null);
    const latest={verbs:['כתב'],nouns:['ספר'],adjs:[],binyanim:['פעל שלם|עבר']};
    await context.validateExcelUpload({files:[{name:'latest.xlsx',size:10,arrayBuffer:async()=>latest}],value:'latest.xlsx'},'A');
    finish({verbs:[],nouns:['ישן'],adjs:[],binyanim:[]});await old;
    assert.equal(context.uploadedVocabA,latest);
    assert.ok(fields['vocab-upload-status-a'].textContent.includes('latest.xlsx'));
    await context.validateExcelUpload({files:[{name:'bad.csv',size:10}],value:'bad.csv'},'A');
    assert.equal(context.uploadedVocabA,null);
    assert.ok(fields['vocab-upload-status-a'].textContent.includes('.xlsx'));
});

test('non-JSON gateway errors become readable messages instead of JSON syntax errors',async()=>{
    const html=fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'),'utf8');
    const context=vm.createContext({});
    vm.runInContext(html.slice(html.indexOf('        async function readApiResponse'),html.indexOf('        document.querySelectorAll(\'input[name="vocab-mode-a"]\')')),context);
    await assert.rejects(context.readApiResponse({status:504,json:async()=>{throw new Error('Unexpected token');}}),/took too long/);
});

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
        VocabularyUpload:{readExcel:async buffer=>buffer},document:{getElementById(id){if(id.includes('-categories'))return null;return fields[id] ||= {textContent:'',addEventListener(){}};}}});
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

async function workbookWith(sheets) {
    const workbook = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) workbook.addWorksheet(name).addRows(rows);
    return workbook.xlsx.writeBuffer();
}
test('multiple sheets retain custom categories, uneven columns and deduplicate words',async()=>{
    const bytes=await workbookWith({Instructions:[['Ignore these notes']],Nouns:[['Clothing','Body parts','Animals'],['חולצה','יד','כלב'],['חולצה',null,'חתול'],[null,'ראש']],Verbs:[headers.slice(0,8),['כתב','פעל שלם','x']],Adjectives:[['שם תואר'],['גדול']]});
    const result=await upload.readExcel(bytes,ExcelJS);
    assert.deepEqual(result.verbs,['כתב']);
    assert.deepEqual(result.adjs,['גדול']);
    assert.deepEqual(result.binyanim,['פעל שלם|עבר']);
    assert.deepEqual(result.nounCategories,{'Clothing':['חולצה'],'Body parts':['יד','ראש'],'Animals':['כלב','חתול']});
    assert.deepEqual(upload.selectNouns(result,['Animals']).nouns,['כלב','חתול']);
    assert.deepEqual(upload.selectNouns(result,[]).nouns,[]);
    assert.equal(result.nouns.length,5,'selection never mutates the original');
});
test('separate workbooks combine and preserve both categorized and legacy nouns',async()=>{
    const nouns=await upload.readExcel(await workbookWith({Nouns:[['Animals'],['כלב']]}),ExcelJS);
    const legacy=upload.parseRows([headers,['כתב','פעל שלם','X','','','','','','','ספר']]);
    const merged=upload.merge([nouns,nouns,legacy]);
    assert.deepEqual(merged.nouns,['כלב','ספר']);
    assert.deepEqual(merged.nounCategories,{Animals:['כלב'],General:['ספר']});
    assert.deepEqual(upload.selectNouns(merged,['General']).nouns,['ספר']);
});
test('category sheets reject missing headings, non-Hebrew entries and formulas',async()=>{
    for (const [rows, message] of [
        [[['Animals',null],['כלב','חתול']],/heading/],
        [[['Animals'],['dog']],/Hebrew/],
        [[['Animals'],[{formula:'A3',result:'כלב'}]],/plain text/]
    ]) await assert.rejects(upload.readExcel(await workbookWith({Nouns:rows}),ExcelJS),message);
});
test('empty companion sheets are accepted but an entirely blank workbook is rejected',async()=>{
    const sheets={Verbs:[headers.slice(0,8),['','פעל שלם']],Nouns:[['Animals']],Adjectives:[['שם תואר']]};
    await assert.rejects(upload.readExcel(await workbookWith(sheets),ExcelJS),/empty/);
    sheets.Nouns.push(['כלב']);
    assert.deepEqual((await upload.readExcel(await workbookWith(sheets),ExcelJS)).nouns,['כלב']);
});
test('duplicate category headings combine safely, including object property names',async()=>{
    const result=await upload.readExcel(await workbookWith({Nouns:[['Animals','Animals','__proto__'],['כלב','חתול','ספר']]}),ExcelJS);
    assert.deepEqual(result.nounCategories.Animals,['כלב','חתול']);
    assert.deepEqual(upload.selectNouns(result,['__proto__']).nouns,['ספר']);
});
test('new downloadable template becomes importable when a noun is entered',async()=>{
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Vocabulary_By_Category.xlsx')));
    assert.deepEqual(workbook.worksheets.map(sheet=>sheet.name),['Verbs','Nouns','Adjectives','Prepositions','Adverbs','Conjunctions','Question Words','Phrases & Expressions','Instructions']);
    for (const sheet of workbook.worksheets) {
        sheet.getRow(1).eachCell(cell => assert.equal(cell.alignment.horizontal,'center'));
        assert.equal(sheet.getCell('A2').border.bottom.color.argb,'FFD9DEE3');
    }
    assert.match(workbook.getWorksheet('Instructions').getCell('A7').value,/single workbook/);
    workbook.getWorksheet('Nouns').getCell('C2').value='כלב';
    assert.deepEqual((await upload.readExcel(await workbook.xlsx.writeBuffer(),ExcelJS)).nounCategories,{Animals:['כלב']});
});

test('download template has no dropdowns and accepts prepositions alone',async()=>{
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Vocabulary_By_Category.xlsx')));
    for (const sheet of workbook.worksheets) assert.deepEqual(sheet.dataValidations.model, {});
    workbook.getWorksheet('Prepositions').getCell('A2').value = 'על';
    const result = await upload.readExcel(await workbook.xlsx.writeBuffer(), ExcelJS);
    assert.deepEqual(result.preps, ['על']);
    const merged = upload.merge([result, upload.parseRows([headers,['כתב','פעל שלם','X']]), result]);
    assert.deepEqual(merged.preps, ['על']);
    assert.deepEqual(merged.verbs, ['כתב']);
});

test('prepositions are validated and recognized in Reader analysis',async()=>{
    await assert.rejects(upload.readExcel(await workbookWith({Prepositions:[['מילות יחס'],['on']]}),ExcelJS),/Hebrew/);
    const core = require('../PeninaPlus-Reader/reader-core');
    const prepProfile = {...profile, preps:['עַל']};
    assert.deepEqual(core.normalizeVocabulary(prepProfile).preps, ['על']);
    const data = {text:'ספר\nעל',words:[
        {word:'ספר',mastered:true,translation:'book',match:'ספר',form:''},
        {word:'על',mastered:true,translation:'on',match:'על',form:''}
    ]};
    assert.equal(core.validateAnalysis(data,prepProfile).words[1].mastered,true);
    assert.equal(core.validateAnalysis(data,profile).words[1].mastered,false);
});

test('each new template sheet imports alone, merges, and reaches the Reader profile',async()=>{
    const core = require('../PeninaPlus-Reader/reader-core');
    const parts = [];
    for (const [sheet,key,word] of [
        ['Adverbs','adverbs','תמיד'], ['Conjunctions','conjunctions','אבל'],
        ['Question Words','questionWords','איפה'], ['Phrases & Expressions','expressions','בית ספר']
    ]) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Vocabulary_By_Category.xlsx')));
        workbook.getWorksheet(sheet).getCell('A2').value = word;
        workbook.getWorksheet(sheet).getCell('A3').value = word;
        const result = await upload.readExcel(await workbook.xlsx.writeBuffer(),ExcelJS);
        assert.deepEqual(result[key],[word]);
        parts.push(result);
        assert.deepEqual(core.normalizeVocabulary({...profile,...result})[key],[word]);
        await assert.rejects(upload.readExcel(await workbookWith({[sheet]:[['Heading'],['invalid']]}),ExcelJS),/Hebrew/);
    }
    const merged = upload.merge(parts);
    assert.deepEqual(merged.expressions,['בית ספר']);
    assert.deepEqual(merged.questionWords,['איפה']);
    assert.deepEqual(upload.selectNouns({...merged,nounCategories:{Animals:['כלב']}},[]).expressions,['בית ספר']);
    const data = {text:'בית\nבית ספר',words:[
        {word:'בית',mastered:true,translation:'house',match:'בית ספר',form:''},
        {word:'בית',mastered:false,translation:'school',match:'',form:''},
        {word:'ספר',mastered:false,translation:'school',match:'',form:''}
    ],phrases:[{start:1,end:3,word:'בית ספר',mastered:true,translation:'school',match:'בית ספר',form:''}]};
    const checked = core.validateAnalysis(data,{...profile,...merged});
    assert.equal(checked.phrases[0].mastered,true);
    assert.equal(checked.words[0].mastered,false);
});

test('both Reader upload pathways carry the new categories into generation',()=>{
    const html=fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'),'utf8');
    const data={verbs:[],nouns:[],adjs:[],binyanim:[],adverbs:['תמיד'],conjunctions:['אבל'],questionWords:['איפה'],expressions:['בית ספר']};
    const context=vm.createContext({uploadedVocabA:data,uploadedVocabB:data,
        ReaderCore:require('../PeninaPlus-Reader/reader-core'),
        document:{querySelector:()=>({value:'upload'})}});
    const start=html.indexOf('        function getVocabularyPromptInstructions(');
    const end=html.indexOf('return { vocabPrompt, rulePrompt, masterWordsList, profile };',start);
    vm.runInContext(html.slice(start,html.indexOf('\n        }',end)+10),context);
    for (const pathway of [true,false]) {
        const result=context.getVocabularyPromptInstructions(pathway);
        assert.deepEqual([...result.profile.expressions],['בית ספר']);
        assert.deepEqual([...result.masterWordsList],['תמיד','אבל','איפה','בית ספר']);
        assert.match(result.vocabPrompt, /questionWords/);
    }
});

test('adjective template accepts custom categories, uneven columns and independent selection',async()=>{
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(fs.readFileSync(require.resolve('../PeninaPlus-Reader/Vocabulary_By_Category.xlsx')));
    const sheet=workbook.getWorksheet('Adjectives');
    assert.deepEqual(sheet.getRow(1).values.slice(1),['Size','Color','Shape','Feelings','Qualities']);
    sheet.getCell('A2').value='גדול'; sheet.getCell('A3').value='קטן';
    sheet.getCell('B2').value='אדום';
    sheet.getCell('F1').value='Texture'; sheet.getCell('F2').value='רך';
    sheet.getCell('G1').value='Size'; sheet.getCell('G2').value='גדול';
    workbook.getWorksheet('Nouns').getCell('C2').value='כלב';
    const result=await upload.readExcel(await workbook.xlsx.writeBuffer(),ExcelJS);
    assert.deepEqual(result.adjectiveCategories,{Size:['גדול','קטן'],Color:['אדום'],Texture:['רך']});
    const selected=upload.selectAdjectives(upload.selectNouns(result,[]),['Texture','Color']);
    assert.deepEqual(selected.nouns,[]);
    assert.deepEqual(selected.adjs,['רך','אדום']);
    assert.equal(result.adjs.length,4);
    assert.deepEqual(upload.selectAdjectives(selected,[]).adjs,[]);
    const legacy=upload.parseRows([headers,['','','','','','','','','','','','יפה']]);
    assert.deepEqual(upload.merge([result,legacy]).adjectiveCategories.General,['יפה']);
    const unusual=await upload.readExcel(await workbookWith({Adjectives:[['__proto__'],['טוב']]}),ExcelJS);
    assert.deepEqual(upload.selectAdjectives(unusual,['__proto__']).adjs,['טוב']);
    await assert.rejects(upload.readExcel(await workbookWith({Adjectives:[['Size',null],['גדול','קטן']]}),ExcelJS),/heading/);
});

function readerBackup() {
    return {format:'penina-reader-backup',version:1,readerResult:{...sample,notes:[]},
        vocabulary:{A:{verbs:['כתב'],nouns:['ספר'],adjs:[],binyanim:[]},B:null},
        settings:[],worksheet:{lang:'English',placement:'end',worksheet:{title:'Questions',questions:[{number:1,text:'What happened?',lines:2}]}}};
}
test('saved JSON backups round-trip reading, vocabulary and worksheets and reject corrupt data',()=>{
    const backup=readerBackup();
    assert.deepEqual(upload.readBackup(JSON.stringify(backup)),backup);
    backup.worksheet.placement='sections';
    assert.throws(()=>upload.readBackup(JSON.stringify(backup)),/valid Reader/);
    backup.worksheet.worksheet.questions[0].section=1;
    assert.deepEqual(upload.readBackup('\uFEFF'+JSON.stringify(backup)),backup);
    for(const value of ['{','{}',JSON.stringify({...backup,version:2}),JSON.stringify({...backup,vocabulary:{A:{},B:null}})]) {
        assert.throws(()=>upload.readBackup(value),/JSON|Reader/);
    }
});
test('both upload paths accept a saved JSON backup without loading Excel libraries',async()=>{
    const html=fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'),'utf8');
    for(const pathway of ['A','B']) {
        const fields={};let restored;
        const context=vm.createContext({uploadedVocabA:null,uploadedVocabB:null,VocabularyUpload:upload,
            restoreReaderBackup:backup=>{restored=backup;},
            document:{getElementById(id){if(id.includes('-categories'))return null;return fields[id] ||= {textContent:'',addEventListener(){}};}}});
        vm.runInContext(html.slice(html.indexOf('        const uploadVersions'),html.indexOf('        async function readApiResponse')),context);
        const backup=readerBackup();
        await context.validateExcelUpload({files:[{name:'saved.JSON',size:100,text:async()=>JSON.stringify(backup)}]},pathway);
        assert.deepEqual(restored,backup);
        assert.match(fields['reader-status'].textContent,/Restored saved.JSON/);
        const invalid={files:[{name:'bad.json',size:2,text:async()=>'{}'}],value:'bad.json'};
        await context.validateExcelUpload(invalid,pathway);
        assert.equal(invalid.value,'');
        assert.match(fields[`vocab-upload-status-${pathway.toLowerCase()}`].textContent,/valid Reader/);
    }
});
test('restoration reapplies saved controls, reading and worksheet and invalidates pending requests',()=>{
    const html=fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'),'utf8');
    const fields={}; const controls=[{id:'font-size',name:'',type:'number',value:'24',dispatchEvent(){}},
        {id:'',name:'vocab-mode-a',type:'radio',value:'upload',checked:true,dispatchEvent(){}}];
    const backup=readerBackup();
    backup.settings=[{id:'font-size',name:'',type:'number',value:'32'},
        {id:'',name:'vocab-mode-a',type:'radio',value:'upload',checked:false}];
    const tracker=require('../PeninaPlus-Reader/reader-core').createRequestTracker();
    const old=tracker.beginStory();let aborted=false,rendered=false;
    const context=vm.createContext({requests:tracker,worksheetAbort:{abort(){aborted=true;}},storyPending:true,
        uploadVersions:{A:1,B:1},Event:class {},uploadedVocabA:null,uploadedVocabB:null,currentWorksheet:null,
        document:{querySelectorAll:()=>controls,getElementById:id=>fields[id] ||= {style:{}}},
        showNounCategories(){},parseAndRenderOutput(data){assert.equal(data.text,backup.readerResult.text);},
        showWorksheetPrintControls(){},syncUIColors(){},renderStoryToScreen(){rendered=true;},lockQuestionOptions(){}});
    vm.runInContext(html.slice(html.indexOf('        function restoreReaderBackup'),html.indexOf("        document.getElementById('save-json-btn').addEventListener")),context);
    context.restoreReaderBackup(backup);
    assert.equal(controls[0].value,'32');assert.equal(controls[1].checked,false);
    assert.equal(context.uploadedVocabA,backup.vocabulary.A);
    assert.equal(context.currentWorksheet,backup.worksheet);
    assert.equal(fields['questions-viewport'].style.display,'block');
    assert.equal(fields['generate-questions-btn'].disabled,false);
    assert.equal(tracker.isStory(old),false);assert.ok(aborted && rendered);
});

test('too-short generated drafts are expanded on retry and never silently accepted',async()=>{
    const core=require('../PeninaPlus-Reader/reader-core');
    const make = n => {
        const text='ספר\n'+'ספר '.repeat(n).trim();
        return {text,words:core.words(text).map(()=>({word:'ספר',mastered:true,translation:'book',match:'ספר',form:''}))};
    };
    const calls=[];
    const result=await response.generateReaderAnalysis('Write a story',profile,undefined,async prompt=>{
        calls.push(prompt);return JSON.stringify(make(calls.length===1?204:600));
    },'2-page');
    assert.equal(core.words(result.text).length,601);
    assert.equal(calls.length,2);
    assert.match(calls[1],/600/);
    assert.match(calls[1],/previous attempt failed validation: The story was too short \(204 words/);
    assert.ok(!calls[1].includes('Preserve this supplied text exactly'));
    await assert.rejects(response.generateReaderAnalysis('Write',profile,undefined,async()=>JSON.stringify(make(204)),'2-page'),/too short/);
    const supplied=make(10);
    assert.equal((await response.generateReaderAnalysis('Analyze',profile,supplied.text,async()=>JSON.stringify(supplied),'2-page')).text,supplied.text);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = require('../PeninaPlus-vocab-builder/offline-study-cards');
const title = 'מילים — Vocabulary <List> & Review';
const cards = app.toCards(Array.from({length:9}, (_,i)=>({term:'מילה '+(i+1),hebrewTermTranslation:'הגדרה '+(i+1),englishTermTranslation:'Definition '+(i+1),contextQuote:'מקור '+(i+1),hebrewContextTranslation:'עברית '+(i+1),englishContextTranslation:'Context '+(i+1)})));
function runtime() {
    const html=app.makeApp(title,cards);
    const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{value:'',checked:true,textContent:'',style:{},classList:{add(){},remove(){}},showModal(){},close(){}}]));
    const rating={dataset:{rating:'known'}};
    const context={document:{title,getElementById:id=>{assert(nodes.has(id),'Missing element '+id);return nodes.get(id)},querySelectorAll:s=>s==='[data-rating]'?[rating]:[],addEventListener(){}},window:{},setTimeout(){}};
    vm.createContext(context);
    vm.runInContext(html.match(/<script>\n([\s\S]*?)<\/script>/)[1],context);
    return {html,nodes,context,rating};
}

test('Study cards render without removed UI; navigation, known-card filtering and reset work',()=>{
    const {html,nodes,rating}=runtime();
    for(const removed of ['Find a card','id="search"','Offline bilingual vocabulary practice with adaptive flip cards.','The context box remains visible.']) assert(!html.includes(removed));
    assert.equal(nodes.get('count').textContent,9);
    nodes.get('next').onclick();
    assert.equal(nodes.get('mainText').textContent,'מילה 2');
    rating.onclick();
    assert.equal(nodes.get('count').textContent,8);
    nodes.get('shuffle').onclick();
    nodes.get('reset').onclick();
    assert.equal(nodes.get('count').textContent,9);
    assert.equal(nodes.get('mainText').textContent,'מילה 1');
});

test('Both print layouts have front-only titles/numbers and correctly mirrored backs',()=>{
    const {context}=runtime();
    for(const count of [6,8]) {
        context.settings={count,translation:'both',originalQuote:true,hebrewContext:true,englishContext:true};
        const front=vm.runInContext("paperSheet(originalCards.slice(0,settings.count),'term',false,settings)",context);
        const back=vm.runInContext("paperSheet(originalCards.slice(0,settings.count),'translation',true,settings)",context);
        assert.equal((front.match(/class="paper-card-title"/g)||[]).length,count);
        assert.equal((front.match(/class="paper-card-number"/g)||[]).length,count);
        assert(front.includes('מילים — Vocabulary &lt;List&gt; &amp; Review'));
        assert(!back.includes('paper-card-title')&&!back.includes('paper-card-number'));
        assert(back.indexOf('Definition 2')<back.indexOf('Definition 1'));
        const partial=vm.runInContext("paperSheet(originalCards.slice(-1),'term',false,settings)",context);
        assert.equal((partial.match(/paper-empty/g)||[]).length,count-1);
    }
});

test('Every print translation/context choice still controls the printed content',()=>{
    const {context}=runtime();
    for(const translation of ['hebrew','english','both']) for(const originalQuote of [false,true]) for(const hebrewContext of [false,true]) for(const englishContext of [false,true]) {
        context.settings={translation,originalQuote,hebrewContext,englishContext};
        const html=vm.runInContext('printTranslations(originalCards[0],settings)',context);
        assert.equal(html.includes('הגדרה 1'),translation!=='english');
        assert.equal(html.includes('Definition 1'),translation!=='hebrew');
        assert.equal(html.includes('מקור 1'),originalQuote);
        assert.equal(html.includes('עברית 1'),hebrewContext);
        assert.equal(html.includes('Context 1'),englishContext);
    }
});

test('An N marker in an optional field is omitted from flashcards',()=>{
    const marked=app.toCards([{term:'מילה',hebrewTermTranslation:'n',englishTermTranslation:'N',contextQuote:' n ',hebrewContextTranslation:'N',englishContextTranslation:'n',hebrewCitation:'N',englishCitation:'n'}])[0];
    assert.deepEqual(marked,{n:1,term:'מילה',hebrew:'',english:'',contextQuote:'',contextQuoteRuns:[],hebrewTranslation:'',hebrewTranslationRuns:[],englishTranslation:'',englishTranslationRuns:[],sourceHebrew:'',sourceEnglish:''});
});

function publishingApi(storedHtml) {
    const pathname='vocabulary-cards/sixth/20260907--'+Buffer.from(title).toString('base64url')+'.html';
    const blob={pathname,url:'https://storage.example/cards.html',uploadedAt:'2026-09-07T00:00:00Z'};
    const operations=[];
    const context={module:{exports:{}},Buffer,console,process:{env:{CARD_PUBLISH_KEY_SIXTH:'test-only-key'}},fetch:async url=>{assert.equal(url,blob.url);return{ok:true,text:async()=>storedHtml}},require:name=>{
        if(name==='crypto')return require('node:crypto');
        if(name.includes('offline-study-cards'))return app;
        if(name.includes('vocabulary-sheets'))return require('../PeninaPlus-vocab-builder/vocabulary-sheets');
        if(name.includes('lib/vocabulary-pages')) {
            const helperContext={...context,module:{exports:{}}};
            vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/vocabulary-pages.js'),'utf8'),helperContext);
            return helperContext.module.exports;
        }
        assert.equal(name,'@vercel/blob');
        return {list:async()=>({blobs:[blob],hasMore:false}),put:async(p,html)=>{operations.push({p,html});return{...blob,pathname:p}},del:async()=>{throw new Error('No deletion expected')}};
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/flashcard-sets.js'),'utf8'),context);
    const res=()=>({headers:{},status(n){this.code=n;return this},json(data){this.body=data;return this},send(data){this.body=data;return this},setHeader(k,v){this.headers[k]=v}});
    return {handler:context.module.exports,pathname,operations,res};
}

test('Publishing accepts new cards without the old subtitle and still checks the password',async()=>{
    const html=app.makeApp(title,cards);
    const {handler,operations,res}=publishingApi(html);
    const request={method:'POST',headers:{'x-penina-publish-key':'test-only-key'},body:{grade:'sixth',title,html}};
    const valid=res();await handler(request,valid);assert.equal(valid.code,201);assert.equal(operations.length,1);
    const badPassword=res();await handler({...request,headers:{}},badPassword);assert.equal(badPassword.code,401);
    const badHtml=res();await handler({...request,body:{...request.body,html:'<html>unrelated</html>'}},badHtml);assert.equal(badHtml.code,400);
    assert.equal(operations.length,1);
});

test('Existing published sets receive current layout when viewed or downloaded without changing stored data',async()=>{
    const storedHtml='<html><p>Find a card</p><script id="peninaCardData" type="application/json">'+JSON.stringify(cards)+'</script></html>';
    const {handler,pathname,operations,res}=publishingApi(storedHtml);
    for(const download of [undefined,'1']) {
        const result=res();
        await handler({method:'GET',query:{grade:'sixth',view:pathname,download}},result);
        assert.equal(result.code,200);
        assert(!result.body.includes('Find a card'));
        assert(result.body.includes('paper-card-title'));
        assert.equal(result.headers['Content-Disposition'].startsWith(download?'attachment':'inline'),true);
        assert.deepEqual(JSON.parse(result.body.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)[1]),cards);
    }
    assert.equal(operations.length,0);
    const list=res();await handler({method:'GET',query:{grade:'sixth'}},list);
    assert.match(list.body.sets[0].downloadUrl,/^\/api\/flashcard-sets\?.*&download=1$/);
});

test('Legacy published data can be displayed, but malformed saved data is not executed',async()=>{
    for(const [html,code] of [['<script>const originalCards='+JSON.stringify(cards)+';let cards=[];</script>',200],['<script>throw new Error("Do not execute")</script>',500]]) {
        const {handler,pathname,res}=publishingApi(html);const result=res();
        await handler({method:'GET',query:{grade:'sixth',view:pathname}},result);
        assert.equal(result.code,code);
    }
});

test('Every published set exposes sheets and preserves publication settings',async()=>{
    const options={english:false,hebrew:true,context:true,fontSize:16};
    const html=app.makeApp(title,cards)+'<script id="peninaSheetOptions" type="application/json">'+JSON.stringify(options)+'</script>';
    const {handler,pathname,res}=publishingApi(html);
    const listing=res();await handler({method:'GET',query:{grade:'sixth'}},listing);
    assert(listing.body.sets[0].sheetDownloadUrl.includes('action=download'));
    assert(listing.body.sets[0].sheetPrintUrl.includes('action=print'));
    assert(listing.body.sets[0].printUrl.endsWith('#print'));
    const sheet=res();await handler({method:'GET',query:{grade:'sixth',view:pathname,sheet:'1'}},sheet);
    assert.equal(sheet.code,200);
    const saved=JSON.parse(sheet.body.match(/<script id="peninaSheetData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(saved,{title,cards,options});
    const wrongGrade=res();await handler({method:'GET',query:{grade:'sixth',view:pathname.replace('/sixth/','/seventh/'),sheet:'1'}},wrongGrade);
    assert.equal(wrongGrade.code,404);
});

test('Existing sets gain sheet access without being republished',async()=>{
    const {handler,pathname,operations,res}=publishingApi(app.makeApp(title,cards));
    const sheet=res();await handler({method:'GET',query:{grade:'sixth',view:pathname,sheet:'1'}},sheet);
    assert.equal(sheet.code,200);assert(sheet.body.includes('Download Sheets (PDF)'));
    assert.equal(operations.length,0);
});

test('Sheet pagination retains all text, including a row taller than one page',()=>{
    const {renderPages}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
    const drawings=[];
    const document={createElement:()=>({setAttribute(){},getContext:()=>({scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:text.length*7}),fillText:(text,x,y)=>{assert(y<780);drawings.push(text)}})})};
    const long=Array.from({length:900},(_,i)=>'word'+i).join(' ');
    const pages=renderPages(document,{title:'Review',cards:[{term:'Term',english:'Definition',englishTranslation:long}],options:{}});
    assert(pages.length>1);
    const rendered=drawings.join(' ');
    for(let i=0;i<900;i++)assert(rendered.includes('word'+i));
    drawings.length=0;
    renderPages(document,{title:'Review',cards:[{term:'Term',english:'HiddenEnglish',hebrew:'VisibleHebrew',contextQuote:'HiddenContext'}],options:{english:false,context:false}});
    assert(drawings.includes('VisibleHebrew'));assert(!drawings.includes('HiddenEnglish'));assert(!drawings.includes('HiddenContext'));
});

test('Sheets omit N markers from every optional field',()=>{
    const {renderPages}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
    const drawings=[];
    const document={createElement:()=>({setAttribute(){},getContext:()=>({scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:text.length*7}),fillText:text=>drawings.push(text)})})};
    const pages=renderPages(document,{title:'Review',cards:[{term:'Term',hebrew:'N',english:'n',contextQuote:'N',sourceHebrew:'n',hebrewTranslation:'N',englishTranslation:'n',sourceEnglish:'N'}],options:{}});
    assert.equal(pages.length,1);
    assert(!drawings.includes('N')&&!drawings.includes('n'));
});

test('Manual context edits sync immediately, and regeneration still operates only on checked rows',async()=>{
    const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/index.html'),'utf8');
    const selected=[{dataset:{rowIndex:'1'}}];
    const regenerated=[];const alerts=[];const synced=[];
    const context={document:{querySelectorAll:()=>selected},window:{setTimeout:fn=>fn()},setTimeout:fn=>fn(),alert:message=>alerts.push(message),regenerateContextForRow:async i=>regenerated.push(i),clearContextQuoteSelections(){},syncGeneratedRowFromDom:i=>synced.push(i),vocabTbody:{addEventListener:(name,callback)=>{assert.equal(name,'input');context.onInput=callback;}}};
    vm.createContext(context);
    const selection=source.slice(source.indexOf('        function getSelectedContextQuoteIndexes()'),source.indexOf('        function refreshOriginalHebrewDatasets('));
    const regenerate=source.slice(source.indexOf('        async function regenerateSelectedContextQuotes('),source.indexOf('        function normalizeHebrewForDisplayMatchGlobal('));
    const input=source.slice(source.indexOf("        vocabTbody.addEventListener('input'"),source.indexOf('        function syncGeneratedRowFromDom('));
    vm.runInContext(selection+regenerate+input,context);
    const edited={dataset:{original:'old quote'},innerHTML:'new quote',closest:()=>({dataset:{rowIndex:'0'}})};
    context.onInput({target:{closest:()=>edited}});
    assert.equal(edited.dataset.original,'new quote');assert.deepEqual(synced,[0]);
    await context.regenerateSelectedContextQuotes(null);
    assert.deepEqual(regenerated,[1]);
    selected.length=0;await context.regenerateSelectedContextQuotes(null);
    assert.equal(alerts.length,1);assert.deepEqual(regenerated,[1]);
});

test('Two sides always combine both definitions and context is visible only on the answer, in either order',()=>{
    const {html,nodes,context}=runtime();
    assert(!html.includes('name="cardLanguage"'));assert(!html.includes('name="printTranslation"'));
    assert.equal(nodes.get('cardContext').hidden,true);
    vm.runInContext('sideIndex=1;render()',context);
    assert.equal(nodes.get('sideNumber').textContent,'2 / 2');
    assert(nodes.get('mainText').innerHTML.includes('Definition 1'));assert(nodes.get('mainText').innerHTML.includes('הגדרה 1'));
    assert.equal(nodes.get('cardContext').hidden,false);
    nodes.get('translationFirst').onclick();assert.equal(nodes.get('cardContext').hidden,true);
    vm.runInContext('sideIndex=1;render()',context);assert.equal(nodes.get('mainText').textContent,'מילה 1');assert.equal(nodes.get('cardContext').hidden,false);
    nodes.get('next').onclick();assert.equal(nodes.get('cardContext').hidden,true);
});

test('Reverse print order puts context with the answer term and keeps definitions together',()=>{
    const {context}=runtime();context.settings={translation:'both',originalQuote:true,hebrewContext:true,englishContext:true};
    vm.runInContext('termFirst=false',context);
    const front=vm.runInContext('printTranslations(originalCards[0],settings)',context);
    const back=vm.runInContext('printTerm(originalCards[0],settings)',context);
    assert(front.includes('Definition 1')&&front.includes('הגדרה 1'));assert(!front.includes('מקור 1'));assert(back.includes('מקור 1'));
});

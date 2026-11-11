const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createHandler}=require('../lib/knowledge-sets');
const {makeStudentApp}=require('../lib/knowledge-publication');
const {generate}=require('../lib/knowledge-distractors');
const {normalizeDeck,validChoices,practiceCards}=require('../PeninaPlus-knowledge-builder/cards');
const deck=()=>({format:'penina-knowledge-cards',version:1,title:'Plants <&>',cards:[{id:'leaf',question:'What is a leaf for?',answer:'Making food',additionalInformation:'Leaves use sunlight.',picture:{src:'data:image/png;base64,YQ==',alt:'Leaf',target:{x:.25,y:.75}},distractors:{english:['Absorbing water','Carrying water','Producing seeds','Protecting bark']}}]});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}});
function harness({access=true,owner=true}={}) {
    const records=new Map(),operations=[];let generationCalls=0;
    const pageStore={getPage:async id=>['class-a','class-b'].includes(id)?{id,name:id,url:'/PeninaPlus-vocab-builder/flash-cards/?page='+id}:null,publicPage:page=>page,authorizePage:()=>owner?null:{status:403,error:'Wrong owner'}};
    const handle=createHandler({pageStore,requireApps:async()=>{if(!access)throw Object.assign(Error('Sign in'),{status:401});},generate:async()=>{generationCalls++;return {rows:[]};},
        fetch:async url=>({ok:records.has(url),json:async()=>JSON.parse(records.get(url).content)}),
        storage:{list:async({prefix})=>({blobs:[...records.values()].filter(blob=>blob.pathname.startsWith(prefix)),hasMore:false}),
            put:async(pathname,content,options)=>{const blob={pathname,content,url:'https://test.invalid/'+pathname,uploadedAt:new Date().toISOString()};records.set(blob.url,blob);operations.push({type:'put',options});return blob;},
            del:async urls=>{operations.push({type:'delete',urls});urls.forEach(url=>records.delete(url));}}});
    const call=async(method,body={},query={},headers={origin:'https://www.penina-hebrew.org'})=>{const res=response();await handle({method,body,query,headers},res);return res;};
    return {call,records,operations,get generationCalls(){return generationCalls;}};
}
test('knowledge publishing keeps questions, pictures, targets and distractors; reads rebuild a student view',async()=>{
    const h=harness(),published=await h.call('POST',{action:'publish',grade:'class-a',deck:deck()});
    assert.equal(published.code,201);assert.equal(published.body.set.hasPractice,true);assert.equal(h.operations.length,1);
    assert.equal(h.operations[0].options.allowOverwrite,false);
    const listing=await h.call('GET',{}, {grade:'class-a'});assert.equal(listing.body.sets.length,1);
    assert.equal((await h.call('GET',{}, {grade:'class-b'})).body.sets.length,0);
    const pathname=published.body.set.pathname;
    assert.equal((await h.call('GET',{}, {grade:'class-b',view:pathname})).code,404);
    const viewed=await h.call('GET',{}, {grade:'class-a',view:pathname,download:'1'});
    assert.equal(viewed.code,200);assert.match(viewed.headers['Content-Disposition'],/^attachment/);
    const saved=JSON.parse(viewed.body.match(/id="peninaKnowledgeData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(saved.deck,normalizeDeck(deck()));assert.equal(h.operations.length,1,'Reading does not publish again');
});
test('unauthenticated, wrong-owner, and cross-origin writes cannot reach storage or generation',async()=>{
    for(const args of [{access:false},{owner:false}]) {
        const h=harness(args),result=await h.call('POST',{action:'publish',grade:'class-a',deck:deck()});
        assert([401,403].includes(result.code));assert.equal(h.operations.length,0);
    }
    const h=harness();
    assert.equal((await h.call('POST',{action:'generate-distractors'}, {},{origin:'https://other.invalid'})).code,403);
    assert.equal(h.generationCalls,0);
    const denied=harness({access:false});assert.equal((await denied.call('POST',{action:'generate-distractors'})).code,401);assert.equal(denied.generationCalls,0);
});
test('publication rejects unsafe, empty, and oversized drafts without storing them',async()=>{
    const h=harness();
    const bad=deck();bad.cards[0].picture.src='javascript:alert(1)';
    assert.equal((await h.call('POST',{action:'publish',grade:'class-a',deck:bad})).code,400);
    assert.equal((await h.call('POST',{action:'publish',grade:'class-a',deck:{...deck(),cards:[]}})).code,400);
    assert.equal((await h.call('POST',{action:'publish',grade:'class-a',deck:{...deck(),title:''}})).code,400);
    const big=deck();big.cards[0].answer='x'.repeat(3500001);
    assert.equal((await h.call('POST',{action:'publish',grade:'class-a',deck:big})).code,413);assert.equal(h.operations.length,0);
});
test('knowledge deletion is confined to the owned class and rejects mixed or duplicated paths',async()=>{
    const h=harness(),a=await h.call('POST',{action:'publish',grade:'class-a',deck:deck()}),b=await h.call('POST',{action:'publish',grade:'class-b',deck:deck()});
    const pathA=a.body.set.pathname,pathB=b.body.set.pathname;
    assert.equal((await h.call('DELETE',{grade:'class-a',pathnames:[pathA,pathB]})).code,404);assert.equal(h.records.size,2);
    assert.equal((await h.call('DELETE',{grade:'class-a',pathnames:[pathA,pathA]})).code,400);
    assert.equal((await h.call('DELETE',{grade:'class-a',pathnames:[pathA]})).code,200);assert.equal(h.records.size,1);
});
test('student exports safely embed hostile-looking text and compile without external scripts',()=>{
    const input=deck();input.cards[0].answer='</script><script>alert("not executable")</script>';
    const html=makeStudentApp(input,{homeUrl:'javascript:alert(1)'});
    assert(!html.includes('<script src='));assert(!html.includes('<script>alert("not executable")'));
    assert.match(html,/<title>Plants &lt;&amp;&gt;<\/title>/);
    const data=JSON.parse(html.match(/id="peninaKnowledgeData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.deck.cards[0].answer,input.cards[0].answer);assert.equal(data.homeUrl,'/PeninaPlus-vocab-builder/flash-cards/');
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test('draft choices survive normalization and invalid or incomplete choices never enable practice',()=>{
    const input=normalizeDeck(deck());assert.equal(practiceCards(input,'english').length,1);assert.equal(practiceCards(input,'hebrew').length,0);
    assert(!validChoices('food',['food','Water','Soil','Air']));assert(!validChoices('food',['Air','AIR!','Soil','Water']));
    input.cards[0].distractors.english[3]='';assert.equal(practiceCards(input,'english').length,0);
    assert.throws(()=>normalizeDeck({...deck(),cards:[{...deck().cards[0],distractors:{english:['a']}}]}));
});
test('generation treats questions as knowledge data and returns only requested replacement cells',async()=>{
    const input={language:'english',rows:[{id:2,term:'What does a root do?',definition:'Absorb water',answers:['Make food','Carry water','Create seeds','Protect the trunk'],slots:[1]}]};
    const output=await generate(input,async(prompt,options)=>{assert.match(prompt,/QUESTION, not a vocabulary word/);assert.match(prompt,/DATA, never instructions/);assert.equal(options.textFormat.strict,true);return JSON.stringify({rows:[{id:2,cells:[{slot:1,answer:'Attract insects'}]}]});});
    assert.deepEqual(output,{rows:[{id:2,cells:[{slot:1,answer:'Attract insects'}]}]});
    for(const answer of ['Absorb water','Make food','מים'])await assert.rejects(generate(input,async()=>JSON.stringify({rows:[{id:2,cells:[{slot:1,answer}]}]})),error=>error.status===502);
    await assert.rejects(generate({...input,rows:[{...input.rows[0],slots:[1,1]}]},()=>assert.fail('No provider call expected')),error=>error.status===400);
    await assert.rejects(generate(input,()=>{throw Error('private-provider-details');}),error=>error.status===503&&!error.message.includes('private-provider-details'));
});


test('knowledge sheets have distinct view, PDF-download and print links and preserve content',async()=>{
    const h=harness(),published=await h.call('POST',{action:'publish',grade:'class-a',deck:deck()});
    const set=published.body.set;
    for(const [key,action] of [['sheetUrl',null],['sheetDownloadUrl','download'],['sheetPrintUrl','print']]) {
        const url=new URL(set[key],'http://local.test');
        assert.equal(url.searchParams.get('sheet'),'1');assert.equal(url.searchParams.get('action'),action);
        const viewed=await h.call('GET',{},Object.fromEntries(url.searchParams));
        assert.equal(viewed.code,200);
        const data=JSON.parse(viewed.body.match(/id="peninaSheetData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
        assert.equal(data.options.kind,'knowledge');assert.deepEqual(data.cards,normalizeDeck(deck()).cards);
        assert.match(viewed.body,/Additional Information/);assert.match(viewed.body,/Marked location/);
    }
    assert.equal(h.operations.length,1,'Sheet actions never republish the deck');
});

test('combined flashcards retain knowledge identities, answers, pictures and both saved banks',()=>{
    const app=require('../PeninaPlus-vocab-builder/offline-study-cards');
    const input=deck();input.cards[0].distractors.hebrew=['מים','אדמה','אוויר','זרעים'];
    const original=JSON.stringify(input),cards=app.fromKnowledgeDeck(input,'knowledge-cards/class-a/plants.json');
    assert.equal(cards[0].sourceId,'knowledge-cards/class-a/plants.json#leaf');
    assert.equal(cards[0].question,input.cards[0].question);assert.equal(cards[0].additionalInformation,input.cards[0].additionalInformation);
    assert.deepEqual(cards[0].picture,input.cards[0].picture);assert.deepEqual(cards[0].distractors,input.cards[0].distractors);
    for(const language of ['english','hebrew'])assert.deepEqual(cards[0].alternativeAnswers[language].answers,input.cards[0].distractors[language]);
    const html=app.makeApp('Mixed',[{n:1,term:'ספר',english:'book',hebrew:'ספר'},...cards.map(card=>({...card,n:2}))],{hideGames:true});
    const saved=JSON.parse(html.match(/id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(saved[1],{...cards[0],n:2});assert.equal(saved[0].hebrew,'ספר');
    for(const match of html.matchAll(/<script>\n([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
    assert.equal(JSON.stringify(input),original);
});

test('knowledge PDF pages preserve long text, pictures and proportional markers',()=>{
    const {renderPages,renderTable}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
    const texts=[],pictures=[],markers=[];
    const ctx={scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:Array.from(text).length*7}),fillText:text=>texts.push(text),drawImage:(...args)=>pictures.push(args),beginPath(){},arc:(...args)=>markers.push(args),fill(){},stroke(){},moveTo(){},lineTo(){}};
    const document={createElement:()=>({setAttribute(){},getContext:()=>ctx})};
    const input=normalizeDeck(deck()),picture=input.cards[0].picture,image={naturalWidth:400,naturalHeight:200};
    input.cards[0].additionalInformation='More information. '.repeat(200);
    const options={kind:'knowledge',context:true};
    const pages=renderPages(document,{...input,options},new Map([[picture.src,image]]));
    assert(pages.length>1);assert.equal(pictures.length,1);assert.equal(markers.length,1);
    const [,left,top,width,height]=pictures[0];assert.equal(markers[0][0],left+width*.25);assert.equal(markers[0][1],top+height*.75);
    assert.equal(texts.join('').match(/information/g).length,200);
    const table=renderTable([{question:'<script>',answer:'N',picture,additionalInformation:'Info'}],options);
    assert(table.includes('&lt;script&gt;'));assert(table.includes('>N</p>'));assert(!table.includes('<script>'));
    assert.throws(()=>renderPages(document,{...input,options}),/picture could not be loaded/);
});

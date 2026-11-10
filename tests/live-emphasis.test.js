const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harness=require('./helpers/live-harness');
function twoLists(database=false){
 const h=harness({database}),other='vocabulary-cards/sixth/other.html';
 const pack=cards=>'<script id="peninaCardData" type="application/json">'+JSON.stringify(cards)+'</script>';
 h.storage.set(h.setPath,{body:pack(h.cards.slice(0,3)),uploadedAt:'2026-10-10T16:00:00Z'});
 h.storage.set(other,{body:pack(h.cards.slice(3)),uploadedAt:'2026-10-09T16:00:00Z'});
 return {...h,other};
}
async function play(h,code,hostToken){
 let view=(await h.request(null,{code},hostToken)).body;
 assert.equal((await h.request('start',{code,version:view.version},hostToken)).code,200);
 const terms=[];
 for(let i=0;i<view.total;i++){
  view=(await h.request(null,{code},hostToken)).body;terms.push(view.question.term);
  assert.equal((await h.request('reveal',{code,version:view.version},hostToken)).code,200);
  assert.equal((await h.request('next',{code,version:view.version+1},hostToken)).code,200);
 }
 return terms;
}
test('Live list emphasis changes actual question frequency and survives replay and temporary exclusion',async()=>{
 for(const database of [false,true]){
  const h=twoLists(database),weights={[h.setPath]:3,[h.other]:1};
  const created=await h.create({pathnames:[h.setPath,h.other],count:20,wordlistEmphasis:weights});assert.equal(created.code,201);
  const {code,hostToken}=created.body,student=(await h.join(code)).body.studentToken;
  let view=(await h.request(null,{code},hostToken)).body;assert.deepEqual(view.settings.wordlistEmphasis,weights);
  assert.equal((await h.request(null,{code},student)).body.settings,undefined);
  const terms=await play(h,code,hostToken),first=term=>h.cards.slice(0,3).some(card=>card.term===term);
  assert.equal(terms.length,20);assert.equal(terms.filter(first).length,15);
  view=(await h.request(null,{code},hostToken)).body;
  assert.equal((await h.request('restart',{code,version:view.version},hostToken)).code,200);
  view=(await h.request(null,{code},hostToken)).body;assert.deepEqual(view.settings.wordlistEmphasis,weights);
  const revised={[h.setPath]:1,[h.other]:3};
  assert.equal((await h.request('configure',{code,version:view.version,pathnames:[h.setPath],wordlistEmphasis:revised},hostToken)).code,200);
  view=(await h.request(null,{code},hostToken)).body;assert.equal(view.total,3);assert.deepEqual(view.settings.wordlistEmphasis,revised);
  assert.equal((await h.request('configure',{code,version:view.version,pathnames:[h.setPath,h.other]},hostToken)).code,200);
  view=(await h.request(null,{code},hostToken)).body;assert.deepEqual(view.settings.wordlistEmphasis,revised);assert.equal(view.playerCount,1);
  const replay=await play(h,code,hostToken),normal=replay.filter(first).length;
  assert.ok(normal>0);assert.equal(replay.length-normal,normal*3);
 }
});
test('Live validates emphasis before creating or changing games and only the host can change it',async()=>{
 const h=twoLists();
 const invalid=[null,[],2,{[h.setPath]:0},{[h.setPath]:4},{[h.setPath]:'2'},{[h.setPath]:1.5},{[h.other]:2},{'vocabulary-cards/other/list.html':3}];
 for(const wordlistEmphasis of invalid)assert.equal((await h.create({wordlistEmphasis})).code,400,JSON.stringify(wordlistEmphasis));
 assert.equal([...h.storage.keys()].filter(name=>name.startsWith('live-vocab/')).length,0);
 const {code,hostToken}=(await h.create()).body,student=(await h.join(code)).body.studentToken;
 for(const wordlistEmphasis of invalid)assert.equal((await h.request('configure',{code,version:0,wordlistEmphasis},hostToken)).code,400);
 assert.equal((await h.request('configure',{code,version:0,wordlistEmphasis:{[h.setPath]:3}},student)).code,403);
 const view=(await h.request(null,{code},hostToken)).body;assert.equal(view.version,0);assert.deepEqual(view.settings.wordlistEmphasis,{[h.setPath]:1});
});
test('2× emphasis uses the same relative frequency as individual exercises',async()=>{
 const h=twoLists(),{code,hostToken}=(await h.create({pathnames:[h.setPath,h.other],count:15,wordlistEmphasis:{[h.setPath]:2,[h.other]:1}})).body;
 await h.join(code);const terms=await play(h,code,hostToken);
 assert.equal(terms.length,15);assert.equal(terms.filter(term=>h.cards.slice(0,3).some(card=>card.term===term)).length,10);
});
test('Game settings preserves per-list emphasis through exclusion and a failed save',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/live/live.js'),'utf8');
 const inputs=[{value:'0',checked:true},{value:'1',checked:true}],message={textContent:''},calls=[];
 const form={elements:{count:{value:'10'},seconds:{value:'0'},revealSeconds:{value:'5'},'emphasis-0':{value:'3'},'emphasis-1':{value:'2'}},querySelectorAll(selector){if(selector==='input[name="wordlist"]')return inputs;if(selector==='input[name="wordlist"]:checked')return inputs.filter(input=>input.checked);return [...inputs,...Object.values(this.elements)];}};
 const dialog={setAttribute(){},showModal(){},close(){this.closed=true;},querySelector:selector=>selector==='form'?form:selector==='[data-settings-error]'?message:{}};
 const context={host:true,busy:false,snapshot:{phase:'lobby',version:4,settings:{count:10,seconds:0,revealSeconds:5,pathnames:['first','second'],wordlistEmphasis:{first:3,second:2},wordlists:[{pathname:'first',title:'First list',terms:10},{pathname:'second',title:'Second list',terms:8}]}},esc:value=>value,document:{createElement:()=>dialog,body:{append(){}}},error:{textContent:'Retry saving'},act:async(action,values)=>{calls.push({action,values});return calls.length>1;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' function gameSettings(){'),source.indexOf(' function draw(data){')),context);context.gameSettings();
 assert.match(dialog.innerHTML,/aria-label="Emphasis for First list"/);assert.match(dialog.innerHTML,/value="3" selected>3×/);
 inputs[1].checked=false;inputs[1].onchange();assert.equal(form.elements['emphasis-1'].disabled,true);
 await form.onsubmit({preventDefault(){}});assert.equal(message.textContent,'Retry saving');assert.equal(form.elements['emphasis-1'].disabled,true);
 inputs[1].checked=true;inputs[1].onchange();form.elements['emphasis-0'].value='1';await form.onsubmit({preventDefault(){}});
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].values.wordlistEmphasis)),{first:3,second:2});
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].values.wordlistEmphasis)),{first:1,second:2});assert.equal(dialog.closed,true);
});

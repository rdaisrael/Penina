const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/library.js'),'utf8');
function setup(selected,respond){
 const requests=[],messages=[],dialogs=[],buttons=[{},{}],navigations=[];
 const emphasisInputs=selected.map(()=>({value:'1'}));
 const note={textContent:''},form={elements:{language:{value:'english'},count:{value:'10'},seconds:{value:'10'},revealSeconds:{value:'5'},...Object.fromEntries(emphasisInputs.map((input,index)=>['emphasis-'+index,input]))},querySelector:()=>note,querySelectorAll:()=>buttons};
 const ctx={wordlistEmphasis:{two:2},sendScoresToTeacher:{checked:false},sets:[{pathname:'one',title:'First',hasGames:true},{pathname:'two',title:'Second',hasGames:true},{pathname:'three',title:"EJ's Clothing",hasGames:false}],selectedPathnames:()=>selected,showMessage:async(...args)=>messages.push(args),escapeHtml:s=>s,grade:'sixth',managementPassword:'demo',document:{createElement:()=>({showModal(){},addEventListener(){},querySelector:s=>s==='form'?form:{},innerHTML:''}),body:{appendChild:d=>dialogs.push(d)}},fetch:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return respond?respond(body):{ok:true,json:async()=>({code:'123456',hostToken:'sample'})};},sessionStorage:{setItem(){}},window:{location:{assign:url=>navigations.push(url)}}};
 ctx.studySets=()=>[...ctx.sets,...(ctx.knowledgeSets||[])];
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    async function openLiveSetup()'),source.indexOf('    async function enterManagementMode()')),ctx);
 return {ctx,requests,messages,dialogs,form,note,buttons,navigations,emphasisInputs};
}
test('Starting a live game captures the checked wordlists without a separate save',async()=>{
 const selected=['two'],h=setup(selected);await h.ctx.openLiveSetup();
 assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].innerHTML,/class="live-wordlist-title">Second<\/span>/);
 assert(!h.dialogs[0].innerHTML.includes('class="live-wordlist-title">First</span>'));assert(!h.dialogs[0].innerHTML.includes('name="sets"'));
 selected.splice(0,1,'one');
 await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.deepEqual(h.requests[0].pathnames,['two']);assert.equal(h.requests[0].action,'create');
});
test('Empty selections do not open live setup',async()=>{
 const h=setup([]);await h.ctx.openLiveSetup();assert.equal(h.dialogs.length,0);assert.equal(h.requests.length,0);assert.equal(h.messages.length,1);
});
test('Every checked list appears in setup and reaches the server even when library availability is false',async()=>{
 for(const selected of [['three'],['one','three']]){
  const h=setup(selected);await h.ctx.openLiveSetup();
  assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].innerHTML,/class="live-wordlist-title">EJ's Clothing<\/span>/);
  await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
  assert.deepEqual(h.requests[0].pathnames,selected);assert.equal(h.navigations.length,1);
 }
});
test('A list-specific error preserves the full selection and allows retrying with another language',async()=>{
 const error='“EJ\'s Clothing” has no teacher-approved answer choices in English.';
 const h=setup(['one','three'],body=>({ok:body.language==='hebrew',json:async()=>body.language==='hebrew'?{code:'123456',hostToken:'sample'}:{error}}));
 await h.ctx.openLiveSetup();await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.equal(h.note.textContent,error);assert.equal(h.navigations.length,0);assert(h.buttons.every(button=>!button.disabled));
 h.form.elements.language.value='hebrew';h.emphasisInputs[1].value='3';await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.deepEqual(h.requests[1].pathnames,['one','three']);assert.deepEqual(h.requests[1].wordlistEmphasis,{one:1,three:3});assert.equal(h.navigations.length,1);
});

test('Score checkbox sends only the opt-in flag without requesting an email',async()=>{
 const h=setup(['one']);h.ctx.sendScoresToTeacher.checked=true;
 await h.ctx.openLiveSetup();await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.equal(h.requests[0].sendScoresToTeacher,true);assert.equal('teacherEmail' in h.requests[0],false);
 assert(!source.includes('id="teacher-score-email"'));
});

test('Live setup shows saved emphasis and sends independent choices for every selected list',async()=>{
 const h=setup(['one','two']);await h.ctx.openLiveSetup();
 assert.match(h.dialogs[0].innerHTML,/aria-label="Emphasis for Second"[^>]*>[\s\S]*?<option value="2" selected>2×/);
 h.emphasisInputs[0].value='3';h.emphasisInputs[1].value='2';await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.deepEqual(h.requests[0].wordlistEmphasis,{one:3,two:2});assert.deepEqual(h.ctx.wordlistEmphasis,{two:2});
});

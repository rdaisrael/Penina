const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/flash-cards/library.js'),'utf8');
function setup(selected){
 const requests=[],messages=[],dialogs=[],buttons=[{},{}];
 const note={textContent:''},form={elements:{language:{value:'english'},count:{value:'10'},seconds:{value:'10'},revealSeconds:{value:'5'}},querySelector:()=>note,querySelectorAll:()=>buttons};
 const ctx={sendScoresToTeacher:{checked:false},sets:[{pathname:'one',title:'First',hasGames:true},{pathname:'two',title:'Second',hasGames:true},{pathname:'three',title:'No choices',hasGames:false}],selectedPathnames:()=>selected,showMessage:async(...args)=>messages.push(args),escapeHtml:s=>s,grade:'sixth',managementPassword:'demo',document:{createElement:()=>({showModal(){},addEventListener(){},querySelector:s=>s==='form'?form:{},innerHTML:''}),body:{appendChild:d=>dialogs.push(d)}},fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return{ok:true,json:async()=>({code:'123456',hostToken:'sample'})};},sessionStorage:{setItem(){}},window:{location:{assign(){}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    async function openLiveSetup()'),source.indexOf('    async function enterManagementMode()')),ctx);
 return {ctx,requests,messages,dialogs,form};
}
test('Starting a live game captures the checked wordlists without a separate save',async()=>{
 const selected=['two'],h=setup(selected);await h.ctx.openLiveSetup();
 assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].innerHTML,/<li>Second<\/li>/);
 assert(!h.dialogs[0].innerHTML.includes('<li>First</li>'));assert(!h.dialogs[0].innerHTML.includes('name="sets"'));
 selected.splice(0,1,'one');
 await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.deepEqual(h.requests[0].pathnames,['two']);assert.equal(h.requests[0].action,'create');
});
test('Empty selections and selections without game-ready wordlists do not open a lobby',async()=>{
 for(const selected of [[],['three']]){const h=setup(selected);await h.ctx.openLiveSetup();assert.equal(h.dialogs.length,0);assert.equal(h.requests.length,0);assert.equal(h.messages.length,1);}
});

test('Score checkbox sends only the opt-in flag without requesting an email',async()=>{
 const h=setup(['one']);h.ctx.sendScoresToTeacher.checked=true;
 await h.ctx.openLiveSetup();await h.form.onsubmit({preventDefault(){},currentTarget:h.form});
 assert.equal(h.requests[0].sendScoresToTeacher,true);assert.equal('teacherEmail' in h.requests[0],false);
 assert(!source.includes('id="teacher-score-email"'));
});

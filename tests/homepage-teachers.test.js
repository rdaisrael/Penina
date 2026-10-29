const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../homepage-teachers.js'),'utf8');
async function view(user,denied=false,extraTeacher=false,confirmed=true) {
 const elements=new Map(),events={},calls=[],warnings=[],payloads=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,replaceChildren(){this.items=[];},append(...items){this.items.push(...items);},reset(){},textContent:''});return elements.get(id);};
 vm.runInNewContext(source,{document:{getElementById:element,querySelectorAll:()=>[],createTextNode:text=>({textContent:text}),createElement:()=>({items:[],append(...items){this.items.push(...items);},setAttribute(){}})},window:{confirm:message=>{warnings.push(message);return confirmed;},addEventListener:(name,fn)=>events[name]=fn},fetch:async (url,options)=>{calls.push(url);if(options?.method==='POST'){payloads.push(JSON.parse(options.body));extraTeacher=false;}return url.includes('quiz-account')?{ok:!!user,json:async()=>user}:{ok:!denied,json:async()=>denied?{error:'Denied'}:{teachers:[{userId:1,name:'David',email:user.email},...(extraTeacher?[{userId:2,name:'Second Teacher',email:'second@example.org'}]:[])]}};}});
 await events.pageshow();return {elements,events,calls,warnings,payloads};
}
test('Homepage hides user management for visitors and all other accounts',async()=>{
 for(const user of [null,{userId:2,email:'teacher@example.org'},{userId:1,email:'other@example.org'}]) {
  const v=await view(user);assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.calls.length,1);
 }
});
test('Homepage shows owner management only after the protected directory authorizes access',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const denied=await view(owner,true);assert.equal(denied.elements.get('teacher-numbers').hidden,true);
 const v=await view(owner);assert.equal(v.elements.get('teacher-numbers').hidden,false);assert.equal(v.elements.get('teacher-list').items.length,1);
 v.events.pagehide();assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.elements.get('teacher-list').items.length,0);
});


test('Delete user is offered only for other teachers, requires confirmation, and refreshes the list',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const cancelled=await view(owner,false,true,false);
 assert.equal(cancelled.elements.get('teacher-list').items[0].items.length,0);
 const cancelButton=cancelled.elements.get('teacher-list').items[1].items[0];
 assert.equal(cancelButton.textContent,'Delete user');await cancelButton.onclick();assert.equal(cancelled.calls.length,2);
 const accepted=await view(owner,false,true,true);
 await accepted.elements.get('teacher-list').items[1].items[0].onclick();
 assert.equal(accepted.elements.get('teacher-list').items.length,1);
 assert.match(accepted.elements.get('teacher-number-status').textContent,/User deleted/);
});


test('Deleting webpages is opt-in and shows an irreversible warning before sending the request',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const v=await view(owner,false,true,true),row=v.elements.get('teacher-list').items[1];
 const checkbox=row.items[1].items[0];assert.equal(checkbox.checked,false);checkbox.checked=true;
 await row.items[0].onclick();assert.match(v.warnings[0],/cannot be undone/);assert.match(v.warnings[0],/all of their webpages/);
 assert.equal(v.payloads[0].deleteWebpages,true);assert.equal(v.payloads[0].confirmPermanentDeletion,true);
 const cancelled=await view(owner,false,true,false),other=cancelled.elements.get('teacher-list').items[1];other.items[1].items[0].checked=true;await other.items[0].onclick();assert.equal(cancelled.payloads.length,0);
});


test('Existing user access can be added and removed without resetting other unsaved controls',async()=>{
 const v=await view({userId:1,email:'disrael@saracademy.org'},false,true,true);
 const row=v.elements.get('teacher-list').items[1],editor=row.items.find(item=>item.className==='user-app-access');
 const checks=editor.items.slice(1,5).map(label=>label.items[0]);
 assert.equal(checks.length,4);assert(checks.every(input=>input.checked));
 checks.forEach(input=>{input.checked=input.value==='quizzes';});
 const save=editor.items[5];assert.equal(save.textContent,'Save access');await save.onclick();
 assert.deepEqual(v.payloads[0].apps,['quizzes']);assert.equal(v.payloads[0].operation,'access');
 assert.equal(v.elements.get('teacher-list').items[1],row);
 assert.equal(editor.items[6].textContent,'Access saved.');
 checks.forEach(input=>{input.checked=false;});await save.onclick();assert.deepEqual(v.payloads[1].apps,[]);
 assert.match(editor.items[6].textContent,/No webapps/);
});


test('Email request form submits the entered address and displays the acknowledgement',async()=>{
 const v=await view({userId:2,email:'teacher@outlook.com',message:'Check your inbox.'});
 v.elements.set('signin-email',{value:'teacher@outlook.com'});
 const button={disabled:false};
 await v.elements.get('email-signin-form').onsubmit({preventDefault(){},target:{querySelector:()=>button}});
 assert.equal(v.payloads[0].email,'teacher@outlook.com');assert(v.calls.at(-1).endsWith('action=email-login'));
 assert.equal(v.elements.get('teacher-signin-status').textContent,'Check your inbox.');assert.equal(button.disabled,false);
});

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../homepage-teachers.js'),'utf8');
async function view(user,denied=false,extraTeacher=false,confirmed=true,mailResult=null,accountResult=null,pagesResult={pages:[]}) {
 const elements=new Map(),events={},calls=[],warnings=[],payloads=[],redirects=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,replaceChildren(){this.items=[];},append(...items){this.items.push(...items);},reset(){},textContent:''});return elements.get(id);};
 vm.runInNewContext(source,{AbortSignal,FormData:class {constructor(form){return form.fields;}},location:{hash:'',replace:url=>redirects.push(url)},document:{getElementById:element,querySelectorAll:()=>[],createTextNode:text=>({textContent:text}),createElement:()=>({items:[],append(...items){this.items.push(...items);},setAttribute(){}})},window:{confirm:message=>{warnings.push(message);return confirmed;},addEventListener:(name,fn)=>events[name]=fn},fetch:async (url,options)=>{calls.push(url);if(url.includes('action=my-pages'))return {ok:!pagesResult.error,json:async()=>pagesResult};if(options?.method==='POST'){payloads.push(JSON.parse(options.body));if(mailResult && payloads.at(-1).operation==='welcome'){if(mailResult instanceof Error)throw mailResult;return {ok:true,json:async()=>({welcomeEmail:mailResult})};}extraTeacher=false;}return url.includes('quiz-account')?{ok:!!user || !!accountResult,json:async()=>options?.method==='POST' && accountResult?accountResult:user}:{ok:!denied,json:async()=>denied?{error:'Denied'}:{teachers:[{userId:1,name:'David',email:user.email},...(extraTeacher?[{userId:2,name:'Second Teacher',email:'second@example.org'}]:[])]}};}});
 await events.pageshow();return {elements,events,calls,warnings,payloads,redirects};
}
test('Homepage hides user management for visitors and all other accounts',async()=>{
 for(const user of [null,{userId:2,email:'teacher@example.org'},{userId:1,email:'other@example.org'}]) {
  const v=await view(user);assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.calls.length,user?2:1);
 }
});
test('Homepage preserves owner controls and reports protected directory failures',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const denied=await view(owner,true);assert.equal(denied.elements.get('teacher-numbers').hidden,false);
 assert.equal(denied.elements.get('teacher-number-status').textContent,'Denied');
 assert.equal(denied.elements.get('signed-in-account').hidden,false);
 assert.equal(denied.elements.get('your-webpages').hidden,false);
 const v=await view(owner);assert.equal(v.elements.get('teacher-numbers').hidden,false);assert.equal(v.elements.get('teacher-list').items.length,1);
 v.events.pagehide();assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.elements.get('teacher-list').items.length,0);
});


test('Delete user is offered only for other teachers, requires confirmation, and refreshes the list',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const cancelled=await view(owner,false,true,false);
 assert.equal(cancelled.elements.get('teacher-list').items[0].items.length,0);
 const cancelButton=cancelled.elements.get('teacher-list').items[1].items[0];
 assert.equal(cancelButton.textContent,'Delete user');await cancelButton.onclick();assert.equal(cancelled.calls.length,3);
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
 assert.equal(v.payloads[0].deleteWebpages,true);assert.equal(v.payloads[0].deleteQuizzes,true);assert.equal(v.payloads[0].confirmPermanentDeletion,true);
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




for(const result of [{status:'accepted'}, {status:'failed',error:'Email unavailable'}, new Error('Connection failed')]) {
 test('Resend button reports '+(result.status || 'connection failure')+' and allows retry without resetting edits',async()=>{
  const v=await view({userId:1,email:'disrael@saracademy.org'},false,true,true,result);
  const row=v.elements.get('teacher-list').items[1],button=row.items.find(item=>item.textContent==='Resend welcome email');
  const editor=row.items.find(item=>item.className==='user-app-access');editor.items[1].items[0].checked=false;
  const pending=button.onclick();assert.equal(button.disabled,true);assert.match(v.elements.get('teacher-number-status').textContent,/Sending/);
  await pending;assert.equal(button.disabled,false);
  assert.deepEqual(v.payloads[0],{operation:'welcome',userId:2,action:'teachers'});
  assert.equal(v.elements.get('teacher-list').items[1],row);assert.equal(editor.items[1].items[0].checked,false);
  assert.match(v.elements.get('teacher-number-status').textContent,result.status==='accepted'?/Welcome email sent/:result.status==='failed'?/Email unavailable/:/Connection failed/);
  await button.onclick();assert.equal(v.payloads.length,2);
 });
}

test('Pending first login shows only the password-change form after a page reload',async()=>{
 const v=await view({passwordChangeRequired:true});
 assert.equal(v.elements.get('password-change-panel').hidden,false);
 assert.equal(v.elements.get('teacher-signin').hidden,true);
 assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.calls.length,1);
});
test('Temporary password login requires matching new passwords before continuing home',async()=>{
 const v=await view(null,false,false,true,null,{passwordChangeRequired:true});
 v.elements.set('password-email',{value:'teacher@example.org'});v.elements.set('signin-password',{value:'temporary-password'});
 const button={disabled:false},event={preventDefault(){},target:{querySelector:()=>button}};
 await v.elements.get('password-signin-form').onsubmit(event);
 assert.equal(v.payloads[0].password,'temporary-password');assert(v.calls.at(-1).endsWith('action=password-login'));
 assert.equal(v.elements.get('signin-password').value,'');assert.equal(v.elements.get('password-change-panel').hidden,false);assert.equal(v.redirects.length,0);
 v.elements.set('new-password',{value:'My new long password!'});v.elements.set('confirm-password',{value:'different'});
 await v.elements.get('password-change-form').onsubmit(event);assert.match(v.elements.get('password-change-status').textContent,/do not match/);assert.equal(v.payloads.length,1);
 v.elements.get('confirm-password').value='My new long password!';await v.elements.get('password-change-form').onsubmit(event);
 assert(v.calls.at(-1).endsWith('action=password-change'));assert.deepEqual(v.redirects,['/']);assert.equal(button.disabled,false);
});

test('Signed-in users see their linked webpages below their apps and logout clears them',async()=>{
 const v=await view({userId:2,email:'second@example.org',apps:[]},false,false,true,null,null,{pages:[{name:'My class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=my-class'}]});
 assert.equal(v.elements.get('your-webpages').hidden,false);
 const link=v.elements.get('your-webpages-list').items[0].items[0];assert.equal(link.textContent,'My class');assert.equal(link.href,'/PeninaPlus-vocab-builder/flash-cards/?page=my-class');
 v.events.pagehide();assert.equal(v.elements.get('your-webpages').hidden,true);assert.equal(v.elements.get('your-webpages-list').items.length,0);
});
test('Webpages shows empty and failure states without hiding the signed-in account',async()=>{
 const user={userId:2,email:'second@example.org'};
 const empty=await view(user);assert.match(empty.elements.get('your-webpages-status').textContent,/haven’t published/);
 const failed=await view(user,false,false,true,null,null,{error:'Please retry'});assert.equal(failed.elements.get('your-webpages-status').textContent,'Please retry');assert.equal(failed.elements.get('signed-in-account').hidden,false);
});

 test('Directory failure preserves published links and provides a retry without clearing the account',async()=>{
 const v=await view({userId:1,email:'disrael@saracademy.org'},true,false,true,null,null,{pages:[{name:'Published class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=class'}]});
 assert.equal(v.elements.get('your-webpages-list').items[0].items[0].textContent,'Published class');
 await v.elements.get('teacher-retry').onclick();
 assert.equal(v.elements.get('teacher-number-status').textContent,'Denied');
 assert.equal(v.elements.get('signed-in-account').hidden,false);
 await v.elements.get('webpages-retry').onclick();
 assert.equal(v.elements.get('your-webpages-list').items.length,1);
 });

test('Refresh users shows immediate progress, prevents duplicate clicks, and confirms completion',async()=>{
 const v=await view({userId:1,email:'disrael@saracademy.org'}),button=v.elements.get('teacher-retry');
 const pending=button.onclick();assert.equal(button.disabled,true);assert.equal(button.textContent,'Refreshing users…');
 const count=v.calls.length;await button.onclick();assert.equal(v.calls.length,count);
 await pending;assert.equal(button.disabled,false);assert.match(v.elements.get('teacher-number-status').textContent,/User list refreshed/);
});
test('Assign user reports progress and failure beside the form and preserves entered details',async()=>{
 const v=await view({userId:1,email:'disrael@saracademy.org'},true);
 const button={disabled:false},fields=new URLSearchParams({userId:'2',name:'Teacher',email:'teacher@example.org'});
 let resets=0;
 const event={preventDefault(){},target:{fields,querySelector:()=>button,reset(){resets++;}}};
 const pending=v.elements.get('assign-teacher').onsubmit(event);
 assert.equal(button.textContent,'Adding user…');assert.match(v.elements.get('assign-teacher-status').textContent,/Adding user/);
 await pending;assert.equal(button.disabled,false);assert.equal(resets,0);assert.equal(v.elements.get('assign-teacher-status').textContent,'Denied');
});

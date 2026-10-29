const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/flash-cards/library.js'),'utf8');
function management(statuses,signedIn=true){
 let calls=0,signins=0,opened=0;const messages=[];
 const ctx={manageTrigger:{},management:{hidden:true},grade:'sixth',selectedForCombination:new Set(),render(){},teacherDialog:{showModal(){opened++;}},showMessage:async(...a)=>messages.push(a),signInForTeacherTools:async()=>{signins++;return signedIn;},fetch:async()=>{const status=statuses[calls++];return{status,ok:status===200,json:async()=>status===200?{}:{error:'Access denied'}};}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    async function enterManagementMode()'),source.indexOf('    async function setListVisibility(')),ctx);
 return{ctx,messages,get calls(){return calls;},get signins(){return signins;},get opened(){return opened;}};
}
test('Signed-out teacher signs in then reauthorizes and opens tools',async()=>{const h=management([401,200]);await h.ctx.enterManagementMode();assert.equal(h.calls,2);assert.equal(h.signins,1);assert.equal(h.opened,1);assert.equal(h.ctx.manageTrigger.disabled,false);});
test('Signed-in teacher opens tools without another sign-in',async()=>{const h=management([200]);await h.ctx.enterManagementMode();assert.equal(h.signins,0);assert.equal(h.opened,1);});
test('Cancelled sign-in leaves tools closed and the dot usable',async()=>{const h=management([401],false);await h.ctx.enterManagementMode();assert.equal(h.calls,1);assert.equal(h.opened,0);assert.equal(h.ctx.manageTrigger.disabled,false);});
test('Wrong account cannot open teacher tools',async()=>{for(const statuses of [[403],[401,403]]){const h=management(statuses);await h.ctx.enterManagementMode();assert.equal(h.opened,0);assert.equal(h.messages[0][1],'Access denied');}});
function signin(responses){
 const elements=new Map(),timers=[],calls=[];let closed=false;
 const el=key=>{if(!elements.has(key))elements.set(key,{value:'value',focus(){}});return elements.get(key);};
 el('form').elements={email:el('email'),password:el('password')};
 const popup={closed:false,location:{replace(url){popup.url=url;}},close(){this.closed=true;},focus(){}};
 const dialog={querySelector:el,setAttribute(){},addEventListener(){},showModal(){},close(){closed=true;},remove(){}};
 const ctx={document:{createElement:()=>dialog,body:{appendChild(){}}},window:{open:()=>popup},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},fetch:async(url,options)=>{calls.push({url,options});const data=responses.shift();return{ok:!data.error,json:async()=>data};}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    function signInForTeacherTools()'),source.indexOf('    async function enterManagementMode()')),ctx);
 return{ctx,el,popup,timers,calls,get closed(){return closed;}};
}
test('Password sign-in resolves successfully and clears the password',async()=>{const h=signin([{ok:true}]);const done=h.ctx.signInForTeacherTools();await h.el('form').onsubmit({preventDefault(){}});assert.equal(await done,true);assert.equal(h.el('password').value,'');assert.equal(h.closed,true);});
test('Invalid credentials leave the dialog open for retry',async()=>{const h=signin([{error:'Invalid password'}]);const done=h.ctx.signInForTeacherTools();await h.el('form').onsubmit({preventDefault(){}});assert.equal(h.closed,false);assert.equal(h.el('[role="status"]').textContent,'Invalid password');h.el('[data-cancel]').onclick();assert.equal(await done,false);});
test('Google popup completion uses the actual teacher endpoint shape and closes the popup',async()=>{const h=signin([{url:'https://accounts.google.com/example'},{userId:2,email:'teacher@example.com'}]);const done=h.ctx.signInForTeacherTools();await h.el('[data-google]').onclick();assert.equal(h.popup.url,'https://accounts.google.com/example');await h.timers.shift()();assert.equal(await done,true);assert.equal(h.popup.closed,true);});
test('First-time password sign-in waits for password change',async()=>{const h=signin([{passwordChangeRequired:true},{passwordChangeRequired:true},{userId:2}]);const done=h.ctx.signInForTeacherTools();await h.el('form').onsubmit({preventDefault(){}});assert.equal(h.closed,false);assert.equal(h.el('[data-google]').textContent,'Choose new password');await h.el('[data-google]').onclick();await h.timers.shift()();assert.equal(h.closed,false);await h.timers.shift()();assert.equal(await done,true);});

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function harness(){
 const blobs=new Map(),emails=[],state={active:true,mailOK:true,now:1800000000000};
 const account={seal:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),unseal:value=>JSON.parse(Buffer.from(value,'base64url').toString())};
 const teacher={userId:2,email:'teacher@outlook.com',name:'Teacher'};
 const env={RESEND_API_KEY:'test',QUIZ_EMAIL_FROM:'Penina <test@example.org>',BLOB_READ_WRITE_TOKEN:'test'};
 const ctx={module:{exports:{}},process:{env},Date:{now:()=>state.now},AbortSignal,fetch:async(url,options)=>{
  if(url==='https://api.resend.com/emails'){emails.push(JSON.parse(options.body));return {ok:state.mailOK};}
  return {ok:blobs.has(url),text:async()=>blobs.get(url)};
 },require:name=>name==='crypto'?crypto:name==='./quiz-teachers'?{registered:async email=>state.active && email===teacher.email?teacher:null}:{
  put:async(path,value,options)=>{assert.equal(options.allowOverwrite,false);if(state.storageFails)throw Error('Storage unavailable');if(blobs.has(path))throw Error('Exists');blobs.set(path,value);},
  list:async({prefix})=>({blobs:[...blobs.keys()].filter(path=>path.startsWith(prefix)).map(path=>({pathname:path,url:path}))})
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../lib/quiz-email-login'),'utf8'),ctx);
 return {...ctx.module.exports,account,blobs,emails,state,env,token:()=>emails[0].text.match(/#email-signin=(\S+)/)[1]};
}
test('Non-Google registered address receives an expiring link and a teacher identity',async()=>{
 const h=harness();await h.request({body:{email:' Teacher@Outlook.com '}},h.account);
 assert.deepEqual(h.emails[0].to,['teacher@outlook.com']);
 const identity=await h.verify({body:{token:h.token()}},h.account);
 assert.equal(identity.sub,'email:2');assert.equal(identity.userId,2);assert.equal(identity.authMethod,'email');
 await assert.rejects(h.verify({body:{token:h.token()}},h.account),e=>e.status===400 && /already been used/.test(e.message));
});
test('Request does not expose unregistered emails and limits repeated mail',async()=>{
 const h=harness(),known=await h.request({body:{email:'teacher@outlook.com'}},h.account);
 assert.deepEqual(await h.request({body:{email:'stranger@yahoo.com'}},h.account),known);
 await Promise.all(Array.from({length:5},()=>h.request({body:{email:'teacher@outlook.com'}},h.account)));
 assert.equal(h.emails.length,1);
 h.state.now+=300000;await h.request({body:{email:'teacher@outlook.com'}},h.account);assert.equal(h.emails.length,2);
});
test('Expired, malformed, wrong-purpose links and removed users cannot sign in',async()=>{
 const h=harness();await h.request({body:{email:'teacher@outlook.com'}},h.account);const token=h.token();
 for(const value of ['invalid',h.account.seal({kind:'session',exp:h.state.now+10000})])await assert.rejects(h.verify({body:{token:value}},h.account),e=>e.status===400);
 h.state.active=false;await assert.rejects(h.verify({body:{token}},h.account),e=>e.status===403);
 h.state.active=true;h.state.now+=600001;await assert.rejects(h.verify({body:{token}},h.account),e=>e.status===400);
});
test('Concurrent redemptions issue only one identity and storage errors fail closed',async()=>{
 const h=harness();await h.request({body:{email:'teacher@outlook.com'}},h.account);
 const results=await Promise.allSettled(Array.from({length:5},()=>h.verify({body:{token:h.token()}},h.account)));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const other=harness();other.state.storageFails=true;await assert.rejects(other.request({body:{email:'teacher@outlook.com'}},other.account));assert.equal(other.emails.length,0);
});
test('Existing Google identity is retained; configuration and mail failures are reported',async()=>{
 const h=harness();h.blobs.set('quiz-google/teachers/google-user.txt',h.account.seal({email:'teacher@outlook.com'}));
 await h.request({body:{email:'teacher@outlook.com'}},h.account);
 assert.equal((await h.verify({body:{token:h.token()}},h.account)).sub,'google-user');
 const other=harness();delete other.env.RESEND_API_KEY;await assert.rejects(other.request({body:{email:'teacher@outlook.com'}},other.account),e=>e.status===503);
 const failed=harness();failed.state.mailOK=false;await assert.rejects(failed.request({body:{email:'teacher@outlook.com'}},failed.account),e=>e.status===503);
 await assert.rejects(h.request({body:{email:'invalid'}},h.account),e=>e.status===400);
});

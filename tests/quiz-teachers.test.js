const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function harness(emailFails=false,pageDeletionFails=false){
 let beforePut=async()=>{};const etag=value=>crypto.createHash('sha256').update(value).digest('hex');const blobs=new Map(),emails=[],emailOptions=[],deletedOwners=[];const account={session:req=>({role:'teacher',userId:2,email:'second@example.org',authMethod:req.authMethod,sessionVersion:req.sessionVersion ?? emails[0]?.sessionVersion}),isAccountOwner:req=>req.headers?.cookie==='david',verifyTeacher:()=>false,seal:value=>Buffer.from(JSON.stringify(value)).toString('base64'),unseal:raw=>JSON.parse(Buffer.from(raw,'base64').toString())};
 const ctx={module:{exports:{}},Buffer,Response,fetch:async url=>({ok:blobs.has(url),text:async()=>blobs.get(url)}),require:n=>n==='crypto'?crypto:n==='./live-game'?{deleteOwnedGames:async()=>{}}:n==='./teacher-content'?{deleteOwnedQuizzes:async()=>{if(pageDeletionFails)throw Error('Quiz cleanup failed');}}:n==='./vocabulary-pages'?{listPages:async()=>[],deleteOwnedPages:async id=>{deletedOwners.push(id);if(pageDeletionFails)throw Error('Storage failed');return 2;}}:n==='./quiz-email-login'?{identity:async teacher=>({sub:'email:'+teacher.userId,email:teacher.email,userId:teacher.userId,role:'teacher',mustChangePassword:teacher.mustChangePassword,credentialVersion:teacher.credentialVersion})}:n==='./teacher-apps'?require('../lib/teacher-apps'):n==='./teacher-welcome-email'?{sendWelcome:async (teacher,options)=>{if(emailFails)throw Error('Email unavailable');emails.push(teacher);emailOptions.push(options);return {status:'accepted',to:teacher.email};}}:n==='./quiz-account'?account:{get:async(url,options)=>{assert.equal(options.useCache,false);const value=blobs.get(url);return value===undefined?null:{statusCode:200,stream:new Response(value).body,blob:{etag:etag(value)}};},list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p}))}),put:async(p,value,options)=>{await beforePut(value,options);if(options.ifMatch && options.ifMatch!==etag(blobs.get(p)||''))throw Object.assign(Error('Conflict'),{name:'BlobPreconditionFailedError'});if(blobs.has(p)&&!options.allowOverwrite)throw Error('exists');blobs.set(p,value);return {etag:etag(value)};}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../lib/quiz-teachers'),'utf8'),ctx);
 return {api:ctx.module.exports,blobs,emails,emailOptions,deletedOwners,setBeforePut:fn=>{beforePut=fn;},setPageDeletionFails:value=>{pageDeletionFails=value;},req:(body={},cookie='david')=>({method:'POST',headers:{cookie,origin:'https://www.penina-hebrew.org'},body:body.operation==='delete'?{confirmPermanentDeletion:true,...body}:body})};
}
const teacher={userId:2,name:'Second Teacher',email:'second@example.org',apps:['reader','vocabulary']};
test('Only signed-in David can allocate a number without an assignment password; records persist without exposing verifiers',async()=>{
 const h=harness();
 await assert.rejects(h.api.manage(h.req(teacher,'other')),e=>e.status===403);
 const cross=h.req(teacher);cross.headers.origin='https://other.example';await assert.rejects(h.api.manage(cross),e=>e.status===403);
 assert.equal(h.blobs.size,0);
 const result=await h.api.manage(h.req(teacher));assert.equal(result.teachers.length,2);assert.equal(result.teachers[0].name,'David Israel');
 assert(!JSON.stringify(result).includes('hash'));assert(!JSON.stringify(result).includes('private'));
 assert(![...h.blobs.values()][0].includes('second@example.org'));
 assert.equal(h.emails.length,1);assert.deepEqual(h.emails[0].apps,['reader','vocabulary']);
 assert.equal(await h.api.verify('wrong@example.org',teacher.password),null);assert.equal(await h.api.verify(teacher.email,'2-wrong'),null);
 await assert.rejects(h.api.manage(h.req({...teacher,email:'new@example.org'})),e=>e.status===409);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:3,password:'3-new'})),e=>e.status===409);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:1,password:'1-no'})),e=>e.status===400);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:3,email:'third@example.org',apps:['unknown']})),e=>e.status===400);
 const list=await h.api.manage({method:'GET',headers:{cookie:'david'}});assert.equal(list.teachers.length,2);
});

test('Registered Google emails resolve teacher numbers without passwords or verifier exposure',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 assert.equal((await h.api.registered('DISRAEL@saracademy.org')).userId,1);
 const result=await h.api.registered(teacher.email);assert.equal(result.userId,2);assert.equal(result.hash,undefined);assert.equal(result.salt,undefined);
 assert.equal(await h.api.registered('unknown@example.org'),null);
});


test('Only David can delete a teacher; administrator, stale selections and cross-site requests are protected',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const deletion={operation:'delete',userId:2,email:teacher.email};
 await assert.rejects(h.api.manage(h.req(deletion,'other')),e=>e.status===403);
 const cross=h.req(deletion);cross.headers.origin='https://other.example';
 await assert.rejects(h.api.manage(cross),e=>e.status===403);
 await assert.rejects(h.api.manage(h.req({...deletion,userId:1})),e=>e.status===400);
 await assert.rejects(h.api.manage(h.req({...deletion,email:'wrong@example.org'})),e=>e.status===409);
 assert.equal((await h.api.registered(teacher.email)).userId,2);
 const result=await h.api.manage(h.req(deletion));assert.equal(result.teachers.length,1);
 assert.equal(await h.api.registered(teacher.email),null);
 assert.equal(await h.api.verify(teacher.email,teacher.password),null);
 await assert.rejects(h.api.rejectDeletedSession({headers:{cookie:'__Host-penina-quiz-session=old'}}),e=>e.status===403);
 await h.api.manage(h.req({...teacher,email:'replacement@example.org'}));
 await assert.rejects(h.api.manage(h.req(deletion)),e=>e.status===409);
 assert.equal(h.blobs.size,1);
});


test('New users default to no apps; email failure keeps the user and allows owner-only retry',async()=>{
 const h=harness(true),result=await h.api.manage(h.req({...teacher,apps:[]}));
 assert.equal(result.welcomeEmail.status,'failed');assert.equal(result.teachers.length,2);
 assert.deepEqual((await h.api.registered(teacher.email)).apps,[]);
 await assert.rejects(h.api.manage(h.req({operation:'welcome',userId:2},'other')),e=>e.status===403);
 const retry=await h.api.manage(h.req({operation:'welcome',userId:2}));assert.equal(retry.welcomeEmail.status,'failed');assert.equal(h.blobs.size,1);
});


test('Webpage deletion requires explicit confirmation and only passes the selected teacher number',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const body={operation:'delete',userId:2,email:teacher.email,deleteWebpages:true,confirmPermanentDeletion:false};
 await assert.rejects(h.api.manage(h.req(body)),e=>e.status===400);
 assert.equal(h.deletedOwners.length,0);assert.equal((await h.api.registered(teacher.email)).userId,2);
 await assert.rejects(h.api.manage(h.req({...body,confirmPermanentDeletion:true},'other')),e=>e.status===403);
 await h.api.manage(h.req({...body,confirmPermanentDeletion:true}));
 assert.deepEqual(h.deletedOwners,[2]);assert.equal(await h.api.registered(teacher.email),null);
 const keep=harness();await keep.api.manage(keep.req(teacher));await keep.api.manage(keep.req({operation:'delete',userId:2,email:teacher.email}));assert.deepEqual(keep.deletedOwners,[2]);
});

test('Interrupted webpage cleanup blocks teacher access and stays retryable',async()=>{
 const h=harness(false,true);await h.api.manage(h.req(teacher));
 const body={operation:'delete',userId:2,email:teacher.email,deleteWebpages:true,confirmPermanentDeletion:true};
 await assert.rejects(h.api.manage(h.req(body)),e=>e.status===503 && /retry/i.test(e.message));
 assert.equal(await h.api.registered(teacher.email),null);
 await assert.rejects(h.api.rejectDeletedSession({headers:{cookie:'__Host-penina-quiz-session=old'}}),e=>e.status===403);
 const list=await h.api.manage({method:'GET',headers:{cookie:'david'}});assert.equal(list.teachers[1].deletingPages,true);
 await assert.rejects(h.api.manage(h.req({...body,deleteWebpages:false})),e=>e.status===503);
 h.setPageDeletionFails(false);const result=await h.api.manage(h.req(body));assert.equal(result.teachers.length,1);assert.deepEqual(h.deletedOwners,[2]);
});


test('Only the administrator can add and remove a user’s app grants, including removing all',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const request={operation:'access',userId:2,email:teacher.email,apps:['quizzes','binyan']};
 const before=h.blobs.get('quiz-teacher-numbers/2.txt');
 await assert.rejects(h.api.manage(h.req(request,'other')),e=>e.status===403);
 const foreign=h.req(request);foreign.headers.origin='https://other.example';await assert.rejects(h.api.manage(foreign),e=>e.status===403);
 await assert.rejects(h.api.manage(h.req({...request,userId:1})),e=>e.status===400);
 await assert.rejects(h.api.manage(h.req({...request,email:'wrong@example.org'})),e=>e.status===409);
 await assert.rejects(h.api.manage(h.req({...request,apps:['unknown']})),e=>e.status===400);
 assert.equal(h.blobs.get('quiz-teacher-numbers/2.txt'),before);
 const saved=await h.api.manage(h.req(request));assert.deepEqual(saved.teachers[1].apps,['binyan','quizzes']);
 const identity=await h.api.registered(teacher.email);assert.deepEqual(identity.apps,['binyan','quizzes']);assert.equal(identity.userId,2);assert.equal(identity.name,teacher.name);
 await h.api.manage(h.req({...request,apps:[]}));assert.deepEqual((await h.api.registered(teacher.email)).apps,[]);
 await h.api.manage(h.req({...request,apps:['reader']}));assert.deepEqual((await h.api.registered(teacher.email)).apps,['reader']);
 assert.equal(h.emails.length,1);
 await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email}));
 await assert.rejects(h.api.manage(h.req(request)),e=>e.status===404);
});


test('A stale access save cannot resurrect a user deleted by another request',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 let release,started;
 const blocked=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{started=resolve;});
 h.setBeforePut(async(value,options)=>{
  const record=JSON.parse(Buffer.from(value,'base64').toString());
  if(options.ifMatch && record.apps?.includes('quizzes')){started();await blocked;}
 });
 const save=h.api.manage(h.req({operation:'access',userId:2,email:teacher.email,apps:['quizzes']}));
 const rejected=assert.rejects(save,e=>e.status===409);
 await reached;await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email}));release();await rejected;
 assert.equal(await h.api.registered(teacher.email),null);
});

test('Welcome resend uses saved teacher details and requests a fresh delivery',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const result=await h.api.manage(h.req({operation:'welcome',userId:2,email:'wrong@example.org'}));
 assert.equal(result.welcomeEmail.status,'accepted');assert.equal(h.emails[1].email,teacher.email);assert.equal(h.emailOptions[1].resend,true);
 const cross=h.req({operation:'welcome',userId:2});cross.headers.origin='https://other.example';await assert.rejects(h.api.manage(cross),e=>e.status===403);
 await assert.rejects(h.api.manage(h.req({operation:'welcome',userId:999})),e=>e.status===404);
 assert.equal(h.emails.length,2);
});

test('Temporary password must be replaced, cannot be reused, and is removed after setup',async()=>{
 const h=harness();const result=await h.api.manage(h.req(teacher));
 const temporary=h.emails[0].temporaryPassword;assert(temporary.length>=24);assert(!JSON.stringify(result).includes(temporary));
 const login=await h.api.passwordLogin(teacher.email,temporary);assert.equal(login.mustChangePassword,true);
 await assert.rejects(h.api.changeInitialPassword(login,'short'),e=>e.status===400);
 await assert.rejects(h.api.changeInitialPassword(login,temporary),e=>e.status===400);
 await assert.rejects(h.api.changeInitialPassword({...login,credentialVersion:'stale'},'A new long password!'),e=>e.status===401);
 await h.api.manage(h.req({operation:'welcome',userId:2}));assert.equal(h.emails[1].temporaryPassword,temporary);
 await h.api.changeInitialPassword(login,'A new long password!');
 await assert.rejects(h.api.passwordLogin(teacher.email,temporary),e=>e.status===401);
 assert.equal((await h.api.passwordLogin(teacher.email,'A new long password!')).mustChangePassword,false);
 await assert.rejects(h.api.changeInitialPassword(login,'Another long password!'),e=>e.status===401);
 await h.api.manage(h.req({operation:'welcome',userId:2}));assert.equal(h.emails[2].temporaryPassword,undefined);
 assert.equal(h.emails[2].mustChangePassword,false);
});
test('Password sign-in throttles guessing and rejects deleted users',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 for(let i=0;i<10;i++)await assert.rejects(h.api.passwordLogin(teacher.email,'wrong'),e=>e.status===401);
 await assert.rejects(h.api.passwordLogin(teacher.email,h.emails[0].temporaryPassword),e=>e.status===429);
 const other=harness();await other.api.manage(other.req(teacher));const password=other.emails[0].temporaryPassword;
 await other.api.manage(other.req({operation:'delete',userId:2,email:teacher.email}));
 await assert.rejects(other.api.passwordLogin(teacher.email,password),e=>e.status===401);
});
test('Concurrent password setup consumes the temporary credential only once',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));const login=await h.api.passwordLogin(teacher.email,h.emails[0].temporaryPassword);
 const results=await Promise.allSettled([h.api.changeInitialPassword(login,'First long password!'),h.api.changeInitialPassword(login,'Second long password!')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('An older full session cannot bypass newly required password setup',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 await assert.rejects(h.api.rejectDeletedSession({headers:{cookie:'__Host-penina-quiz-session=old'}}),e=>e.status===403 && /temporary password/.test(e.message));
});

test('Google sign-in is exempt from Penina password setup but not deleted-account checks',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const req={authMethod:'google',headers:{cookie:'__Host-penina-quiz-session=google'}};
 await h.api.rejectDeletedSession(req);
 await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email}));
 await assert.rejects(h.api.rejectDeletedSession(req),e=>e.status===403 && /deleted/.test(e.message));
});

test('Mandatory cleanup frees the number and rejects old sessions',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 const oldVersion=h.emails[0].sessionVersion;
 await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email,deleteWebpages:true,deleteQuizzes:true,confirmPermanentDeletion:true}));
 await h.api.manage(h.req({...teacher,email:'replacement@example.org'}));
 assert.equal((await h.api.registered('replacement@example.org')).userId,2);
 assert.notEqual(h.emails[1].sessionVersion,oldVersion);
 await assert.rejects(h.api.rejectDeletedSession({authMethod:'google',sessionVersion:oldVersion,headers:{cookie:'__Host-penina-quiz-session=old'}}),e=>e.status===403);
});
test('Reusing the same email and number still revokes the former session',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));const version=h.emails[0].sessionVersion;
 await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email,deleteWebpages:true,deleteQuizzes:true,confirmPermanentDeletion:true}));
 await h.api.manage(h.req(teacher));
 await assert.rejects(h.api.rejectDeletedSession({authMethod:'google',sessionVersion:version,headers:{cookie:'__Host-penina-quiz-session=old'}}),e=>e.status===403);
 await h.api.rejectDeletedSession({authMethod:'google',sessionVersion:h.emails[1].sessionVersion,headers:{cookie:'__Host-penina-quiz-session=new'}});
});
test('Incomplete cleanup cannot release a number and concurrent reuse has one winner',async()=>{
 const h=harness(false,true);await h.api.manage(h.req(teacher));
 const deletion={operation:'delete',userId:2,email:teacher.email,deleteWebpages:true,deleteQuizzes:true,confirmPermanentDeletion:true};
 await assert.rejects(h.api.manage(h.req(deletion)),e=>e.status===503);
 await assert.rejects(h.api.manage(h.req({...teacher,email:'new@example.org'})),e=>e.status===409);
 h.setPageDeletionFails(false);await h.api.manage(h.req(deletion));
 const results=await Promise.allSettled(['one@example.org','two@example.org'].map(email=>h.api.manage(h.req({...teacher,email}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('Deletion ignores old keep-content flags and erases the stored identity',async()=>{
 const h=harness();await h.api.manage(h.req(teacher));
 await h.api.manage(h.req({operation:'delete',userId:2,email:teacher.email,deleteWebpages:false,deleteQuizzes:false}));
 assert.deepEqual(h.deletedOwners,[2]);
 const marker=JSON.parse(Buffer.from(h.blobs.get('quiz-teacher-numbers/2.txt'),'base64').toString());
 assert.deepEqual(marker,{userId:2,deleted:true,reusable:true});
 await h.api.manage(h.req(teacher));assert.equal((await h.api.registered(teacher.email)).userId,2);
});

for(const reusable of [false,true])test(`Legacy deleted identity can be cleaned and reused (reusable=${reusable})`,async()=>{
 const h=harness();
 const legacy={userId:2,email:'beta@penina-hebrew.org',deleted:true,reusable};
 h.blobs.set('quiz-teacher-numbers/2.txt',Buffer.from(JSON.stringify(legacy)).toString('base64'));
 const list=await h.api.manage({method:'GET',headers:{cookie:'david'}});
 assert.equal(list.teachers[1].email,legacy.email);assert.equal(list.teachers[1].deletingPages,true);
 assert.equal(await h.api.registered(legacy.email),null);
 await assert.rejects(h.api.manage(h.req({...teacher,email:legacy.email})),e=>e.status===409 && /cleanup is unfinished/.test(e.message));
 const deletion={operation:'delete',userId:2,email:legacy.email};
 await assert.rejects(h.api.manage(h.req({...deletion,email:'wrong@example.org'})),e=>e.status===409);
 h.setPageDeletionFails(true);
 await assert.rejects(h.api.manage(h.req(deletion)),e=>e.status===503);
 assert.equal((await h.api.manage({method:'GET',headers:{cookie:'david'}})).teachers.length,2);
 h.setPageDeletionFails(false);
 await h.api.manage(h.req(deletion));
 const marker=JSON.parse(Buffer.from(h.blobs.get('quiz-teacher-numbers/2.txt'),'base64').toString());
 assert.deepEqual(marker,{userId:2,deleted:true,reusable:true});
 assert.deepEqual(h.deletedOwners,[2]);
 await h.api.manage(h.req({...teacher,email:legacy.email}));
 assert.equal((await h.api.registered(legacy.email)).userId,2);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const model=require('../lib/quiz-builder-model');
function fixture(){return {title:'Hebrew review',durationMinutes:30,questions:[
 {type:'text',prompt:'Explain',points:2,allowHalfCredit:true,direction:'ltr',answer:'Model answer'},
 {type:'choice',prompt:'Pick one',points:1,choices:['A','B'],answer:['B']},
 {type:'multi',prompt:'Pick all',points:1,choices:['A','B','C'],answer:['A','C']},
 {type:'gaps',prompt:'___ and ___',points:2,choices:['א','ב'],answer:['א','א'],direction:'rtl'},
 {type:'order',prompt:'Order',points:1,choices:['א','ב'],answer:['ב','א'],direction:'rtl'}]};}
function harness(){
 const blobs=new Map(),cache=new Map(),state={enrolled:true,teacher:true,work:null,grade:null,reads:[],logs:[],delays:[]},ORIGIN='https://www.penina-hebrew.org';
 class OAuth2Client {setCredentials(){} generateAuthUrl(options){state.oauth=options;return 'https://accounts.google.com/test';}async getToken(){return {tokens:{id_token:'test',refresh_token:'test',scope:state.oauth.scope.join(' ')}};}async verifyIdToken(){return {getPayload:()=>({sub:'owner',name:'Teacher',email:'teacher@school.org',email_verified:true,nonce:state.oauth.nonce})};}async request({url,method,data,params={}}){
  if(url.endsWith(':turnIn')){state.turnInCalls=(state.turnInCalls || 0)+1;if(state.turnInFailure)throw {response:{status:503}};return {data:{}};}
  if(method==='PATCH' && params.updateMask==='maxPoints'){
   (state.pointsPatches ||= []).push({url,data,params});
   if(state.pointsFailure)throw {response:{status:403}};
   state.work={...state.work,...data};return {data:state.work};
  }
  if(method==='PATCH'){state.grade=data;return {data};}if(url.endsWith(':return'))return {data:{}};
  if(url.endsWith('/studentSubmissions'))return {data:{studentSubmissions:[{id:'submission',userId:'student',courseId:'course',courseWorkId:'work',associatedWithDeveloper:true,state:state.submissionState || 'TURNED_IN'}]}};
  if(url.endsWith('/courseWork/work'))return {data:{...state.work,state:state.draft?'DRAFT':'PUBLISHED',maxPoints:state.work.maxPoints}};
  if(url.endsWith('/courseWork')){if(method==='POST'){state.work={...data,id:'work',associatedWithDeveloper:true};return {data:state.work};}return {data:{courseWork:state.work?[state.work]:[]}};}
  if(url.includes('/teachers/')){if(!state.teacher || !url.endsWith('/owner'))throw {response:{status:404}};return {data:{userId:'owner'}};}
  if(url.endsWith('/students')){if(state.rosterFailure)throw {response:{status:403}};const students=[{userId:'student',profile:{name:{fullName:'Alex Student'}}},{userId:'student2',profile:{name:{fullName:'Blair Student'}}},{userId:'student3',profile:{name:{fullName:'Casey Student'}}}];return {data:params.pageToken?{students:students.slice(2)}:{students:students.slice(0,2),nextPageToken:'next'}};}
  if(url.includes('/students/')){if(!state.enrolled)throw {response:{status:404}};return {data:{userId:url.split('/').pop()}};}
  return {data:{id:'course',name:'Test class',courseState:'ACTIVE'}};
 }}
 function load(name){if(cache.has(name))return cache.get(name).exports;const module={exports:{}};cache.set(name,module);const context={module,exports:module.exports,Date:class extends Date {static now(){return state.now ?? Date.now();}},console:{...console,warn:(...args)=>state.logs.push(args),error:(...args)=>state.logs.push(args)},AbortSignal,URL,URLSearchParams,Buffer,__dirname:path.join(__dirname,'../lib'),process:{env:{BLOB_READ_WRITE_TOKEN:'test',GOOGLE_CLASSROOM_CLIENT_ID:'test',GOOGLE_CLASSROOM_CLIENT_SECRET:'test'}},fetch:async (url,options)=>{state.reads.push(url);if(state.readFailure){const response=state.readFailure(url,options);if(response)return response;}return {ok:blobs.has(url),status:blobs.has(url)?200:404,text:async()=>blobs.get(url)};},require:n=>{
   if(n==='node:timers/promises')return {setTimeout:async ms=>state.delays.push(ms)};
   if(n==='./openai-text')return {generateOpenAIText:async(...args)=>{if(!state.aiGenerator)throw Error('No test AI response configured');return state.aiGenerator(...args);}};
   if(n==='./quiz-correction-email')return {sendCorrectedTest:async data=>{state.emailed=data;if(state.emailFailure)throw Error('Email failed');return {status:'accepted',to:data.record.email};}};
   if(n==='google-auth-library')return {OAuth2Client};
   if(n==='@vercel/blob')return {list:async({prefix,cursor,limit})=>{if(state.listFailure)state.listFailure(prefix);const found=[...blobs.keys()].filter(p=>p.startsWith(prefix)),start=Number(cursor)||0,size=Math.min(limit,state.pageSize || limit);return {blobs:found.slice(start,start+size).map(p=>({pathname:p,url:p})),hasMore:start+size<found.length,cursor:String(start+size)};},put:async(p,s,o)=>{if(!o.allowOverwrite&&blobs.has(p))throw Error('exists');blobs.set(p,s);},del:async p=>blobs.delete(p)};
   if(n==='./vocabulary-pages')return {getPage:async()=>({}),authenticatePage:(_,pw)=>pw==='secret'?null:{status:401,error:'Bad password'}};
   if(n.startsWith('./quiz-'))return load(n.slice(2));return require(n);
 }};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.js'),'utf8'),context);return module.exports;}
 const account=load('quiz-account'),builder=load('quiz-builder'),submissions=load('quiz-custom-submissions');
 blobs.set('quiz-google/teachers/owner.txt',account.seal({refreshToken:'test'}));
 function req(body={},user='owner',query={}){return {method:'POST',query,body,headers:{origin:ORIGIN,cookie:'__Host-penina-quiz-session='+account.seal({kind:'session',sub:user,role:user.startsWith('student')?'student':'teacher',name:user,email:user+'@school.org',exp:Date.now()+86400000})}};}
 async function call(handler,request){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=JSON.parse(JSON.stringify(data));return this;},end(){return this;}};await handler(request,res);return res;}
 async function publish(quiz=fixture()){const saved=await call(builder.handle,req({action:'save',quiz}));assert.equal(saved.code,200);const id=saved.data.quiz.id;assert.equal((await call(builder.handle,req({action:'publish',id}))).code,200);return id;}
 return {blobs,account,builder,submissions,state,req,call,publish,storage:load('quiz-submission-storage')};
}
test('All five types validate; blank count, answer keys, duplicates and scores are enforced',()=>{
 assert.equal(model.validateQuiz(fixture(),true).questions.length,5);
 for(const mutate of [q=>q.questions[1].answer=['Z'],q=>q.questions[3].prompt='Only ___',q=>q.questions[4].answer=['א','א'],q=>q.questions[1].choices=['A','A'],q=>q.questions[0].points=-1,q=>q.durationMinutes=0]){const q=fixture();mutate(q);assert.throws(()=>model.validateQuiz(q,true));}
 assert.throws(()=>model.validateQuiz({title:'Draft',durationMinutes:30,questions:[]},true));
});
test('Automatic grading is exact; repeated gap answers work; written marks remain pending',()=>{
 const q=fixture(),answers=[['explanation'],['B'],['C','A'],['א','א'],['ב','א']];
 assert(model.validAnswers(q,answers));const g=model.grade(q,answers);assert.equal(g.automaticScore,5);assert.equal(g.total,null);assert.equal(g.pending,1);
 assert.equal(model.grade(q,answers,{scores:[1.5]}).total,6.5);answers[2]=['A','A'];assert(!model.validAnswers(q,answers));assert.equal(model.grade(q,answers).automaticScore,4);
 assert(model.validCorrections(q,[3]));assert(!JSON.stringify(model.publicQuestions(q)).includes('answer'));
});
test('Drafts require a teacher, same origin, stay owner scoped and are encrypted at rest',async()=>{
 const h=harness();assert.equal((await h.call(h.builder.handle,h.req({action:'save',quiz:fixture()},'student'))).code,403);
 const cross=h.req({action:'save',quiz:fixture()});cross.headers.origin='https://other.example';assert.equal((await h.call(h.builder.handle,cross)).code,403);
 const s=await h.call(h.builder.handle,h.req({action:'save',quiz:fixture()}));assert.equal(s.code,200);assert(![...h.blobs.values()].some(v=>v.includes('Model answer')));
 assert.equal((await h.call(h.builder.handle,h.req({action:'load',id:s.data.quiz.id},'other'))).code,404);
 assert.equal((await h.call(h.builder.handle,h.req({action:'list'},'other'))).data.quizzes.length,0);
});
test('Published snapshots cannot be edited; retries keep the same snapshot',async()=>{
 const h=harness(),id=await h.publish();const q=fixture();q.title='Changed';assert.equal((await h.call(h.builder.handle,h.req({action:'save',id,quiz:q}))).code,409);
 assert.equal((await h.call(h.builder.handle,h.req({action:'publish',id}))).code,200);assert.equal((await h.builder.published(id)).title,'Hebrew review');
});
test('Custom assignment and student access preserve quiz and class IDs, hide keys, deny outsiders',async()=>{
 const h=harness(),id=await h.publish();assert.equal((await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id},'other'))).code,403);
 const assigned=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));assert.equal(assigned.code,200);const url=new URL(assigned.data.url);assert.equal(url.searchParams.get('quiz'),id);assert(url.searchParams.get('class'));assert.equal(h.state.work.maxPoints,7);
 const request=h.req({},'student',{action:'student',quiz:id,classId:url.searchParams.get('class')});request.method='GET';const student=await h.call(h.account.handle,request);assert.equal(student.code,200);assert.equal(student.data.durationMinutes,30);assert(!JSON.stringify(student.data.questions).includes('answer'));
 h.state.enrolled=false;assert.equal((await h.call(h.account.handle,request)).code,403);
});
test('Custom attempts submit once, grade, restrict reports, and transfer teacher corrections',async()=>{
 const h=harness(),id=await h.publish();const assigned=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));const classId=new URL(assigned.data.url).searchParams.get('class'),attemptId='a'.repeat(32);
 const start=await h.call(h.submissions,h.req({action:'start',id:attemptId,classId,quiz:id},'student'));assert.equal(start.code,200);assert(start.data.deadline>Date.now()+29*60000);
 const body={action:'submit',id:attemptId,classId,quiz:id,token:start.data.token,answers:[['answer'],['B'],['A','C'],['א','א'],['ב','א']]};
 const accepted=await h.call(h.submissions,h.req(body,'student'));assert.equal(accepted.code,200);assert.deepEqual(accepted.data.automatic[0].correctAnswers,fixture().questions[1].answer);assert.equal((await h.call(h.submissions,h.req(body,'student'))).code,200);
 assert.equal((await h.call(h.submissions,h.req({action:'start',id:'b'.repeat(32),classId,quiz:id},'student'))).code,409);
 assert.equal((await h.call(h.submissions,h.req({action:'report',quiz:id},'other'))).code,403);
 const report=await h.call(h.submissions,h.req({action:'report',quiz:id}));assert.equal(report.code,200);assert.equal(report.data.submissions.length,1);assert.equal(report.data.submissions[0].grading.pending,1);
 const corrected=await h.call(h.submissions,h.req({action:'correct',quiz:id,id:attemptId,scores:[2],feedback:'Well done',sendToClassroom:true}));assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,7);assert.equal(corrected.data.classroom.score,7);assert.equal(h.state.grade.draftGrade,7);
});
test('Builder Google sign-in returns to editor and custom student sign-in returns to its quiz',async()=>{
 const h=harness();const login=await h.call(h.account.handle,h.req({action:'login',role:'teacher',password:'secret',builder:true}));assert.equal(login.code,200);
 const request=h.req({},'owner',{action:'callback',state:h.state.oauth.state,code:'code'});request.method='GET';request.headers.cookie=login.headers['Set-Cookie'].split(';')[0];const result=await h.call(h.account.handle,request);assert.equal(result.code,303);assert.equal(result.headers.Location,'/Penina-Quizzes/builder/');
 const id=await h.publish(),studentLogin=await h.call(h.account.handle,h.req({action:'login',quiz:id,role:'student',classId:'c'.repeat(32)},'student'));
 request.query={action:'callback',state:h.state.oauth.state,code:'code'};request.headers.cookie=studentLogin.headers['Set-Cookie'].split(';')[0];const returned=await h.call(h.account.handle,request);assert.equal(returned.code,303);assert.equal(new URL(returned.headers.Location,'https://www.penina-hebrew.org').searchParams.get('class'),'c'.repeat(32));assert(returned.headers.Location.includes('quiz='+id));
});
async function assigned(h,quiz=fixture()){
 const id=await h.publish(quiz),r=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));assert.equal(r.code,200);return {quiz:id,classId:new URL(r.data.url).searchParams.get('class')};
}
const correctAnswers=()=>[['answer'],['B'],['A','C'],['א','א'],['ב','א']];
async function resumableAttempt(){
 const h=harness(),link=await assigned(h),id='a'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 assert.equal(start.code,200);
 const request=h.req({...link,action:'start',id:'b'.repeat(32)},'student');
 request.headers['x-vercel-id']='iad1::quiz-request';
 return {h,link,start,request};
}
for(const status of [408,429,500,502,503,504])test('Quiz attempts recover from temporary storage HTTP '+status,async()=>{
 const {h,start,request}=await resumableAttempt();let reads=0;
 h.state.readFailure=(url,options)=>{
  if(!url.startsWith('quiz-attempts/'))return;
  assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);
  if(++reads===1)return {ok:false,status,headers:new Headers({'x-vercel-id':'blob-request'})};
 };
 const result=await h.call(h.submissions,request);
 assert.equal(result.code,200);assert.equal(result.data.id,start.data.id);assert.equal(result.data.deadline,start.data.deadline);
 assert.equal(reads,2);assert.equal(h.state.delays.length,1);
 const log=h.state.logs[0][1];assert.equal(log.operation,'read-record');assert.equal(log.storageStatus,status);
 assert.equal(log.requestId,'iad1::quiz-request');assert.equal(log.storageRequestId,'blob-request');assert.equal(log.attempts,1);
});
for(const kind of ['network','timeout','body'])test('Quiz reads recover from a temporary '+kind+' failure',async()=>{
 const {h,start,request}=await resumableAttempt();let reads=0;
 h.state.readFailure=url=>{
  if(!url.startsWith('quiz-attempts/') || ++reads!==1)return;
  if(kind==='timeout')throw Object.assign(Error('Timed out'),{name:'TimeoutError'});
  if(kind==='body')return {ok:true,status:200,text:async()=>{throw TypeError('terminated');}};
  throw Object.assign(TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});
 };
 const result=await h.call(h.submissions,request);assert.equal(result.code,200);assert.equal(result.data.id,start.data.id);assert.equal(reads,2);
});
test('Exhausted reads stop after three attempts, keep the saved attempt, and log safe diagnostics',async()=>{
 const {h,request}=await resumableAttempt(),before=[...h.blobs];let reads=0;
 h.state.readFailure=url=>{if(url.startsWith('quiz-attempts/')){reads++;return {ok:false,status:503,headers:new Headers({'x-request-id':'storage-request'})};}};
 const result=await h.call(h.submissions,request);assert.equal(result.code,503);assert.equal(reads,3);assert.equal(h.state.delays.length,2);
 assert.deepEqual([...h.blobs],before);assert(h.state.delays[0]>=150 && h.state.delays[0]<250);assert(h.state.delays[1]>=300 && h.state.delays[1]<400);
 const log=h.state.logs.at(-1)[1];assert.equal(log.operation,'read-record');assert.equal(log.storageStatus,503);assert.equal(log.attempts,3);assert.equal(log.requestId,'iad1::quiz-request');
 const serialized=JSON.stringify(h.state.logs);assert(!serialized.includes('student@school.org'));assert(!serialized.includes(request.headers.cookie));assert(!serialized.includes('quiz-attempts/'));
 assert.match(result.data.error,/answers are still available/);assert(!JSON.stringify(result.data).includes('storage-request'));
});
for(const status of [400,401,403,404])test('Permanent storage HTTP '+status+' errors are not retried or treated as missing records',async()=>{
 const {h,request}=await resumableAttempt();let reads=0;
 h.state.readFailure=url=>{if(url.startsWith('quiz-attempts/')){reads++;return {ok:false,status};}};
 const result=await h.call(h.submissions,request);assert.equal(result.code,503);assert.equal(reads,1);assert.equal(h.state.delays.length,0);assert.equal(h.state.logs.at(-1)[1].storageStatus,status);
});
test('Corrupt records fail closed without retrying decryption',async()=>{
 const {h,request}=await resumableAttempt();let reads=0;
 h.state.readFailure=url=>{if(url.startsWith('quiz-attempts/')){reads++;return {ok:true,status:200,text:async()=>'{broken'};}};
 assert.equal((await h.call(h.submissions,request)).code,503);assert.equal(reads,1);assert.equal(h.state.delays.length,0);
 assert.equal(h.state.logs.at(-1)[1].operation,'decrypt-record');assert.equal(h.state.logs.at(-1)[1].storageStatus,200);
});
test('A timeout while consuming the response body retries the whole read',async()=>{
 const {h,request}=await resumableAttempt();let reads=0;
 h.state.readFailure=(url,options)=>{
  if(!url.startsWith('quiz-attempts/') || ++reads!==1)return;
  return {ok:true,status:200,text:async()=>{
   Object.defineProperty(options.signal,'aborted',{value:true});
   throw Object.assign(Error('The operation was aborted'),{name:'AbortError'});
  }};
 };
 assert.equal((await h.call(h.submissions,request)).code,200);assert.equal(reads,2);
});
test('List failures retain SDK retry handling and include the request and operation in the log',async()=>{
 const {h,request}=await resumableAttempt();let lists=0;
 h.state.listFailure=prefix=>{if(prefix.startsWith('quiz-submissions/')){lists++;throw new class BlobServiceNotAvailable extends Error {}();}};
 assert.equal((await h.call(h.submissions,request)).code,503);assert.equal(lists,1);
 const log=h.state.logs.at(-1)[1];assert.equal(log.operation,'list-records');assert.equal(log.storageStatus,503);assert.equal(log.requestId,'iad1::quiz-request');
});
test('Published quiz loading failures are logged even before the submission handler starts',async()=>{
 const {h,request}=await resumableAttempt();h.state.listFailure=prefix=>{if(prefix.startsWith('quiz-builder/published/'))throw Object.assign(Error('storage unavailable'),{statusCode:503});};
 assert.equal((await h.call(h.submissions,request)).code,503);
 const log=h.state.logs.at(-1)[1];assert.equal(log.operation,'load-published-quiz');assert.equal(log.storageStatus,503);assert.equal(log.requestId,'iad1::quiz-request');
});
test('Paginated reports retain all submissions once when one record download is retried',async()=>{
 const h=harness(),link=await assigned(h);
 for(const [user,char] of [['student','a'],['student2','b'],['student3','c']]){
  const id=char.repeat(32),start=await h.call(h.submissions,h.req({...link,action:'start',id},user));
  assert.equal((await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},user))).code,200);
 }
 h.state.pageSize=1;let failed=false;
 h.state.readFailure=url=>{if(url.startsWith('quiz-submissions/') && !failed){failed=true;return {ok:false,status:502};}};
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.code,200);assert.equal(report.data.submissions.length,3);
 assert.equal(new Set(report.data.submissions.map(r=>r.id)).size,3);assert.equal(h.state.delays.length,1);
});
test('Unlimited duration and valid checkpoint positions survive validation; invalid values fail',()=>{
 const q=fixture();q.durationMinutes=null;q.forwardOnlyFrom=2;q.checkpointMessage='Review now.';const value=model.validateQuiz(q,true);assert.equal(value.durationMinutes,null);assert.equal(value.forwardOnlyFrom,2);
 for(const from of [0,5,-1,1.5,'2'])assert.throws(()=>model.validateQuiz({...q,forwardOnlyFrom:from},true));
 assert.throws(()=>model.validateQuiz({...q,checkpointMessage:''},true));assert.throws(()=>model.validateQuiz({...q,durationMinutes:0},true));
});
test('Unlimited attempts have no deadline and do not expire; timer expires only timed quizzes',async()=>{
 const h=harness(),q=fixture();q.durationMinutes=null;const link=await assigned(h,q),id='a'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));assert.equal(start.data.deadline,null);
 h.state.now=Date.now()+12*3600000;
 const submit=await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));assert.equal(submit.code,200);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.submissions[0].deadline,null);assert.equal(report.data.submissions[0].expired,false);
});
test('Checkpoint is required, locks earlier answers, resumes progress, and prevents skipping or overwriting',async()=>{
 const h=harness(),q=fixture();q.forwardOnlyFrom=2;q.durationMinutes=null;const link=await assigned(h,q),id='b'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student')),token=start.data.token;
 const request=(body,user='student')=>h.call(h.submissions,h.req({...link,id,token,...body},user));
 assert.equal((await request({action:'submit',answers:correctAnswers()})).code,409);
 assert.equal((await request({action:'advance',through:3,answers:correctAnswers()})).code,409);
 const missing=correctAnswers();missing[0]=[''];assert.equal((await request({action:'advance',through:1,answers:missing})).code,400);
 const checkpoint=await request({action:'advance',through:1,answers:correctAnswers()});assert.equal(checkpoint.code,200);assert.equal(checkpoint.data.lockedThrough,1);assert.equal(checkpoint.data.forwardOnly,true);
 const restored=await request({action:'state'});assert.deepEqual(restored.data.lockedAnswers,correctAnswers().slice(0,2));
 const changed=correctAnswers();changed[1]=['A'];const retry=await request({action:'advance',through:1,answers:changed});assert.equal(retry.code,200);assert.deepEqual(retry.data.lockedAnswers[1],['B']);
 assert.equal((await request({action:'state'},'student2')).code,400);
 for(let through=2;through<5;through++)assert.equal((await request({action:'advance',through,answers:changed})).code,200);
 const submitted=await request({action:'submit',answers:changed});assert.equal(submitted.code,200);assert.deepEqual(submitted.data.answers[1],['B']);
 assert.equal((await request({action:'submit',answers:changed})).code,200);
});
test('Timed expiry accepts unfinished checkpoint quizzes but refuses further forward steps',async()=>{
 const h=harness(),q=fixture();q.durationMinutes=1;q.forwardOnlyFrom=2;const link=await assigned(h,q),id='c'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));h.state.now=start.data.deadline+1;
 const body={...link,id,token:start.data.token};assert.equal((await h.call(h.submissions,h.req({...body,action:'advance',through:1,answers:correctAnswers()},'student'))).code,409);
 const answers=[[''],[''],[],['',''],['','']];const result=await h.call(h.submissions,h.req({...body,action:'submit',answers},'student'));assert.equal(result.code,200);
});
test('Question summaries separate full credit, zero, partial and pending with an explicit submission denominator',()=>{
 const q=fixture(),a=correctAnswers(),wrong=correctAnswers();wrong[1]=['A'];
 const records=[{grading:model.grade(q,a,{scores:[2]})},{grading:model.grade(q,wrong,{scores:[1]})},{grading:model.grade(q,a)}];
 const summary=model.summarize(q,records);assert.deepEqual({...summary[0].percentages},{correct:33.3,incorrect:0,partial:33.3,pending:33.3});assert.equal(summary[1].correct,2);assert.equal(summary[1].incorrect,1);assert.equal(summary[1].percentages.correct,66.7);
 assert.equal(model.summarize(q,[])[0].percentages.correct,null);
});
test('Full paginated class roster shows not started, in progress and submitted; practice is excluded',async()=>{
 const h=harness(),link=await assigned(h),id='d'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 await h.call(h.submissions,h.req({...link,action:'start',id:'e'.repeat(32)},'student2'));
 await h.call(h.submissions,h.req({...link,action:'start',id:'f'.repeat(32)},'owner'));
 const report=await h.call(h.submissions,h.req({...link,action:'report',courseId:'course'}));assert.equal(report.code,200);assert.equal(report.data.roster.students.length,3);assert.deepEqual(report.data.roster.students.map(s=>s.status),['submitted','in-progress','not-started']);assert.equal(report.data.summary[0].total,1);
 h.state.now=Date.now()+31*60000;
 const expired=await h.call(h.submissions,h.req({...link,action:'report',courseId:'course'}));assert.equal(expired.data.roster.students[1].status,'expired');
 h.state.rosterFailure=true;const failed=await h.call(h.submissions,h.req({...link,action:'report',courseId:'course'}));assert.equal(failed.code,503);assert.equal(failed.data.roster,undefined);
});
test('Roster and summaries are class scoped and reject a teacher removed from the class',async()=>{
 const h=harness(),link=await assigned(h),id='1'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 const other=await h.call(h.submissions,h.req({...link,action:'report',courseId:'other-course'}));assert.equal(other.code,200);assert.equal(other.data.submissions.length,0);assert.equal(other.data.roster.assigned,false);assert(other.data.roster.students.every(s=>s.status==='not-assigned'));assert.equal(other.data.summary[0].total,0);
 h.state.teacher=false;assert.equal((await h.call(h.submissions,h.req({...link,action:'report',courseId:'course'}))).code,403);
});

test('Half credit is opt-in per question and enforced for point values and teacher marks',async()=>{
 const quiz=fixture();delete quiz.questions[0].allowHalfCredit;
 const normalized=model.validateQuiz(quiz,true);assert.equal(normalized.questions[0].allowHalfCredit,false);
 assert(!model.validCorrections(normalized,[0.5]));assert(model.validCorrections(normalized,[1]));
 quiz.questions[0].points=1.5;assert.throws(()=>model.validateQuiz(quiz,true),/Allow half credit/);
 quiz.questions[0].allowHalfCredit=true;const half=model.validateQuiz(quiz,true);assert.equal(half.questions[0].points,1.5);assert(model.validCorrections(half,[0.5]));assert(!model.validCorrections(half,[0.25]));
 const h=harness();const saved=await h.call(h.builder.handle,h.req({action:'save',quiz:half}));assert.equal(saved.code,200);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:saved.data.quiz.id}));assert.equal(loaded.data.quiz.questions[0].allowHalfCredit,true);
 const whole=fixture();whole.questions[0].allowHalfCredit=false;const link=await assigned(h,whole),id='9'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 assert.equal((await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[0.5],feedback:''}))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[1],feedback:''}))).code,200);
});

test('Per-response scoring gives each correct blank its configured points; total mode remains all-or-nothing',()=>{
 const question={type:'gaps',prompt:'___ then ___ then ___',points:1,choices:['A','B','C'],answer:['A','B','C'],scoringMode:'response'};
 const q={title:'Blanks',durationMinutes:null,questions:[question]};
 const validated=model.validateQuiz(q,true);assert.equal(model.maxPoints(validated.questions[0]),3);
 assert.equal(model.grade(validated,[['A','C','C']]).total,2);assert.equal(model.grade(validated,[['A','C','C']]).baseMax,3);
 assert.equal(model.grade({...validated,questions:[{...question,scoringMode:'total'}]},[['A','C','C']]).total,0);
 assert.equal(model.grade({...validated,questions:[{...question,scoringMode:'total'}]},[['A','B','C']]).total,1);
 const half={...question,points:0.5,allowHalfCredit:true};assert.equal(model.grade({...q,questions:[half]},[['A','C','C']]).total,1);
 assert.equal(model.publicQuestions(validated)[0].maxPoints,3);assert.equal(model.publicQuestions(validated)[0].answer,undefined);
 assert.throws(()=>model.validateQuiz({...q,questions:[{...question,scoringMode:'invalid'}]},true));
});
test('Ordering earns points per correct position; multiple answers require an exact correct set',()=>{
 const q=fixture();q.questions.forEach(item=>item.scoringMode='response');
 const answers=correctAnswers();answers[2]=['A','B'];answers[4]=['א','ב'];
 const graded=model.grade(q,answers,{scores:[2]});assert.equal(graded.baseMax,11);assert.equal(graded.total,7);assert.equal(graded.automatic.find(v=>v.index===2).score,0);
 answers[2]=['A','B','C'];assert(model.validAnswers(q,answers));assert.equal(model.grade(q,answers).automatic.find(v=>v.index===2).score,0);
 answers[2]=['A'];assert(model.validAnswers(q,answers));assert(model.validAnswers(q,answers,true));
 const order={type:'order',prompt:'Order',points:2,scoringMode:'response',choices:['A','B','C'],answer:['A','B','C']};assert.equal(model.grade({questions:[order]},[['A','C','B']]).total,0);
});
test('Per-response maxima persist through publishing, student data, reports and Classroom grades',async()=>{
 const h=harness(),q=fixture();q.questions.forEach(item=>item.scoringMode='response');const link=await assigned(h,q);assert.equal(h.state.work.maxPoints,11);
 const request=h.req({},'student',{action:'student',quiz:link.quiz,classId:link.classId});request.method='GET';const student=await h.call(h.account.handle,request);assert.equal(student.data.questions[3].maxPoints,4);
 const id='8'.repeat(32),start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 const answers=correctAnswers();answers[3]=['א','ב'];const submitted=await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers},'student'));assert.equal(submitted.code,200);assert.equal(submitted.data.automatic.find(q=>q.index===3).partial,true);
 const result=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[2],feedback:'',sendToClassroom:true}));assert.equal(result.data.grading.total,9);assert.equal(result.data.classroom.maxPoints,11);assert.equal(h.state.grade.draftGrade,9);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.summary[3].partial,1);
});

test('Custom automatic overrides preserve answers, enforce increments, update summary and Classroom',async()=>{
 const h=harness(),link=await assigned(h),id='a'.repeat(32),answers=correctAnswers();answers[1]=['A'];
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 assert.equal((await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers},'student'))).code,200);
 const body={...link,id,action:'correct',scores:[2],overrides:{1:1},feedback:'Corrected key error',sendToClassroom:true};
 assert.equal((await h.call(h.submissions,h.req(body,'student'))).code,403);
 for(const overrides of [{1:0.5},{1:-1},{0:1},{999:1},null,[]])assert.equal((await h.call(h.submissions,h.req({...body,overrides}))).code,400);
 const saved=await h.call(h.submissions,h.req(body));assert.equal(saved.code,200);assert.equal(saved.data.grading.total,7);assert.equal(h.state.grade.draftGrade,7);
 const report=await h.call(h.submissions,h.req({...link,action:'report'})),record=report.data.submissions[0];
 assert.deepEqual(record.answers,answers);assert.equal(record.grading.automatic[0].originalScore,0);assert.equal(record.grading.automatic[0].score,1);assert.equal(record.grading.automatic[0].overridden,true);
 assert.equal(model.summarize(fixture(),[record])[1].correct,1);
 const restored=await h.call(h.submissions,h.req({...body,overrides:{}}));assert.equal(restored.data.grading.total,6);
 const quiz=fixture();quiz.questions[1].allowHalfCredit=true;
 assert.equal(model.validOverrides({1:0.5},model.grade(quiz,answers).automatic),true);
});

test('Email returns saved teacher overrides and explanations only to the submitting student',async()=>{
 const h=harness(),link=await assigned(h),id='e'.repeat(32),answers=correctAnswers();answers[1]=['A'];
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers},'student'));
 const body={...link,id,action:'correct',scores:[2],overrides:{1:1},explanations:{0:'Revised written answer mark: your reasoning earns full credit.',1:'The answer key was wrong; you earned full credit.'},feedback:'Good work',emailStudent:true,email:'attacker@example.org'};
 assert.equal((await h.call(h.submissions,h.req(body,'student2'))).code,403);assert.equal(h.state.emailed,undefined);
 assert.equal((await h.call(h.submissions,h.req({...body,scores:[null]}))).code,400);assert.equal(h.state.emailed,undefined);
 for(const explanations of [{1:'x'.repeat(2001)},{999:'wrong'},[],null])assert.equal((await h.call(h.submissions,h.req({...body,explanations}))).code,400);
 assert.equal((await h.call(h.submissions,h.req(body))).code,409);assert.equal(h.state.emailed,undefined);
 const draft=await h.call(h.submissions,h.req({...body,emailStudent:false,sendToClassroom:true}));assert.equal(draft.code,200);assert.equal(draft.data.grading.classroomDraft,true);assert.ok(draft.data.grading.lmsSentAt);assert.equal(draft.data.grading.studentSentAt,null);
 const sent=await h.call(h.submissions,h.req(body));assert.equal(sent.code,200);assert.equal(sent.data.email.to,'student@school.org');assert.ok(sent.data.grading.studentSentAt);assert.equal(sent.data.grading.lmsSentAt,draft.data.grading.lmsSentAt);assert.equal(h.state.emailed.grading.automatic[0].explanation,body.explanations[1]);assert.equal(h.state.emailed.grading.manual[0].explanation,body.explanations[0]);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.submissions[0].grading.automatic[0].explanation,body.explanations[1]);assert.equal(report.data.submissions[0].grading.manual[0].explanation,body.explanations[0]);assert.equal(report.data.submissions[0].grading.studentSentAt,sent.data.grading.studentSentAt);assert.equal(report.data.submissions[0].grading.lmsSentAt,draft.data.grading.lmsSentAt);
 h.state.emailFailure=true;const failed=await h.call(h.submissions,h.req(body));assert.equal(failed.code,200);assert.equal(failed.data.emailError,'Email failed');assert.equal(failed.data.grading.studentSentAt,sent.data.grading.studentSentAt);assert.equal(failed.data.grading.total,7);
 const changed={...body,scores:[1]};
 assert.equal((await h.call(h.submissions,h.req(changed))).code,409);
 const saved=await h.call(h.submissions,h.req({...changed,emailStudent:false}));assert.equal(saved.data.grading.classroomDraft,false);
 const reloaded=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(reloaded.data.submissions[0].grading.classroomDraft,false);
 const updated=await h.call(h.submissions,h.req({...changed,emailStudent:false,sendToClassroom:true}));assert.equal(updated.data.grading.classroomDraft,true);assert.equal(h.state.grade.draftGrade,6);assert.equal(h.state.grade.assignedGrade,undefined);
 const ready=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(ready.data.submissions[0].grading.classroomDraft,true);
 h.state.emailFailure=false;assert.equal((await h.call(h.submissions,h.req(changed))).data.email.to,'student@school.org');
});

test('Extra credit adds to earned points but not the denominator, and is optional',()=>{
 const regular={type:'choice',prompt:'Regular',points:1,choices:['A','B'],answer:['A']};
 const q={...fixture(),questions:[...Array.from({length:10},()=>({...regular})),{...regular,prompt:'Bonus',extraCredit:true}]};
 const valid=model.validateQuiz(q,true),answers=q.questions.map(()=>['A']);
 const g=model.grade(valid,answers);assert.equal(g.total,11);assert.equal(g.baseMax,10);assert.equal(g.extraMax,1);
 answers[10]=[''];assert(model.validAnswers(valid,answers));assert.equal(model.grade(valid,answers).total,10);
 answers[0]=[''];assert(!model.validAnswers(valid,answers));
 assert.equal(model.publicQuestions(valid)[10].extraCredit,true);
 assert.throws(()=>model.validateQuiz({...q,questions:[{...regular,extraCredit:true}]},true),/regular question/);
 assert.throws(()=>model.validateQuiz({...q,questions:[{...regular,extraCredit:'yes'}]},true));
 const written={...fixture(),questions:[regular,{type:'text',prompt:'Bonus explanation',points:2,extraCredit:true,answer:'Example'}]};
 assert(model.validAnswers(written,[['A'],['']]));assert.equal(model.grade(written,[['A'],['']]).pending,1);
 assert.equal(model.grade(written,[['A'],['attempt']]).pending,1);
 const manual=model.grade(written,[['A'],['attempt']],{scores:[2]});assert.equal(manual.total,3);assert.equal(manual.baseMax,1);
});
test('Published bonus settings survive reload and Classroom receives 11 out of 10',async()=>{
 const h=harness(),regular={type:'choice',prompt:'Regular',points:1,choices:['A','B'],answer:['A']};
 const q={...fixture(),questions:[...Array.from({length:10},()=>({...regular})),{...regular,prompt:'Bonus',extraCredit:true}]};
 const link=await assigned(h,q);assert.equal(h.state.work.maxPoints,10);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:link.quiz}));assert.equal(loaded.data.quiz.questions[10].extraCredit,true);
 const id='b'.repeat(32),answers=q.questions.map(()=>['A']);const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 assert.equal((await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers},'student'))).code,200);
 const corrected=await h.call(h.submissions,h.req({...link,id,action:'correct',scores:[],feedback:'',sendToClassroom:true}));assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,11);assert.equal(corrected.data.grading.baseMax,10);assert.equal(h.state.grade.draftGrade,11);assert.equal(corrected.data.classroom.maxPoints,10);
});


test('Hand-graded points above the suggestion persist and reach Classroom and email',async()=>{
 const h=harness(),quiz=fixture();quiz.questions[0].points=1;quiz.questions[0].extraCredit=true;
 const link=await assigned(h,quiz),id='f'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 const body={...link,id,action:'correct',scores:[2],explanations:{0:'This question should allow two points.'},feedback:''};
 const saved=await h.call(h.submissions,h.req({...body,sendToClassroom:true}));
 assert.equal(saved.code,200);assert.equal(saved.data.grading.manual[0].score,2);
 assert.equal(saved.data.grading.manual[0].max,1);
 assert.equal(h.state.grade.draftGrade,saved.data.grading.total);
 const sent=await h.call(h.submissions,h.req({...body,emailStudent:true}));assert.equal(sent.code,200);
 assert.equal(h.state.emailed.grading.manual[0].score,2);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));
 assert.equal(report.data.submissions[0].grading.manual[0].score,2);assert.equal(report.data.summary[0].correct,1);
 for(const score of [-1,0.25,'2'])assert.equal((await h.call(h.submissions,h.req({...body,scores:[score]}))).code,400);
});


test('Above-assigned automatic overrides persist and reach Classroom and email',async()=>{
 const h=harness(),link=await assigned(h),id='9'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 const body={...link,id,action:'correct',scores:[2],overrides:{1:2},explanations:{1:'Two points intended.'},feedback:''};
 const saved=await h.call(h.submissions,h.req({...body,sendToClassroom:true}));assert.equal(saved.code,200);
 assert.equal(saved.data.grading.automatic[0].score,2);assert.equal(saved.data.grading.automatic[0].max,1);
 assert.equal(h.state.grade.draftGrade,saved.data.grading.total);
 const sent=await h.call(h.submissions,h.req({...body,emailStudent:true}));assert.equal(sent.code,200);assert.equal(h.state.emailed.grading.automatic[0].score,2);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.submissions[0].grading.automatic[0].score,2);assert.equal(report.data.summary[1].correct,1);
});

function vocabularyFixture(){return {title:'Vocabulary options',durationMinutes:null,questions:[
 {type:'match',prompt:'Match each word to its meaning.',items:['lucid','reluctant'],choices:['clear','unwilling','swift'],answer:['clear','unwilling'],points:2,scoringMode:'response'},
 {type:'gaps',prompt:'Her explanation was ___.',wordBank:false,answer:['lucid'],points:1},
 {type:'gaps',prompt:'He was ___ to leave.',wordBank:true,choices:['reluctant','lucid','swift'],answer:['reluctant'],points:1}
]};}


test('Vocabulary import and AI endpoints enforce teacher session and same origin',async()=>{
 const h=harness();
 for(const action of ['import-vocabulary','vocabulary-distractors','vocabulary-questions','vocabulary-coverage']){
  assert.equal((await h.call(h.builder.handle,h.req({action},'student'))).code,403);
  const request=h.req({action});request.headers.origin='https://evil.example';assert.equal((await h.call(h.builder.handle,request)).code,403);
 }
 const result=await h.call(h.builder.handle,h.req({action:'import-vocabulary',text:'word,definition\nlucid,clear\nreluctant,unwilling'}));assert.equal(result.code,200);assert.equal(result.data.rows.length,2);
});
test('Vocabulary source persists encrypted in drafts and duplicates but never in public snapshots',async()=>{
 const h=harness(),q=fixture();q.vocabulary={rows:[{word:'lucid',definition:'clear',definitionDistractors:['murky'],wordDistractors:['slow']},{word:'reluctant',definition:'unwilling',definitionDistractors:['eager'],wordDistractors:['fast']}],types:['choice'],count:3};
 const saved=await h.call(h.builder.handle,h.req({action:'save',quiz:q}));assert.equal(saved.code,200);const id=saved.data.quiz.id;
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id}));assert.equal(loaded.data.quiz.vocabulary.rows[0].word,'lucid');assert(![...h.blobs.values()].some(v=>v.includes('lucid')));
 const published=await h.call(h.builder.handle,h.req({action:'publish',id}));assert.equal(published.code,200);assert.equal(published.data.quiz.vocabulary.rows.length,2);assert.equal((await h.builder.published(id)).vocabulary,undefined);
 const copy=await h.call(h.builder.handle,h.req({action:'save',quiz:{...published.data.quiz,published:false}}));assert.equal(copy.code,200);assert.notEqual(copy.data.quiz.id,id);assert.equal(copy.data.quiz.vocabulary.count,3);
});
test('Generation metadata and duplicate prevention survive authenticated save, load and duplication',async()=>{
 const h=harness(),config={rows:[{word:'שלום',definition:'peace',definitionDistractors:['war']},{word:'אור',definition:'light',definitionDistractors:['darkness']}],types:['choice'],autoCount:true};
 const generated=await h.call(h.builder.handle,h.req({action:'vocabulary-questions',...config}));assert.equal(generated.code,200);
 const saved=await h.call(h.builder.handle,h.req({action:'save',quiz:{title:'Coverage',questions:generated.data.questions,vocabulary:config}}));assert.equal(saved.code,200);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:saved.data.quiz.id}));assert.equal(loaded.code,200);
 assert.equal(loaded.data.quiz.vocabulary.autoCount,true);assert.equal(loaded.data.quiz.questions[0].vocabularyGenerated,true);
 const copy=await h.call(h.builder.handle,h.req({action:'save',quiz:loaded.data.quiz}));assert.equal(copy.code,200);
 assert.deepEqual(copy.data.quiz.questions[0].vocabularyTerms,[{word:'שלום',definition:'peace'}]);
 const current={...config,existingQuestions:copy.data.quiz.questions};
 const coverage=await h.call(h.builder.handle,h.req({action:'vocabulary-coverage',...current}));assert.equal(coverage.code,200);assert.equal(coverage.data.coverage.existingWords,2);assert.match(coverage.data.coverage.error,/already tested/);
 const blocked=await h.call(h.builder.handle,h.req({action:'vocabulary-questions',...current}));assert.equal(blocked.code,400);assert.match(blocked.data.error,/already tested/);
});

test('Every typed answer waits for teacher correction regardless of content, timeout, or extra credit',()=>{
 for(const extraCredit of [false,true])for(const value of ['lucid','LUCID','wrong','']){
  const q=vocabularyFixture();q.questions.push({type:'text',prompt:'Explain',answer:'lucid',points:2,extraCredit});q.questions[1].extraCredit=extraCredit;
  const answers=[['clear','unwilling'],[value],['reluctant'],[value]];
  const g=model.grade(q,answers);assert.equal(g.pending,2);assert.equal(g.total,null);
  assert.deepEqual(g.manual.map(a=>a.index),[1,3]);assert(g.manual.every(a=>a.score===null));
  assert.deepEqual(g.automatic.map(a=>a.index),[0,2]);
  assert.equal(model.summarize(q,[{grading:g}])[1].pending,1);
  assert(model.validCorrections(q,[0,2]));const marked=model.grade(q,answers,{scores:[0,2]});assert.equal(marked.pending,0);
 }
});
test('Legacy text marks stay with their questions when typed blanks become manual',()=>{
 const q=vocabularyFixture();q.questions.push({type:'text',prompt:'Explain',answer:'model',points:2});
 const g=model.grade(q,[['clear','unwilling'],['lucid'],['reluctant'],['explanation']],{scores:[2]});
 assert.deepEqual(g.manual.map(a=>[a.index,a.score]),[[1,null],[3,2]]);
 const prior=model.grade(q,[],{scores:[2],overrides:{1:1}});assert.deepEqual(prior.manual.map(a=>a.score),[1,2]);
});

test('Marked Hebrew blanks normalize to student-safe blanks with editable distractors',()=>{
 const q=model.validateQuiz({title:'Hebrew',questions:[{type:'gaps',prompt:'זה <<חתול>> וזה <<כלב>>',points:1,direction:'rtl',distractors:['בית']}]},true);
 assert.deepEqual(q.questions[0].answer,['חתול','כלב']);assert.equal(q.questions[0].prompt,'זה ___ וזה ___');assert.deepEqual(q.questions[0].choices,['חתול','כלב','בית']);assert.equal(q.questions[0].direction,'rtl');
 assert.equal(model.grade(q,[['חתול','כלב']]).total,1);
});

test('Public choices depend only on their text and never expose private authoring fields',()=>{
 for(const type of ['gaps','order','match']){
  const original={type,prompt:type==='gaps'?'___ then ___':'Question',points:1,choices:['zebra','apple','moon'],answer:type==='order'?['zebra','apple','moon']:['zebra','apple'],...(type==='match'?{items:['first','second']}:{}),sentence:'<<zebra>> then <<apple>>',distractors:['moon'],pairs:[['first','zebra']]};
  const a=model.publicQuestions({questions:[original]})[0];
  const b=model.publicQuestions({questions:[{...original,choices:[...original.choices].reverse(),answer:[...original.answer].reverse()}]})[0];
  assert.deepEqual(a.choices,b.choices);assert.deepEqual(a.choices,['apple','moon','zebra']);
  for(const privateField of ['answer','sentence','distractors','pairs'])assert(!Object.hasOwn(a,privateField));
  assert.deepEqual(original.choices,['zebra','apple','moon']);
 }
});
test('Unfinished marked sentences preserve completed answers across repeated draft saves and cannot publish',()=>{
 const input={title:'Draft',questions:[{type:'gaps',points:1,prompt:'The ___ sits on <<unfinished',sentence:'The <<cat>> sits on <<unfinished',choices:['cat','car'],answer:['cat'],distractors:['car']}]};
 const once=model.validateQuiz(input),twice=model.validateQuiz(once);
 assert.deepEqual(twice,once);assert.equal(twice.questions[0].sentence,input.questions[0].sentence);assert.deepEqual(twice.questions[0].answer,['cat']);
 assert.throws(()=>model.validateQuiz(twice,true),/finish each blank/);
 twice.questions[0].sentence='The <<cat>> sits on the <<mat>>.';
 const ready=model.validateQuiz(twice,true);assert.deepEqual(ready.questions[0].answer,['cat','mat']);
 const oldDraft={...input,questions:input.questions.map(({sentence,distractors,...q})=>q)};
 assert.deepEqual(model.validateQuiz(oldDraft).questions[0].answer,['cat']);
 for(const sentence of ['The <<>> sits.','The <<cat>> sits on ___','The <<cat>> sits >>'])assert.throws(()=>model.validateQuiz({...input,questions:[{...input.questions[0],sentence}]},true));
});
test('Preview and server share feedback for correct, wrong, partial, and manual questions',()=>{
 const scoring=require('../Penina-Quizzes/custom/scoring');
 const q=fixture();q.questions[3].scoringMode='response';
 for(const answers of [correctAnswers(),[['response'],['A'],['A','B'],['א','ב'],['א','ב']],q.questions.map(item=>Array.isArray(item.answer)?item.answer.map(()=> ''):[''])]){
  const expected=model.grade(q,answers).automatic.map(({index,score,max})=>({index,correct:score===max,partial:score>0&&score<max}));
  assert.deepEqual(scoring.feedback(q.questions,answers),expected);
 }
});

test('Preview request returns real shared feedback without sending submissions',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/quiz.js'),'utf8'),previewQuiz=fixture();
 previewQuiz.questions.push({type:'match',points:2,scoringMode:'response',prompt:'Match',items:['cat','car'],choices:['animal','building'],answer:['animal','']});
 const context={previewQuiz,QuizScoring:require('../Penina-Quizzes/custom/scoring'),forwardOnly:false,lockedThrough:-1,saved:{},Date,fetch:()=>assert.fail('Preview must not submit to server')};
 vm.createContext(context);vm.runInContext(code.slice(code.indexOf('async function request('),code.indexOf('function navigate(')),context);
 const answers=[...correctAnswers(),['animal','']];const result=await context.request({action:'submit',answers});
 assert.equal(result.accepted,true);assert.deepEqual(result.automatic,context.QuizScoring.feedback(previewQuiz.questions,answers,true));
 assert.deepEqual(result.automatic.at(-1),{index:5,correct:true,partial:false,correctAnswers:['animal','']});
 const metadata=code.match(/questions:previewQuiz\.questions\.map\(q=>\(\{\.\.\.q,maxPoints:QuizScoring\.maxPoints\(q\),responseCount:QuizScoring\.responseCount\(q\)\}\)\)/);
 assert(metadata,'Preview must use the shared response count so distractors do not count as required matches');
});
test('Draft sentence survives authenticated save/load and remains private after publishing',async()=>{
 const h=harness(),quiz={title:'Sentence draft',questions:[{type:'gaps',points:1,sentence:'The <<cat>> sits on <<unfinished',prompt:'The ___ sits on <<unfinished',answer:['cat'],choices:['cat','car'],distractors:['car']}]};
 const saved=await h.call(h.builder.handle,h.req({action:'save',quiz}));assert.equal(saved.code,200);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:saved.data.quiz.id}));assert.equal(loaded.data.quiz.questions[0].sentence,quiz.questions[0].sentence);assert.deepEqual(Array.from(loaded.data.quiz.questions[0].answer),['cat']);
 const blocked=await h.call(h.builder.handle,h.req({action:'publish',id:saved.data.quiz.id}));assert.equal(blocked.code,400);
 const finished=loaded.data.quiz;finished.questions[0].sentence='The <<cat>> sits on the <<mat>>.';
 const updated=await h.call(h.builder.handle,h.req({action:'save',id:finished.id,quiz:finished}));assert.equal(updated.code,200);
 const published=await h.call(h.builder.handle,h.req({action:'publish',id:finished.id}));assert.equal(published.code,200);
 const safe=model.publicQuestions(published.data.quiz)[0];assert(!('sentence' in safe));assert(!('distractors' in safe));assert(!('answer' in safe));assert.deepEqual(Array.from(safe.choices),['car','cat','mat']);
});

 test('Ordering awards full credit only for the complete correct sequence in both scoring modes',()=>{
 const scoring=require('../Penina-Quizzes/custom/scoring');
 for(const scoringMode of ['total','response']){
  const q={type:'order',prompt:'Order',points:2,scoringMode,choices:['A','B','C'],answer:['A','B','C']};
  for(const answers of [['A','B','C'],['A','C','B'],['A','B'],['A','A','C']]){
   const correct=JSON.stringify(answers)===JSON.stringify(q.answer),expected=correct?(scoringMode==='response'?6:2):0;
   assert.equal(model.grade({questions:[q]},[answers]).total,expected);
   assert.equal(scoring.score(q,answers),expected);
   assert.deepEqual(scoring.feedback([q],[answers]),[{index:0,correct,partial:false}]);
  }
 }
});

test('Potential points are author-only, versioned, and leave the published answer key intact',async()=>{
 const h=harness(),id=await h.publish();
 const request=(action,extra={},user='owner')=>h.call(h.builder.handle,h.req({action,id,...extra},user));
 const original=h.blobs.get('quiz-builder/published/'+id+'.txt');
 assert.equal((await request('load-points',{},'other')).code,404);
 const answerView=await request('load-points');assert.equal(answerView.code,200);assert.equal(answerView.data.questions[0].answer,'Model answer');assert.deepEqual(Array.from(answerView.data.questions[2].answer),['A','C']);assert.equal(answerView.data.questions[3].type,'gaps');
 assert.equal((await request('save-points',{revision:0,points:[4,5,6,7,8]},'student')).code,403);
 const cross=h.req({action:'save-points',id,revision:0,points:[4,5,6,7,8]});cross.headers.origin='https://other.example';
 assert.equal((await h.call(h.builder.handle,cross)).code,403);
 for(const points of [[0,1,1,2,1],[1],[-1,1,1,2,1],[1.2,1,1,2,1],[5001,1,1,2,1]])assert.equal((await request('save-points',{revision:0,points})).code,400);
 assert.equal((await request('save-points',{revision:0,points:[4,5,6,7,8]})).data.revision,1);
 assert.equal((await request('save-points',{revision:0,points:[4,5,6,7,9]})).code,409);
 assert.equal((await request('save-points',{revision:1,points:[4,5,6,7,8]})).data.revision,1);
 assert.equal(h.blobs.get('quiz-builder/published/'+id+'.txt'),original);
 const q=await h.builder.published(id),g=model.grade(q,correctAnswers(),{scores:[2],overrides:{1:2}});
 assert.equal(g.total,8);assert.equal(g.baseMax,30);assert.equal(g.manual[0].score,2);assert.equal(g.manual[0].max,4);
 assert.deepEqual(g.automatic.map(a=>a.score),[2,1,2,1]);
 assert.equal((await h.builder.info(id)).maxPoints,30);
});

test('Denominator edits preserve per-response earnings, extra credit, and pending written marks',()=>{
 const quiz=fixture();quiz.questions[3].scoringMode='response';quiz.questions[4].extraCredit=true;
 const before=model.grade(quiz,correctAnswers());
 quiz.pointsRevision=1;quiz.questions.forEach(q=>q.potentialPoints=5);
 const after=model.grade(quiz,correctAnswers());
 assert.equal(after.earnedSoFar,before.earnedSoFar);assert.equal(after.pending,1);assert.equal(after.total,null);
 assert.equal(after.baseMax,20);assert.equal(after.extraMax,5);
 const partial=correctAnswers();partial[3]=['א','ב'];assert.equal(model.grade(quiz,partial).automatic[2].score,2);
});

test('Edits work during an attempt and after grading; stale grades cannot be emailed as current',async()=>{
 const h=harness(),{quiz:id,classId}=await assigned(h),receipt='e'.repeat(32);
 const start=await h.call(h.submissions,h.req({action:'start',quiz:id,classId,id:receipt},'student'));
 async function adjust(revision,points){const r=await h.call(h.builder.handle,h.req({action:'save-points',id,revision,points}));assert.equal(r.code,200);}
 await adjust(0,[4,1,1,2,1]);
 const submission=await h.call(h.submissions,h.req({action:'submit',quiz:id,classId,id:receipt,token:start.data.token,answers:correctAnswers()},'student'));assert.equal(submission.code,200);
 const correction={action:'correct',quiz:id,id:receipt,scores:[2],feedback:'Good',pointsRevision:1};
 let saved=await h.call(h.submissions,h.req({...correction,sendToClassroom:true}));assert.equal(saved.data.grading.classroomDraft,true);assert.equal(saved.data.grading.total,7);assert.equal(saved.data.grading.baseMax,9);
 h.state.work.maxPoints=9;
 saved=await h.call(h.submissions,h.req({...correction,sendToClassroom:true}));assert.equal(saved.data.grading.classroomDraft,true);
 let email=await h.call(h.submissions,h.req({...correction,emailStudent:true}));assert.equal(email.code,200);assert.equal(h.state.emailed.grading.manual[0].max,4);
 await adjust(1,[5,1,1,2,1]);
 const report=await h.call(h.submissions,h.req({action:'report',quiz:id})),g=report.data.submissions[0].grading;
 assert.equal(g.total,7);assert.equal(g.baseMax,10);assert.equal(g.pointsChanged,true);assert.equal(g.classroomDraft,false);assert.equal(g.lmsSentAt,null);assert.equal(g.studentSentAt,null);
 assert.equal((await h.call(h.submissions,h.req({...correction,emailStudent:true}))).code,409);
 correction.pointsRevision=2;
 assert.equal((await h.call(h.submissions,h.req({...correction,emailStudent:true}))).code,409);
 h.state.work.maxPoints=10;
 assert.equal((await h.call(h.submissions,h.req({...correction,sendToClassroom:true}))).data.grading.classroomDraft,true);
 email=await h.call(h.submissions,h.req({...correction,emailStudent:true}));assert.equal(email.code,200);assert.equal(h.state.emailed.grading.manual[0].score,2);assert.equal(h.state.emailed.grading.manual[0].max,5);assert.equal(h.state.emailed.grading.baseMax,10);
});

test('Builder reload and duplicate carry revised totals into fresh grading without changing the source',async()=>{
 const scoring=require('../Penina-Quizzes/custom/scoring'),h=harness(),q=fixture();q.questions[3].scoringMode='response';q.questions[4].extraCredit=true;
 const id=await h.publish(q);
 const changed=await h.call(h.builder.handle,h.req({action:'save-points',id,revision:0,points:[5,5,5,5,5]}));assert.equal(changed.code,200);
 const loaded=(await h.call(h.builder.handle,h.req({action:'load',id}))).data.quiz;
 assert.equal(model.maxPoints(loaded.questions[0]),5);assert.equal(loaded.pointsRevision,1);
 const copy={...loaded,questions:scoring.duplicateQuestions(loaded.questions)};
 const copyId=await h.publish(copy);assert.notEqual(copyId,id);
 const published=await h.builder.published(copyId),grade=model.grade(published,correctAnswers(),{scores:[5]});
 assert.equal(grade.total,25);assert.equal(grade.baseMax,20);assert.equal(grade.extraMax,5);assert.equal(published.pointsRevision,0);
 const partial=correctAnswers();partial[3]=['א','ב'];assert.equal(model.grade(published,partial).automatic[2].score,2.5);
 assert.equal(model.grade(await h.builder.published(id),correctAnswers(),{scores:[2]}).total,9);
 assert.equal(scoring.feedback(published.questions,correctAnswers()).every(item=>item.correct),true);
});


test('Denominator changes preserve answer correctness across feedback, summary, and email',()=>{
 const scoring=require('../Penina-Quizzes/custom/scoring'),{correctedTest}=require('../lib/quiz-correction-email');
 const q={type:'choice',prompt:'Pick B',points:4,potentialPoints:5,choices:['A','B'],answer:['B']};
 const quiz={questions:[q]},answers=[['B']],grading=model.grade(quiz,answers);
 assert.equal(scoring.feedback([q],answers)[0].correct,true);
 assert.equal(model.summarize(quiz,[{grading}])[0].correct,1);
 assert.match(correctedTest({record:{name:'Test',answers},questions:[q],grading,title:'Quiz'}).text,/Correct · 4\/5 points/);
 const override=model.grade(quiz,answers,{overrides:{0:2}});
 assert.equal(model.summarize(quiz,[{grading:override}])[0].partial,1);
 assert.match(correctedTest({record:{name:'Test',answers},questions:[q],grading:override,title:'Quiz'}).text,/Partial credit · 2\/5 points/);
 const match={type:'match',prompt:'Match',points:2,scoringMode:'response',potentialPoints:1,items:['a','b'],choices:['A','B'],answer:['A','B']};
 const partial=model.grade({questions:[match]},[['A','A']]);assert.equal(model.summarize({questions:[match]},[{grading:partial}])[0].partial,1);
});


test('Potential-points mode changes recalculate existing answers both ways and preserve overrides',async()=>{
 const h=harness(),id=await h.publish();
 const save=(revision,points,scoringModes)=>h.call(h.builder.handle,h.req({action:'save-points',id,revision,points,scoringModes}));
 const modes=['total','total','response','response','response'];
 assert.equal((await save(0,[2,1,2,4,2],['bad',...modes.slice(1)])).code,400);
 assert.equal((await save(0,[2,1,2,4,2],modes)).data.revision,1);
 const answers=correctAnswers();answers[2]=['A'];answers[3]=['א','ב'];answers[4]=['ב','ב'];
 let quiz=await h.builder.published(id),g=model.grade(quiz,answers,{scores:[1.5],overrides:{1:2}});
 assert.deepEqual(g.automatic.map(q=>q.score),[2,1,2,1]);assert.equal(g.manual[0].score,1.5);
 assert.equal(g.pointsChanged,true);assert.equal(g.classroomDraft,false);
 assert.equal(model.publicQuestions(quiz)[2].perResponseCredit,true);
 assert.equal((await save(1,[2,1,2,4,2],modes)).data.revision,1);
 assert.equal((await save(1,[2,1,3,5,3],modes)).data.revision,2);
 quiz=await h.builder.published(id);assert.equal(model.grade(quiz,answers).automatic[2].score,2);
 assert.equal((await save(2,[2,1,2,2,1],Array(5).fill('total'))).data.revision,3);
 quiz=await h.builder.published(id);g=model.grade(quiz,answers,{scores:[1.5],overrides:{1:2}});
 assert.deepEqual(g.automatic.map(q=>q.score),[2,0,0,0]);assert.equal(g.manual[0].score,1.5);
 assert.equal((await save(2,[2,1,2,2,1],modes)).code,409);
});


test('Saving potential points syncs only owned linked assignments and retries failed Classroom updates',async()=>{
 const h=harness(),link=await assigned(h),id=link.quiz;
 const record=[...h.blobs.entries()].find(([key])=>key.startsWith('quiz-google/classes/'));
 const assignment=h.account.unseal(record[1]);
 h.blobs.set('quiz-google/classes/'+'b'.repeat(32)+'.txt',h.account.seal({...assignment,courseId:'second',className:'Second class'}));
 h.blobs.set('quiz-google/classes/'+'c'.repeat(32)+'.txt',h.account.seal({...assignment,owner:'other'}));
 h.blobs.set('quiz-google/classes/'+'d'.repeat(32)+'.txt',h.account.seal({...assignment,quiz:'other-quiz'}));
 const save=(revision,points)=>h.call(h.builder.handle,h.req({action:'save-points',id,revision,points}));
 h.state.pointsFailure=true;
 let result=await save(0,[4,1,1,2,1]);assert.equal(result.code,200);assert.equal(result.data.revision,1);
 assert.equal(result.data.classroom.failures.length,2);assert.equal(h.state.pointsPatches.length,2);assert.equal(h.state.work.maxPoints,7);
 h.state.pointsFailure=false;
 result=await save(1,[4,1,1,2,1]);assert.equal(result.data.revision,1);assert.equal(result.data.classroom.failures.length,0);
 assert.equal(result.data.classroom.updated+result.data.classroom.unchanged,2);assert.equal(h.state.work.maxPoints,9);
 const patch=h.state.pointsPatches.at(-1);assert.equal(JSON.stringify(patch.params),JSON.stringify({updateMask:'maxPoints'}));assert.equal(JSON.stringify(patch.data),JSON.stringify({maxPoints:9}));assert.equal(h.state.grade,null);
 const count=h.state.pointsPatches.length;
 result=await save(1,[4.5,1,1,2,1]);assert.equal(result.data.revision,2);assert.match(result.data.classroom.warning,/whole-number/);assert.equal(h.state.pointsPatches.length,count);assert.equal(h.state.work.maxPoints,9);
 result=await save(2,[5,1,1,2,1]);assert.equal(result.data.classroom.maxPoints,10);assert.equal(h.state.work.maxPoints,10);
});

test('Classroom point syncing excludes extra credit',async()=>{
 const h=harness(),q=fixture();q.questions[4].extraCredit=true;
 const link=await assigned(h,q);
 const result=await h.call(h.builder.handle,h.req({action:'save-points',id:link.quiz,revision:0,points:[3,1,1,2,4.5]}));
 assert.equal(result.code,200);assert.equal(result.data.classroom.maxPoints,7);assert.equal(h.state.work.maxPoints,7);assert.equal(result.data.classroom.warning,undefined);
});



test('Student answers remain saved when Classroom turn-in fails; retry turns in without releasing grades',async()=>{
 const h=harness(),link=await assigned(h),id='f'.repeat(32);
 h.blobs.set('quiz-google/students/student.txt',h.account.seal({scope:'https://www.googleapis.com/auth/classroom.coursework.me',refreshToken:'student-refresh'}));
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 const body={...link,action:'submit',id,token:start.data.token,answers:correctAnswers()};
 h.state.submissionState='CREATED';h.state.turnInFailure=true;
 const failed=await h.call(h.submissions,h.req(body,'student'));assert.equal(failed.data.accepted,true);assert.equal(failed.data.classroom.turnedIn,false);assert.match(failed.data.classroom.message,/answers are saved/);
 h.state.turnInFailure=false;
 const retried=await h.call(h.submissions,h.req(body,'student'));assert.equal(retried.data.classroom.turnedIn,true);assert.equal(retried.data.submittedAt,failed.data.submittedAt);assert.equal(h.state.grade,null);
 const corrected=await h.call(h.submissions,h.req({...link,id,action:'correct',scores:[2],feedback:'',sendToClassroom:true}));assert.equal(corrected.data.classroom.draft,true);assert.equal(h.state.grade.assignedGrade,undefined);
});

test('Email-only accounts are directed to Google before creating Classroom-owned quizzes',async()=>{
 const h=harness(),result=await h.call(h.builder.handle,h.req({action:'save',quiz:fixture()},'email:2'));
 assert.equal(result.code,403);assert.match(result.data.error,/Sign in with Google from Penina Home/);
 assert.equal([...h.blobs.keys()].filter(key=>key.startsWith('quiz-builder/')).length,0);
});

test('five picture marker questions save, publish, submit and receive separate teacher scores',async()=>{
 const picture=require('../Penina-Quizzes/picture');
 const quiz={title:'Five markers',questions:[{type:'text',pictureQuestion:true,prompt:'Identify marker 1',answer:'First',points:1,direction:'ltr',image:{src:'data:image/png;base64,iVBORw0KGgo=',alt:'Diagram',marker:{x:0.1,y:0.2}}}]};
 for(let i=1;i<5;i++){const q=picture.addMarker(quiz.questions,quiz.questions[0]);q.prompt='Identify marker '+(i+1);q.answer='Answer '+(i+1);}
 const h=harness(),id=await h.publish(quiz);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id}));assert.equal(loaded.code,200);assert.equal(loaded.data.quiz.questions[4].markerIndex,4);
 const assigned=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));assert.equal(assigned.code,200);
 const classId=new URL(assigned.data.url).searchParams.get('class'),attemptId='f'.repeat(32);
 const started=await h.call(h.submissions,h.req({action:'start',id:attemptId,classId,quiz:id},'student'));assert.equal(started.code,200);
 const submitted=await h.call(h.submissions,h.req({action:'submit',id:attemptId,classId,quiz:id,token:started.data.token,answers:[['one'],['two'],['three'],['four'],['five']]},'student'));assert.equal(submitted.code,200);
 const corrected=await h.call(h.submissions,h.req({action:'correct',id:attemptId,quiz:id,scores:[1,0,1,0,1],feedback:''}));assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,3);assert.equal(corrected.data.grading.manual.length,5);
});

test('one multi-marker picture saves, publishes, collects all responses and grades with its configured points',async()=>{
 const picture=require('../Penina-Quizzes/picture');
 for(const mode of ['markers','shared']){
  const quiz={title:'One picture with markers',questions:[{type:'text',pictureQuestion:true,prompt:'Identify the marked shapes',answer:'Shared model',points:2,scoringMode:'response',image:{src:'data:image/png;base64,iVBORw0KGgo=',alt:'Shapes',marker:{x:.1,y:.2}}}]};
  const q=quiz.questions[0];picture.addQuestionMarker(q);picture.addQuestionMarker(q);q.pictureResponseMode=mode;q.pictureAnswers=['One','Two','Three'];
  const h=harness(),id=await h.publish(quiz),max=mode==='markers'?6:2;
  const loaded=await h.call(h.builder.handle,h.req({action:'load',id}));assert.equal(loaded.code,200);assert.deepEqual(loaded.data.quiz.questions[0].pictureAnswers,q.pictureAnswers);
  const assigned=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));assert.equal(assigned.code,200);assert.equal(h.state.work.maxPoints,max);
  const classId=new URL(assigned.data.url).searchParams.get('class'),attemptId='c'.repeat(32);
  const identityRequest=h.req({},'student',{action:'student',classId,quiz:id});identityRequest.method='GET';
  const identity=await h.call(h.account.handle,identityRequest);assert.equal(identity.code,200);
  assert.equal(identity.data.questions[0].pictureAnswers,undefined);assert.equal(identity.data.questions[0].answer,undefined);assert.equal(identity.data.questions[0].maxPoints,max);
  const started=await h.call(h.submissions,h.req({action:'start',id:attemptId,classId,quiz:id},'student'));assert.equal(started.code,200);
  const answers=mode==='markers'?[['first','second','third']]:[['shared response']];
  const submitted=await h.call(h.submissions,h.req({action:'submit',id:attemptId,classId,quiz:id,token:started.data.token,answers},'student'));assert.equal(submitted.code,200);assert.deepEqual(submitted.data.answers,answers);assert.deepEqual(submitted.data.automatic,[]);
  const corrected=await h.call(h.submissions,h.req({action:'correct',id:attemptId,quiz:id,scores:[max-1],feedback:''}));assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,max-1);assert.equal(corrected.data.grading.baseMax,max);
  const points=await h.call(h.builder.handle,h.req({action:'load-points',id}));assert.equal(points.code,200);assert.equal(points.data.questions[0].responseCount,mode==='markers'?3:1);
  assert.equal(points.data.questions[0].answer,mode==='markers'?'Marker 1: One\nMarker 2: Two\nMarker 3: Three':'Shared model');
 }
});

test('Recordings persist encrypted, require the matching attempt/question, and are manually corrected',async()=>{
 const h=harness(),q={type:'recording',prompt:'Explain out loud',content:'A passage',answer:'Private rubric',points:3,allowHalfCredit:true},link=await assigned(h,{title:'Oral test',questions:[q,{...q,prompt:'Read aloud'}]});
 const id='a'.repeat(32),reference='recording:'+'b'.repeat(32),second='recording:'+'c'.repeat(32);
 const start=await h.call(h.submissions,h.req({action:'start',...link,id},'student'));assert.equal(start.code,200);
 const attempt={...link,id,token:start.data.token};
 const upload={...attempt,action:'recording-save',index:0,reference,audio:'data:audio/webm;codecs=opus;base64,GkXfowAAAA==',durationMs:1500};
 assert.equal((await h.call(h.submissions,h.req(upload,'student'))).code,200);
 assert.equal((await h.call(h.submissions,h.req(upload,'student'))).code,200,'upload retry is idempotent');
 const audioPaths=[...h.blobs.keys()].filter(p=>p.startsWith('quiz-recordings/'));
 assert.equal(audioPaths.length,1);assert(!h.blobs.get(audioPaths[0]).includes(upload.audio),'audio is encrypted');
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'recording-load',index:0,reference},'student'))).data.audio,upload.audio);
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'recording-load',index:0,reference},'student2'))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'recording-load',index:1,reference},'student'))).code,400);
 const before={...attempt,action:'submit',answers:[[reference],[second]]};
 assert.equal((await h.call(h.submissions,h.req(before,'student'))).code,400,'a reference alone cannot stand in for an upload');
 assert.equal((await h.call(h.submissions,h.req({...upload,index:1,reference:second},'student'))).code,200);
 const submitted=await h.call(h.submissions,h.req(before,'student'));assert.equal(submitted.code,200);assert.deepEqual(submitted.data.automatic,[]);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.submissions[0].grading.pending,2);
 assert(!JSON.stringify(report.data).includes(upload.audio),'reports do not inline media');
 const review={...link,action:'recording-review',id,index:0};
 assert.equal((await h.call(h.submissions,h.req(review))).data.audio,upload.audio);
 assert.equal((await h.call(h.submissions,h.req(review,'other'))).code,403);
 assert.equal((await h.call(h.submissions,h.req(review,'student'))).code,403);
 assert.equal((await h.call(h.submissions,h.req({...upload,reference:'recording:'+'d'.repeat(32)},'student'))).code,409,'submitted answers cannot be replaced');
 const corrected=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[2.5,3],feedback:'Good',explanations:{0:'Speak clearly'},sendToClassroom:true}));
 assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,5.5);assert.equal(corrected.data.classroom.score,5.5);
});
test('Recording uploads enforce origin, format, question type, checkpoint locks and cross-attempt isolation',async()=>{
 const h=harness(),link=await assigned(h,{title:'Locked oral work',forwardOnlyFrom:1,questions:[{type:'recording',prompt:'Read',content:'Words',answer:'',points:1},{type:'text',prompt:'Explain',answer:'',points:1}]});
 const id='a'.repeat(32),reference='recording:'+'b'.repeat(32),start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 const attempt={...link,id,token:start.data.token},upload={...attempt,action:'recording-save',index:0,reference,audio:'data:audio/webm;base64,GkXfowAAAA==',durationMs:1000};
 const cross=h.req(upload,'student');cross.headers.origin='https://other.test';assert.equal((await h.call(h.submissions,cross)).code,403);
 assert.equal((await h.call(h.submissions,h.req({...upload,index:1},'student'))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...upload,audio:'data:text/html;base64,SGk='},'student'))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...upload,durationMs:180001},'student'))).code,400);
 assert.equal((await h.call(h.submissions,h.req(upload,'student'))).code,200);
 const otherId='c'.repeat(32),other=await h.call(h.submissions,h.req({...link,action:'start',id:otherId},'student2'));
 assert.equal((await h.call(h.submissions,h.req({...link,action:'recording-load',id:otherId,token:other.data.token,index:0,reference},'student2'))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'advance',through:0,answers:[[reference]]},'student'))).code,200);
 assert.equal((await h.call(h.submissions,h.req({...upload,reference:'recording:'+'d'.repeat(32)},'student'))).code,409);
 const restored=await h.call(h.submissions,h.req({...attempt,action:'state'},'student'));assert.equal(restored.data.lockedAnswers[0][0],reference);
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'advance',through:1,answers:[['changed'],['done']]},'student'))).code,200);
 const submitted=await h.call(h.submissions,h.req({...attempt,action:'submit',answers:[['changed'],['done']]},'student'));assert.equal(submitted.code,200);assert.equal(submitted.data.answers[0][0],reference);
});

test('longer recordings upload in encrypted retryable parts under the teacher-selected limit',async()=>{
 const h=harness(),settings=require('../Penina-Quizzes/custom/recording-settings'),question={type:'recording',prompt:'Read aloud',answer:'',points:1,recordingMinutes:10};
 const link=await assigned(h,{title:'Extended oral work',questions:[question]}),id='a'.repeat(32),reference='recording:'+'b'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student')),attempt={...link,id,token:start.data.token};
 const bytes=Buffer.alloc(settings.UPLOAD_BYTES+101,17);bytes.set([0x1a,0x45,0xdf,0xa3]);
 const audio='data:audio/webm;codecs=opus;base64,'+bytes.toString('base64'),parts=[...settings.uploads(audio,420000)];
 const upload=piece=>h.call(h.submissions,h.req({...attempt,action:'recording-save',index:0,reference,...piece},'student'));
 assert.equal((await upload({...parts[0],durationMs:600001,recordingMinutes:30})).code,400,'request cannot expand the teacher limit');
 assert.equal((await upload(parts[1])).code,400,'final part alone cannot complete an answer');
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'submit',answers:[[reference]]},'student'))).code,400);
 assert.equal((await upload(parts[0])).data.partSaved,true);assert.equal((await upload(parts[0])).data.partSaved,true,'retry keeps an identical part');
 assert.equal((await upload(parts[1])).data.saved,true);assert.equal((await upload(parts[1])).data.saved,true,'lost completion response is safe to retry');
 const read={...attempt,action:'recording-load',index:0,reference};
 const manifest=(await h.call(h.submissions,h.req(read,'student'))).data;assert.equal(manifest.totalParts,2);assert.equal(manifest.audio,undefined);
 assert.equal((await h.call(h.submissions,h.req({...read,part:0},'student2'))).code,400);
 assert.equal((await h.call(h.submissions,h.req({...read,part:2},'student'))).code,400);
 const loaded=[];for(let part=0;part<2;part++)loaded.push((await h.call(h.submissions,h.req({...read,part},'student'))).data.audio.split(',')[1]);
 assert.equal(manifest.header+','+loaded.join(''),audio);
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'submit',answers:[[reference]]},'student'))).code,200);
 const review={...link,action:'recording-review',id,index:0};assert.equal((await h.call(h.submissions,h.req(review))).data.totalParts,2);
 assert.equal((await h.call(h.submissions,h.req({...review,part:1}))).data.audio,parts[1].audio);
 assert.equal((await h.call(h.submissions,h.req({...review,part:0},'other'))).code,403);
 for(const [pathname,value] of h.blobs)if(pathname.startsWith('quiz-recordings/'))assert(!value.includes('audio/webm'));
});

test('Section pages survive save, assignment, checkpoints, submission, correction, and point revisions without grading fields',async()=>{
 const h=harness(),section={type:'section',prompt:'Part one',content:'Read and continue.'},quiz={title:'Sections',durationMinutes:null,forwardOnlyFrom:2,questions:[section,{type:'text',prompt:'Explain',answer:'Model',points:2},section,{type:'choice',prompt:'Choose',points:3,choices:['A','B'],answer:['B']},section]};
 const link=await assigned(h,quiz),id='9'.repeat(32);
 const identity=h.req({},'student',{action:'student',...link});identity.method='GET';
 const student=await h.call(h.account.handle,identity);assert.equal(student.code,200);assert.equal(student.data.questions[0].content,section.content);assert.equal(student.data.questions[0].answer,undefined);
 assert.equal(h.state.work.maxPoints,5);
 assert.equal((await h.call(h.builder.handle,h.req({action:'list'}))).data.quizzes[0].count,2);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));assert.equal(start.code,200);const attempt={...link,id,token:start.data.token};
 const answers=[[],['My answer'],[],['B'],[]];
 for(const through of [1,2,3,4]){const result=await h.call(h.submissions,h.req({...attempt,action:'advance',through,answers},'student'));assert.equal(result.code,200,JSON.stringify(result.data));assert.equal(result.data.lockedThrough,through);}
 assert.equal((await h.call(h.submissions,h.req({...attempt,action:'submit',answers},'student'))).code,200);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.code,200);const g=report.data.submissions[0].grading;assert.equal(g.pending,1);assert.deepEqual(g.manual.map(q=>q.index),[1]);assert.deepEqual(g.automatic.map(q=>q.index),[3]);
 const correction=await h.call(h.submissions,h.req({...link,id,action:'correct',scores:[2],feedback:'',sendToClassroom:true}));assert.equal(correction.code,200);assert.equal(correction.data.grading.total,5);assert.equal(h.state.grade.draftGrade,5);
 const points=await h.call(h.builder.handle,h.req({action:'load-points',id:link.quiz}));assert.equal(points.code,200);assert.equal(points.data.questions.length,2);
 assert.equal((await h.call(h.builder.handle,h.req({action:'save-points',id:link.quiz,revision:0,points:[1,2,1,3,1]}))).code,400);
 const revised=await h.call(h.builder.handle,h.req({action:'save-points',id:link.quiz,revision:0,points:[4,6],scoringModes:['total','response']}));assert.equal(revised.code,200,JSON.stringify(revised.data));assert.equal(revised.data.revision,1);assert.deepEqual(revised.data.questions.map(q=>q.potentialPoints),[4,6]);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:link.quiz}));assert.equal(loaded.code,200);assert.deepEqual(loaded.data.quiz.questions.map(model.maxPoints),[0,4,0,6,0]);assert.equal(h.state.work.maxPoints,10);
});

test('Not graded quizzes discard grading settings and do not require choice answer keys',()=>{
 const input={...fixture(),gradingMode:'ungraded'};
 for(const q of input.questions){delete q.points;q.extraCredit=true;q.allowHalfCredit=true;q.scoringMode='invalid';if(['choice','multi'].includes(q.type))q.answer=[];}
 const quiz=model.validateQuiz(input,true);
 assert.equal(quiz.gradingMode,'ungraded');
 assert(quiz.questions.every(q=>q.points===0 && !q.extraCredit && !q.allowHalfCredit && q.scoringMode==='total'));
 assert(model.validAnswers(quiz,correctAnswers()));assert(!model.validAnswers(quiz,[[''],...correctAnswers().slice(1)]));
 const grade=model.grade(quiz,correctAnswers(),{scores:[99],overrides:{1:99}});
 assert.equal(grade.total,null);assert.equal(grade.pending,0);assert.deepEqual(grade.automatic,[]);assert.deepEqual(grade.manual,[]);
 assert.deepEqual(model.summarize(quiz,[{grading:grade}]),[]);
 assert(model.validCorrections(quiz,[]));assert(!model.validCorrections(quiz,[0]));
 assert.deepEqual(require('../Penina-Quizzes/custom/scoring').feedback(input.questions,correctAnswers(),true,'ungraded'),[]);
 assert.equal(model.validateQuiz(fixture(),true).gradingMode,'graded');
 assert.throws(()=>model.validateQuiz({...fixture(),gradingMode:'unknown'}),/Choose Graded or Not graded/);
 assert.throws(()=>model.validateQuiz({...quiz,gradingMode:'graded'},true),/whole points/);
 assert.throws(()=>model.validateQuiz({...quiz,questions:[]},true),/1 and 100/);
 assert.throws(()=>model.validateQuiz({...quiz,questions:[{type:'section',content:'Read this'}]},true),/regular question/);
});

test('Not graded quizzes persist, collect responses and feedback, and block every grading write',async()=>{
 const h=harness(),input={...fixture(),gradingMode:'ungraded'};
 input.questions[0].extraCredit=true;
 const link=await assigned(h,input),id='f'.repeat(32);
 assert.equal(h.state.work.maxPoints,undefined);assert.match(h.state.work.description,/not graded/);assert.doesNotMatch(h.state.work.description,/return your grade/);
 const loaded=await h.call(h.builder.handle,h.req({action:'load',id:link.quiz}));assert.equal(loaded.data.quiz.gradingMode,'ungraded');
 assert.equal((await h.builder.info(link.quiz)).maxPoints,0);
 const identityRequest=h.req({},'student',{action:'student',quiz:link.quiz,classId:link.classId});identityRequest.method='GET';
 const identity=await h.call(h.account.handle,identityRequest);assert.equal(identity.data.gradingMode,'ungraded');assert(identity.data.questions.every(q=>q.maxPoints===0 && q.extraCredit===false));
 const posted=await h.call(h.account.handle,h.req({...link,action:'publish-assignment',courseId:'course'}));assert.equal(posted.code,200,JSON.stringify(posted.data));
 const listings=h.req({},'owner',{action:'assignments'});listings.method='GET';listings.headers.cookie='__Host-penina-quiz-session='+h.account.seal({...h.account.session(listings),userId:7});
 const assignments=await h.call(h.account.handle,listings);assert.equal(assignments.code,200,JSON.stringify(assignments.data));assert.equal(assignments.data.assignments[0].gradingMode,'ungraded');
 for(const action of ['load-points','save-points']){
  const result=await h.call(h.builder.handle,h.req({action,id:link.quiz,points:[5,5,5,5,5],revision:0}));assert.equal(result.code,400);assert.match(result.data.error,/not graded/);
 }
 h.blobs.set('quiz-google/students/student.txt',h.account.seal({scope:'https://www.googleapis.com/auth/classroom.coursework.me',refreshToken:'student-refresh'}));
 h.state.submissionState='CREATED';
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));assert.equal(start.code,200);
 const submitted=await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 assert.equal(submitted.code,200);assert.deepEqual(submitted.data.automatic,[]);assert.equal(submitted.data.classroom.turnedIn,true);assert.equal(h.state.turnInCalls,1);assert.equal(h.state.grade,null);
 const correction={...link,action:'correct',id,scores:[],overrides:{},explanations:{},feedback:'Thanks for sharing.'};
 const saved=await h.call(h.submissions,h.req(correction));assert.equal(saved.code,200);assert.equal(saved.data.grading.feedback,correction.feedback);assert.equal(saved.data.grading.total,null);
 for(const changes of [{scores:[1]},{overrides:{1:1}},{sendToClassroom:true}])assert.equal((await h.call(h.submissions,h.req({...correction,...changes}))).code,400);
 await assert.rejects(()=>h.account.sendGrade(h.req({}),{classId:link.classId,sub:'student'},{pending:0,total:10},link.quiz),/not graded/);
 assert.equal(h.state.grade,null);assert.equal(h.state.emailed,undefined);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.code,200);assert.equal(report.data.gradingMode,'ungraded');assert.deepEqual(report.data.summary,[]);
 assert.equal(report.data.submissions[0].grading.feedback,correction.feedback);assert.equal(report.data.submissions[0].grading.pending,0);
 const duplicate=await h.call(h.builder.handle,h.req({action:'save',quiz:{...loaded.data.quiz,title:'Ungraded copy'}}));assert.equal(duplicate.code,200);assert.notEqual(duplicate.data.quiz.id,link.quiz);assert.equal(duplicate.data.quiz.gradingMode,'ungraded');
});

test('Ungraded feedback saves and emails without a Classroom grade, survives failures, and tracks the current feedback',async()=>{
 const h=harness(),link=await assigned(h,{...fixture(),gradingMode:'ungraded'}),id='e'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));
 await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));
 const body={...link,action:'correct',id,scores:[],overrides:{},explanations:{},feedback:'Thanks for sharing.\nכל הכבוד',emailStudent:true,email:'attacker@example.org'};
 for(const user of ['student','other'])assert.equal((await h.call(h.submissions,h.req(body,user))).code,403);
 const cross=h.req(body);cross.headers.origin='https://other.example';assert.equal((await h.call(h.submissions,cross)).code,403);
 for(const feedback of ['', ' \n ', 'x'.repeat(2001)])assert.equal((await h.call(h.submissions,h.req({...body,feedback}))).code,400);
 assert.equal(h.state.emailed,undefined);
 const sent=await h.call(h.submissions,h.req(body));assert.equal(sent.code,200);assert.equal(sent.data.email.to,'student@school.org');assert.ok(sent.data.grading.studentSentAt);
 assert.equal(sent.data.grading.total,null);assert.equal(sent.data.grading.classroomDraft,false);assert.equal(h.state.grade,null);
 const payload=require('../lib/quiz-correction-email').correctedTest(h.state.emailed);assert.match(payload.text,/Thanks for sharing/);assert.doesNotMatch(payload.text,/Final score|points|Model answer/);
 const report=()=>h.call(h.submissions,h.req({...link,action:'report'}));
 assert.equal((await report()).data.submissions[0].grading.studentSentAt,sent.data.grading.studentSentAt);
 const unchanged=await h.call(h.submissions,h.req({...body,emailStudent:false}));assert.equal(unchanged.data.grading.studentSentAt,sent.data.grading.studentSentAt);
 h.state.emailFailure=true;
 const changed={...body,feedback:'Please add an example.'};
 const failed=await h.call(h.submissions,h.req(changed));assert.equal(failed.code,200);assert.equal(failed.data.emailError,'Email failed');assert.equal(failed.data.grading.studentSentAt,null);assert.equal(failed.data.grading.feedback,changed.feedback);
 const reloaded=(await report()).data.submissions[0].grading;assert.equal(reloaded.feedback,changed.feedback);assert.equal(reloaded.studentSentAt,null);
 h.state.emailFailure=false;const retried=await h.call(h.submissions,h.req(changed));assert.equal(retried.data.email.to,'student@school.org');assert.ok(retried.data.grading.studentSentAt);assert.equal(h.state.grade,null);
 const saved=await h.call(h.submissions,h.req({...body,emailStudent:false,feedback:'Another revision.'}));assert.equal(saved.data.grading.studentSentAt,null);assert.equal((await report()).data.submissions[0].grading.studentSentAt,null);
});

async function assignmentListings(h,query={}){
 const request=h.req({},'owner',{action:'assignments',submissionCounts:'true',...query});request.method='GET';
 request.headers.cookie='__Host-penina-quiz-session='+h.account.seal({...h.account.session(request),userId:7});
 const result=await h.call(h.account.handle,request);assert.equal(result.code,200,JSON.stringify(result.data));return result.data.assignments;
}
test('Assignment counts follow saved grading per class, refresh after corrections, and exclude practice and unfinished attempts',async()=>{
 const h=harness(),link=await assigned(h),id='1'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));assert.equal(start.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,0);
 const submitted=await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));assert.equal(submitted.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,1);
 const partial=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[null],feedback:''}));assert.equal(partial.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,1);
 const complete=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[0],feedback:''}));assert.equal(complete.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,0);
 const reopened=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[null],feedback:''}));assert.equal(reopened.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,1);
 const otherClass='2'.repeat(32),emptyClass='3'.repeat(32),foreignClass='4'.repeat(32);
 const original=h.account.unseal(h.blobs.get('quiz-google/classes/'+link.classId+'.txt'));
 for(const [classId,owner] of [[otherClass,'owner'],[emptyClass,'owner'],[foreignClass,'someone-else']])h.blobs.set('quiz-google/classes/'+classId+'.txt',h.account.seal({...original,owner,courseId:classId,className:classId}));
 const {encrypt}=h.storage.createStorage(link.quiz);
 for(const [recordId,classId] of [['5'.repeat(32),otherClass],['6'.repeat(32),otherClass],['7'.repeat(32),foreignClass]])h.blobs.set('quiz-submissions/'+link.quiz+'/'+recordId+'.json',encrypt({id:recordId,classId,answers:correctAnswers()}));
 h.blobs.set('quiz-practice/'+link.quiz+'/practice.json',encrypt({id:'practice',classId:link.classId,answers:correctAnswers()}));
 h.blobs.set('quiz-submissions/'+link.quiz+'/legacy.json',encrypt({id:'legacy',answers:correctAnswers()}));
 h.state.pageSize=1;h.state.reads=[];
 const items=await assignmentListings(h),counts=new Map(items.map(a=>[a.classId,a.ungradedCount]));
 assert.deepEqual([...counts.values()].sort(),[0,1,2]);assert.equal(counts.get(otherClass),2);assert.equal(counts.get(emptyClass),0);assert(!counts.has(foreignClass));
 assert.equal(h.state.reads.filter(p=>p==='quiz-submissions/'+link.quiz+'/'+id+'.json').length,1);
 assert(!JSON.stringify(items).includes('answers'));assert(!JSON.stringify(items).includes('student@'));
 h.state.reads=[];const plain=await assignmentListings(h,{submissionCounts:'false'});assert(plain.every(a=>a.ungradedCount===undefined));assert(!h.state.reads.some(p=>p.startsWith('quiz-submissions/')));
 const archiveRequest=h.req({action:'archive-assignment',classId:link.classId,archived:true});archiveRequest.headers.cookie='__Host-penina-quiz-session='+h.account.seal({...h.account.session(archiveRequest),userId:7});
 const archived=await h.call(h.account.handle,archiveRequest);assert.equal(archived.code,200);
 assert.equal((await assignmentListings(h,{archived:'true'}))[0].ungradedCount,1);
});
test('Automatic-only submissions count until saved; count failures stay unavailable and isolated to the affected quiz',async()=>{
 const h=harness(),quiz=fixture();quiz.questions=quiz.questions.slice(1);
 const link=await assigned(h,quiz),{encrypt}=h.storage.createStorage(link.quiz),id='a'.repeat(32);
 h.blobs.set('quiz-submissions/'+link.quiz+'/'+id+'.json',encrypt({id,classId:link.classId,answers:correctAnswers().slice(1)}));
 assert.equal((await assignmentListings(h))[0].ungradedCount,1);
 const saved=await h.call(h.submissions,h.req({...link,action:'correct',id,scores:[],feedback:''}));assert.equal(saved.code,200);
 assert.equal((await assignmentListings(h))[0].ungradedCount,0);
 const other=await assigned(h);
 h.state.listFailure=prefix=>{if(prefix==='quiz-corrections/'+link.quiz+'/')throw Error('Storage unavailable');};
 let items=await assignmentListings(h);assert.equal(items.find(a=>a.quiz===link.quiz).ungradedCount,null);assert.equal(items.find(a=>a.quiz===other.quiz).ungradedCount,0);
 h.state.listFailure=null;h.blobs.set('quiz-submissions/'+link.quiz+'/'+id+'.json','invalid encrypted record');
 items=await assignmentListings(h);assert.equal(items.find(a=>a.quiz===link.quiz).ungradedCount,null);assert.equal(items.find(a=>a.quiz===other.quiz).ungradedCount,0);
});
test('Not graded counts persist viewed submissions without requiring feedback and enforce author access',async()=>{
 const h=harness(),link=await assigned(h,{...fixture(),gradingMode:'ungraded'}),id='a'.repeat(32);
 const start=await h.call(h.submissions,h.req({...link,action:'start',id},'student'));assert.equal(start.code,200);
 assert.equal((await assignmentListings(h))[0].unreviewedCount,0);
 const submitted=await h.call(h.submissions,h.req({...link,action:'submit',id,token:start.data.token,answers:correctAnswers()},'student'));assert.equal(submitted.code,200);
 const report=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(report.data.submissions[0].reviewedAt,null);
 assert.equal((await assignmentListings(h))[0].unreviewedCount,1);
 for(const user of ['student','other'])assert.equal((await h.call(h.submissions,h.req({...link,action:'review',id},user))).code,403);
 const cross=h.req({...link,action:'review',id});cross.headers.origin='https://other.example';assert.equal((await h.call(h.submissions,cross)).code,403);
 assert.equal((await h.call(h.submissions,h.req({...link,action:'review',id:'b'.repeat(32)}))).code,404);
 const viewed=await h.call(h.submissions,h.req({...link,action:'review',id}));assert.equal(viewed.code,200);assert(viewed.data.reviewedAt);
 const reloaded=await h.call(h.submissions,h.req({...link,action:'report'}));assert.equal(reloaded.data.submissions[0].reviewedAt,viewed.data.reviewedAt);assert.equal(reloaded.data.submissions[0].grading.savedAt,null);
 assert.equal((await assignmentListings(h))[0].unreviewedCount,0);assert.equal(h.state.emailed,undefined);assert.equal(h.state.grade,null);
 assert.equal((await h.call(h.submissions,h.req({...link,action:'review',id}))).code,200);assert.equal([...h.blobs.keys()].filter(p=>p.startsWith('quiz-reviews/')).length,1);
 const second='c'.repeat(32),{encrypt}=h.storage.createStorage(link.quiz);
 h.blobs.set('quiz-submissions/'+link.quiz+'/'+second+'.json',encrypt({id:second,classId:link.classId,answers:correctAnswers()}));
 assert.equal((await assignmentListings(h))[0].unreviewedCount,1);
 const saved=await h.call(h.submissions,h.req({...link,action:'correct',id:second,scores:[],feedback:'Already reviewed'}));assert.equal(saved.code,200);
 assert.equal((await assignmentListings(h))[0].unreviewedCount,0);
 h.state.listFailure=prefix=>{if(prefix.startsWith('quiz-reviews/'))throw Error('Unavailable');};assert.equal((await assignmentListings(h))[0].unreviewedCount,null);
});
test('Classroom drafts skip grading counts',async()=>{
 const h=harness();await assigned(h);h.state.draft=true;
 h.state.listFailure=prefix=>{if(prefix.startsWith('quiz-submissions/') || prefix.startsWith('quiz-corrections/'))throw Error('Should not read draft submissions');};
 const items=await assignmentListings(h);assert.equal(items[0].state,'DRAFT');assert.equal(items[0].ungradedCount,undefined);assert(!h.state.logs.some(entry=>String(entry[0]).includes('counts failed')));
});
for(const quiz of ['gemara-6-wl-2','gemara-6-intro-retake','gemara-8-intro-retake'])test(quiz+': assignment counts use the imported quiz grading rules',async()=>{
 const h=harness(),classId='b'.repeat(32),id='c'.repeat(32),{encrypt}=h.storage.createStorage(quiz);
 h.blobs.set('quiz-google/classes/'+classId+'.txt',h.account.seal({quiz,owner:'owner',courseId:'course',courseWorkId:'work',className:'Gemara'}));h.state.work={maxPoints:8};
 const questions=require('../Penina-Quizzes/'+quiz+'/questions.json');
 h.blobs.set('quiz-submissions/'+quiz+'/'+id+'.json',encrypt({id,classId,answers:questions.map(()=>['answer'])}));
 assert.equal((await assignmentListings(h))[0].ungradedCount,1);
 h.blobs.set('quiz-corrections/'+quiz+'/'+id+'/saved.json',encrypt({id,scores:quiz==='gemara-6-wl-2'?[0,0,0,0]:[0,0],savedAt:'2026-11-25T12:00:00Z'}));
 assert.equal((await assignmentListings(h))[0].ungradedCount,0);
});

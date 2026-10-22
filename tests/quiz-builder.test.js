const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const model=require('../lib/quiz-builder-model');
function fixture(){return {title:'Hebrew review',durationMinutes:30,questions:[
 {type:'text',prompt:'Explain',points:2,allowHalfCredit:true,direction:'ltr',answer:'Model answer'},
 {type:'choice',prompt:'Pick one',points:1,choices:['A','B'],answer:['B']},
 {type:'multi',prompt:'Pick all',points:1,choices:['A','B','C'],answer:['A','C']},
 {type:'gaps',prompt:'___ and ___',points:2,choices:['א','ב'],answer:['א','א'],direction:'rtl'},
 {type:'order',prompt:'Order',points:1,choices:['א','ב'],answer:['ב','א'],direction:'rtl'}]};}
function harness(){
 const blobs=new Map(),cache=new Map(),state={enrolled:true,teacher:true,work:null,grade:null},ORIGIN='https://www.penina-hebrew.org';
 class OAuth2Client {setCredentials(){} generateAuthUrl(options){state.oauth=options;return 'https://accounts.google.com/test';}async getToken(){return {tokens:{id_token:'test',refresh_token:'test',scope:state.oauth.scope.join(' ')}};}async verifyIdToken(){return {getPayload:()=>({sub:'owner',name:'Teacher',email:'teacher@school.org',email_verified:true,nonce:state.oauth.nonce})};}async request({url,method,data,params={}}){
  if(method==='PATCH'){state.grade=data;return {data};}if(url.endsWith(':return'))return {data:{}};
  if(url.endsWith('/studentSubmissions'))return {data:{studentSubmissions:[{id:'submission',userId:'student',courseId:'course',courseWorkId:'work',associatedWithDeveloper:true,state:'TURNED_IN'}]}};
  if(url.endsWith('/courseWork/work'))return {data:{...state.work,state:'PUBLISHED',maxPoints:state.work.maxPoints}};
  if(url.endsWith('/courseWork')){if(method==='POST'){state.work={...data,id:'work',associatedWithDeveloper:true};return {data:state.work};}return {data:{courseWork:state.work?[state.work]:[]}};}
  if(url.includes('/teachers/')){if(!state.teacher || !url.endsWith('/owner'))throw {response:{status:404}};return {data:{userId:'owner'}};}
  if(url.endsWith('/students')){if(state.rosterFailure)throw {response:{status:403}};const students=[{userId:'student',profile:{name:{fullName:'Alex Student'}}},{userId:'student2',profile:{name:{fullName:'Blair Student'}}},{userId:'student3',profile:{name:{fullName:'Casey Student'}}}];return {data:params.pageToken?{students:students.slice(2)}:{students:students.slice(0,2),nextPageToken:'next'}};}
  if(url.includes('/students/')){if(!state.enrolled)throw {response:{status:404}};return {data:{userId:url.split('/').pop()}};}
  return {data:{id:'course',name:'Test class',courseState:'ACTIVE'}};
 }}
 function load(name){if(cache.has(name))return cache.get(name).exports;const module={exports:{}};cache.set(name,module);const context={module,exports:module.exports,Date:class extends Date {static now(){return state.now ?? Date.now();}},console,URL,URLSearchParams,Buffer,__dirname:path.join(__dirname,'../lib'),process:{env:{BLOB_READ_WRITE_TOKEN:'test',GOOGLE_CLASSROOM_CLIENT_ID:'test',GOOGLE_CLASSROOM_CLIENT_SECRET:'test'}},fetch:async url=>({ok:blobs.has(url),text:async()=>blobs.get(url)}),require:n=>{
   if(n==='./openai-text')return {generateOpenAIText:async(...args)=>{if(!state.aiGenerator)throw Error('No test AI response configured');return state.aiGenerator(...args);}};
   if(n==='./quiz-correction-email')return {sendCorrectedTest:async data=>{state.emailed=data;if(state.emailFailure)throw Error('Email failed');return {status:'accepted',to:data.record.email};}};
   if(n==='google-auth-library')return {OAuth2Client};
   if(n==='@vercel/blob')return {list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p}))}),put:async(p,s,o)=>{if(!o.allowOverwrite&&blobs.has(p))throw Error('exists');blobs.set(p,s);},del:async p=>blobs.delete(p)};
   if(n==='./vocabulary-pages')return {getPage:async()=>({}),authenticatePage:(_,pw)=>pw==='secret'?null:{status:401,error:'Bad password'}};
   if(n.startsWith('./quiz-'))return load(n.slice(2));return require(n);
 }};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.js'),'utf8'),context);return module.exports;}
 const account=load('quiz-account'),builder=load('quiz-builder'),submissions=load('quiz-custom-submissions');
 blobs.set('quiz-google/teachers/owner.txt',account.seal({refreshToken:'test'}));
 function req(body={},user='owner',query={}){return {method:'POST',query,body,headers:{origin:ORIGIN,cookie:'__Host-penina-quiz-session='+account.seal({kind:'session',sub:user,role:user.startsWith('student')?'student':'teacher',name:user,email:user+'@school.org',exp:Date.now()+86400000})}};}
 async function call(handler,request){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=JSON.parse(JSON.stringify(data));return this;},end(){return this;}};await handler(request,res);return res;}
 async function publish(quiz=fixture()){const saved=await call(builder.handle,req({action:'save',quiz}));assert.equal(saved.code,200);const id=saved.data.quiz.id;assert.equal((await call(builder.handle,req({action:'publish',id}))).code,200);return id;}
 return {blobs,account,builder,submissions,state,req,call,publish};
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
 const accepted=await h.call(h.submissions,h.req(body,'student'));assert.equal(accepted.code,200);assert(!JSON.stringify(accepted.data).includes('correctAnswer'));assert.equal((await h.call(h.submissions,h.req(body,'student'))).code,200);
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
test('Ordering earns points per correct position; multiple-answer scoring requires the specified selection count',()=>{
 const q=fixture();q.questions.forEach(item=>item.scoringMode='response');
 const answers=correctAnswers();answers[2]=['A','B'];answers[4]=['א','ב'];
 const graded=model.grade(q,answers,{scores:[2]});assert.equal(graded.baseMax,11);assert.equal(graded.total,8);assert.equal(graded.automatic.find(v=>v.index===2).score,1);
 answers[2]=['A','B','C'];assert(!model.validAnswers(q,answers));assert.equal(model.grade(q,answers).automatic.find(v=>v.index===2).score,0);
 answers[2]=['A'];assert(!model.validAnswers(q,answers));assert(model.validAnswers(q,answers,true));
 const order={type:'order',prompt:'Order',points:2,scoringMode:'response',choices:['A','B','C'],answer:['A','B','C']};assert.equal(model.grade({questions:[order]},[['A','C','B']]).total,2);
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
test('Vocabulary keys validate, hide answers, count matches and retain distractors',()=>{
 const quiz=model.validateQuiz(vocabularyFixture(),true),safe=model.publicQuestions(quiz);
 assert.equal(model.maxPoints(quiz.questions[0]),4);assert.deepEqual(safe[0].items,['lucid','reluctant']);
 assert.deepEqual(safe[0].choices,['clear','unwilling','swift']);assert.equal(safe[1].wordBank,false);assert.deepEqual(safe[1].choices,[]);
 assert(safe.every(q=>!Object.hasOwn(q,'answer')));
 for(const mutate of [q=>q.questions[0].items=['lucid'],q=>q.questions[0].items=['','reluctant'],q=>q.questions[0].answer=['swift','absent'],q=>q.questions[1].answer=[''],q=>q.questions[1].prompt='No blank',q=>q.questions[1].wordBank='no']){
  const q=vocabularyFixture();mutate(q);assert.throws(()=>model.validateQuiz(q,true));
 }
});
test('Vocabulary grading excludes distractors, handles partial credit and leaves typed answers for correction',()=>{
 const quiz=model.validateQuiz(vocabularyFixture(),true),answers=[['clear','swift'],[' LUCID '],['reluctant']];
 assert(model.validAnswers(quiz,answers));assert.equal(model.grade(quiz,answers).earnedSoFar,3);assert.equal(model.grade(quiz,answers).pending,1);
 answers[0]=['clear','unwilling'];assert.equal(model.grade(quiz,answers).earnedSoFar,5);
 quiz.questions[0].scoringMode='total';answers[0]=['clear','swift'];assert.equal(model.grade(quiz,answers).earnedSoFar,1);
 answers[0]=['absent','swift'];assert(!model.validAnswers(quiz,answers));
 const empty=[['',''],[''],['']];assert(!model.validAnswers(quiz,empty));assert(model.validAnswers(quiz,empty,true));assert.equal(model.grade(quiz,empty).total,null);
 quiz.questions.forEach(q=>q.extraCredit=true);assert(model.validAnswers(quiz,empty));
});
test('Vocabulary questions survive saving, publishing, student submission and reporting',async()=>{
 const h=harness(),id=await h.publish(vocabularyFixture());
 const assigned=await h.call(h.account.handle,h.req({action:'assign',courseId:'course',quiz:id}));assert.equal(assigned.code,200);
 const classId=new URL(assigned.data.url).searchParams.get('class');assert.equal(h.state.work.maxPoints,6);
 const request=h.req({},'student',{action:'student',quiz:id,classId});request.method='GET';
 const identity=await h.call(h.account.handle,request);assert.equal(identity.code,200);assert.equal(identity.data.questions[0].items.length,2);assert(!Object.hasOwn(identity.data.questions[1],'answer'));
 const attemptId='e'.repeat(32),start=await h.call(h.submissions,h.req({action:'start',id:attemptId,classId,quiz:id},'student'));assert.equal(start.code,200);
 const result=await h.call(h.submissions,h.req({action:'submit',id:attemptId,classId,quiz:id,token:start.data.token,answers:[['clear','swift'],['LUCID'],['reluctant']]},'student'));assert.equal(result.code,200);
 const report=await h.call(h.submissions,h.req({action:'report',quiz:id}));assert.equal(report.code,200);assert.equal(report.data.submissions[0].grading.total,null);assert.equal(report.data.submissions[0].grading.pending,1);
 assert(!result.data.automatic.some(q=>q.index===1));
 const corrected=await h.call(h.submissions,h.req({action:'correct',id:attemptId,quiz:id,scores:[1],feedback:'',sendToClassroom:true}));
 assert.equal(corrected.code,200);assert.equal(corrected.data.grading.total,4);assert.equal(corrected.data.grading.pending,0);
});


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
test('Generated quiz endpoint honors edited distractors and returns a validated editable question list',async()=>{
 const h=harness(),rows=[{word:'ברור',definition:'clear',definitionDistractors:['teacher edited distractor'],wordDistractors:['slow']},{word:'מהסס',definition:'unwilling',definitionDistractors:['eager'],wordDistractors:['fast']}];
 const result=await h.call(h.builder.handle,h.req({action:'vocabulary-questions',rows,count:7,types:['choice','match'],offset:0}));assert.equal(result.code,200);assert.equal(result.data.questions.length,7);assert(result.data.questions[0].choices.includes('teacher edited distractor'));
 const draft={title:'Generated quiz',durationMinutes:null,questions:result.data.questions};const id=await h.publish(draft);assert.equal((await h.builder.published(id)).questions.length,7);
 h.state.aiGenerator=async()=>JSON.stringify({rows:[{index:0,definitionDistractors:['opaque','dark','rapid'],wordDistractors:['hazy','dim','quick']}]});
 const regenerated=await h.call(h.builder.handle,h.req({action:'vocabulary-distractors',rows,index:0}));assert.equal(regenerated.code,200);assert.equal(regenerated.data.rows[0].definition,'clear');assert.deepEqual(regenerated.data.rows[1],rows[1]);
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

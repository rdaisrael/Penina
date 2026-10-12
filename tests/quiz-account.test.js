const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness() {
    const blobs=new Map(),calls=[],requests=[],state={enrolled:true,teacher:true,active:true,googleFailure:false,invalidToken:false};
    const env={GOOGLE_CLASSROOM_CLIENT_ID:'test-client',GOOGLE_CLASSROOM_CLIENT_SECRET:'test-secret',BLOB_READ_WRITE_TOKEN:'test-blob'};
    class OAuth2Client {
        setCredentials(value){this.credentials=value;}
        generateAuthUrl(options){state.options=options;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+options.state;}
        async getToken(options){state.exchange=options;return {tokens:{id_token:'verified-by-library',refresh_token:'refresh-secret',scope:[...state.options.scope].join(' ')}};}
        async verifyIdToken(options){state.verification=options;if(state.invalidToken)throw Error('Invalid signature or audience');return {getPayload:()=>({sub:'student-id',email:'student@school.org',name:'Student',email_verified:true,nonce:state.wrongNonce?'wrong':state.options.nonce})};}
        async request({url,params,paramsSerializer,method='GET',data}) {
            requests.push({url,params,method,data,query:paramsSerializer(params)});
            if(url.endsWith(':return')) {if(state.returnFailure)throw {response:{status:503}};return {data:{}};}
            if(method==='PATCH')return {data:{...data,id:'submission-1'}};
            if(url.endsWith('/studentSubmissions'))return {data:{studentSubmissions:[{id:'submission-1',userId:state.wrongStudent?'other':'student-id',courseId:'course-1',courseWorkId:'work-1',associatedWithDeveloper:!state.foreignWork,state:state.submissionState || 'TURNED_IN'}]}};
            if(url.endsWith('/courseWork/work-1'))return {data:{id:'work-1',associatedWithDeveloper:!state.foreignWork,state:state.draft?'DRAFT':'PUBLISHED',maxPoints:state.changedMax?20:12}};
            if(url.endsWith('/courseWork')) {
                if(method==='POST') {if(state.createDenied)throw {response:{status:403}};state.created={id:'work-1',associatedWithDeveloper:true,state:'DRAFT',alternateLink:'https://classroom.google.com/test',materials:data.materials};return {data:state.created};}
                return {data:{courseWork:state.created?[state.created]:[]}};
            }
            calls.push(url);if(state.googleFailure)throw {response:{status:503}};
            if(url.includes('/students/')) {if(!state.enrolled || !url.endsWith('/student-id'))throw {response:{status:404}};return {data:{userId:'student-id'}};}
            if(url.includes('/teachers/')) {if(!state.teacher || !url.endsWith('/teacher-id'))throw {response:{status:404}};return {data:{userId:'teacher-id'}};}
            return {data:{id:'course-1',name:'Gemara',courseState:state.active?'ACTIVE':'ARCHIVED'}};
        }
    }
    const ctx={__dirname:path.join(__dirname,'../lib'),module:{exports:{}},URL,URLSearchParams,Buffer,process:{env},fetch:async url=>({ok:true,text:async()=>blobs.get(url)}),require:n=>{
        if(n==='crypto')return require('crypto');
        if(n==='google-auth-library')return {OAuth2Client};
        if(n==='@vercel/blob')return {del:async p=>blobs.delete(p),list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p}))}),put:async(p,s,options)=>{if(options?.allowOverwrite===false && blobs.has(p))throw Error('Already exists');blobs.set(p,s);}};
        if(n==='./vocabulary-pages')return {getPage:async()=>({}),authenticatePage:(_,p)=>p==='teacher-secret'?null:{status:401,error:'Incorrect password'}};
        if(n.endsWith('questions.json'))return require('../Penina-Quizzes/gemara-6-wl-2/questions.json');
        return require(n);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/quiz-account.js'),'utf8'),ctx);
    const api=ctx.module.exports;
    blobs.set('quiz-google/classes/'+ 'c'.repeat(32)+'.txt',api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',className:'Gemara'}));
    blobs.set('quiz-google/teachers/teacher-id.txt',api.seal({refreshToken:'stored-refresh-token'}));
    function cookie(user={}) {return '__Host-penina-quiz-session='+api.seal({kind:'session',sub:'student-id',name:'Student',email:'student@school.org',role:'student',exp:Date.now()+3600000,...user});}
    function request(overrides={}){return {method:'GET',query:{action:'student',classId:'c'.repeat(32)},headers:{cookie:cookie(),origin:'https://www.penina-hebrew.org'},...overrides};}
    async function run(req=request()) {const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(d){this.data=d;return this;},end(d){this.data=d;return this;}};await api.handle(req,res);return res;}
    return {api,state,calls,requests,blobs,cookie,request,run,env};
}
test('Questions require a valid session and exact current Classroom membership',async()=>{
    const h=harness();assert.equal((await h.run()).code,200);
    assert(h.calls.some(url=>url.endsWith('/students/student-id')));
    h.state.enrolled=false;assert.equal((await h.run()).code,403);
    const denied=await h.run(h.request({headers:{}}));assert.equal(denied.code,401);assert.equal(denied.data.questions,undefined);
});
test('Same email with a different Google ID cannot impersonate an enrolled student',async()=>{
    const h=harness();const req=h.request({headers:{cookie:h.cookie({sub:'impostor'})}});assert.equal((await h.run(req)).code,403);
});
test('Unknown classes, archived courses, removed teachers and unavailable roster checks fail closed',async()=>{
    const h=harness();assert.equal((await h.run(h.request({query:{action:'student',classId:'d'.repeat(32)}}))).code,403);
    h.state.active=false;assert.equal((await h.run()).code,403);h.state.active=true;
    h.state.teacher=false;assert.equal((await h.run()).code,403);h.state.teacher=true;
    h.state.googleFailure=true;assert.equal((await h.run()).code,503);
});
test('Expired or tampered sessions cannot retrieve questions or images',async()=>{
    const h=harness();
    for(const action of ['student','image'])for(const cookie of [h.cookie({exp:1}),h.cookie()+'tampered']) {
        assert.equal((await h.run(h.request({query:{action,classId:'c'.repeat(32)},headers:{cookie}}))).code,401);
    }
});
test('Teacher authorization and same-origin requests are required before OAuth starts',async()=>{
    const h=harness();const req=h.request({method:'POST',query:{},body:{action:'login',role:'teacher',password:'wrong'}});
    assert.equal((await h.run(req)).code,401);req.body.password='teacher-secret';req.headers.origin='https://attacker.example';assert.equal((await h.run(req)).code,403);
    req.headers.origin='https://www.penina-hebrew.org';const result=await h.run(req);assert.equal(result.code,200);
    assert(h.state.options.scope.includes('https://www.googleapis.com/auth/classroom.rosters.readonly'));
    assert.equal(h.state.options.access_type,'offline');assert(result.headers['Set-Cookie'].includes('HttpOnly; Secure; SameSite=Lax'));
});
test('OAuth callback validates state, nonce, audience and PKCE before issuing a session',async()=>{
    const h=harness();const login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'student',classId:'c'.repeat(32)}}));
    const cookie=login.headers['Set-Cookie'].split(';')[0];
    const callback=h.request({query:{action:'callback',state:'wrong',code:'code'},headers:{cookie}});
    assert.equal((await h.run(callback)).code,400);assert.equal(h.state.exchange,undefined);
    callback.query.state=h.state.options.state;
    const response=await h.run(callback);assert.equal(response.code,303);assert(response.headers.Location.endsWith('?class='+'c'.repeat(32)));
    assert.equal(h.state.verification.audience,'test-client');assert(h.state.exchange.codeVerifier);
    assert.equal(h.state.options.scope.length,3);assert.equal(h.state.options.prompt,'select_account');
    h.state.wrongNonce=true;assert.equal((await h.run(callback)).code,401);h.state.wrongNonce=false;
    h.state.invalidToken=true;assert.notEqual((await h.run(callback)).code,303);
});
test('Students cannot configure class assignments and unconfigured sign-in stays closed',async()=>{
    const h=harness();assert.equal((await h.run(h.request({method:'POST',query:{},body:{action:'assign',courseId:'course-1'}}))).code,403);
    delete h.env.GOOGLE_CLASSROOM_CLIENT_ID;
    assert.equal((await h.run(h.request({method:'POST',query:{},body:{action:'login',classId:'c'.repeat(32)}}))).code,503);
});

test('Only an enrolled student can retrieve the quiz image',async()=>{
    const h=harness();const req=h.request({query:{action:'image',classId:'c'.repeat(32)}});
    const result=await h.run(req);assert.equal(result.code,200);assert.equal(result.headers['Content-Type'],'image/png');assert(Buffer.isBuffer(result.data));
    h.state.enrolled=false;assert.equal((await h.run(req)).code,403);
});
test('Only a teacher of the selected class can issue a class link',async()=>{
    const h=harness();const req=h.request({method:'POST',query:{},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'},body:{action:'assign',courseId:'course-1'}});
    h.state.teacher=false;assert.equal((await h.run(req)).code,403);
    h.state.teacher=true;const result=await h.run(req);assert.equal(result.code,200);assert(result.data.url.includes('?class='));
    assert.equal(result.data.classroomURL,'https://classroom.google.com/test');
    const created=h.requests.find(r=>r.method==='POST');assert.equal(created.data.state,'DRAFT');assert.equal(created.data.maxPoints,12);assert.equal(created.data.materials[0].link.url,result.data.url);
    assert.equal((await h.run(req)).code,200);assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
    const stored=[...h.blobs.entries()].find(([name])=>name.includes(new URL(result.data.url).searchParams.get('class')))[1];
    assert(!stored.includes('teacher-id'));assert(!stored.includes('course-1'));
});

test('Class teacher can take the quiz without student enrollment; role and email alone grant no exception',async()=>{
    const h=harness();h.state.enrolled=false;
    const req=h.request({headers:{cookie:h.cookie({sub:'teacher-id',email:'disrael@saracademy.org',role:'student'})}});
    const teacher=await h.run(req);assert.equal(teacher.code,200);assert.equal(teacher.data.isClassTeacher,true);
    h.state.teacher=false;assert.equal((await h.run(req)).code,403);h.state.teacher=true;
    req.headers.cookie=h.cookie({sub:'impostor',email:'disrael@saracademy.org',role:'teacher'});
    assert.equal((await h.run(req)).code,403);
    h.state.enrolled=true;const student=await h.run();assert.equal(student.data.isClassTeacher,false);
});

function gradeFixture(h) {
    const classId='c'.repeat(32);
    h.blobs.set('quiz-google/classes/'+classId+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1'}));
    return {req:h.request({method:'POST',headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'}}),record:{sub:'student-id',classId},grading:{pending:0,total:15.5}};
}
test('Grade transfer binds to stored assignment and student, preserves extra credit, and returns turned-in work',async()=>{
    const h=harness(),f=gradeFixture(h);
    const result=await h.api.sendGrade(f.req,f.record,f.grading);
    assert.equal(result.score,15.5);assert.equal(result.returned,true);
    const patch=h.requests.find(r=>r.method==='PATCH');assert(patch.url.endsWith('/courseWork/work-1/studentSubmissions/submission-1'));
    assert.equal(patch.params.updateMask,'draftGrade,assignedGrade');assert.equal(patch.data.draftGrade,15.5);assert.equal(patch.data.assignedGrade,15.5);
});
test('Grade transfer refuses incomplete corrections, wrong teacher, practice and legacy submissions, foreign assignments, and wrong student',async()=>{
    for(const change of [
        (h,f)=>f.grading.pending=1,
        (h,f)=>f.record.isClassTeacher=true,
        (h,f)=>delete f.record.sub,
        (h,f)=>f.req.headers.cookie=h.cookie({sub:'other-teacher',role:'teacher'}),
        (h,f)=>f.req.headers.origin='https://evil.example',
        h=>h.state.foreignWork=true,
        h=>h.state.changedMax=true,
        h=>h.state.draft=true,
        h=>h.state.wrongStudent=true,
        h=>h.state.teacher=false,
        h=>h.state.enrolled=false,
        h=>h.state.active=false
    ]) {
        const h=harness(),f=gradeFixture(h);change(h,f);
        await assert.rejects(()=>h.api.sendGrade(f.req,f.record,f.grading));assert(!h.requests.some(r=>r.method==='PATCH'));
    }
});
test('Grades can be retried after return failure; unsubmitted work is not falsely reported as returned',async()=>{
    const h=harness(),f=gradeFixture(h);h.state.returnFailure=true;
    assert.equal((await h.api.sendGrade(f.req,f.record,f.grading)).returnPending,true);
    h.state.returnFailure=false;assert.equal((await h.api.sendGrade(f.req,f.record,f.grading)).returned,true);
    h.state.submissionState='NEW';const before=h.requests.filter(r=>r.url.endsWith(':return')).length;
    const result=await h.api.sendGrade(f.req,f.record,f.grading);assert.equal(result.needsTurnIn,true);assert.equal(result.returned,false);
    assert.equal(h.requests.filter(r=>r.url.endsWith(':return')).length,before);
});
test('Assignment creation recovers after the mapping write is lost without duplicating coursework',async()=>{
    const h=harness();const req=h.request({method:'POST',query:{},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'},body:{action:'assign',courseId:'course-1'}});
    const first=await h.run(req),classId=new URL(first.data.url).searchParams.get('class');
    h.blobs.delete('quiz-google/classes/'+classId+'.txt');
    assert.equal((await h.run(req)).code,200);assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
});

test('A rejected Classroom creation can retry after permission is fixed',async()=>{
    const h=harness();h.state.createDenied=true;
    const req=h.request({method:'POST',query:{},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'},body:{action:'assign',courseId:'course-1'}});
    assert.equal((await h.run(req)).code,503);h.state.createDenied=false;
    assert.equal((await h.run(req)).code,200);
});

test('Classroom assignment filters are sent as repeated parameters rather than a comma-separated enum',async()=>{
    const h=harness();
    await h.run(h.request({method:'POST',query:{},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'},body:{action:'assign',courseId:'course-1'}}));
    const request=h.requests.find(r=>r.url.endsWith('/courseWork') && r.method==='GET');
    assert.deepEqual(new URLSearchParams(request.query).getAll('courseWorkStates'),['DRAFT','PUBLISHED']);
    assert(!request.query.includes('DRAFT%2CPUBLISHED'));
});

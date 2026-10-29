const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness() {
    const blobs=new Map(),calls=[],requests=[],state={enrolled:true,teacher:true,active:true,googleFailure:false,invalidToken:false};
    const env={GOOGLE_CLASSROOM_CLIENT_ID:'test-client',GOOGLE_CLASSROOM_CLIENT_SECRET:'test-secret',BLOB_READ_WRITE_TOKEN:'test-blob'};
    class OAuth2Client {
        setCredentials(value){this.credentials=value;}
        generateAuthUrl(options){state.options=options;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+options.state;}
        async getToken(options){state.exchange=options;return {tokens:{id_token:'verified-by-library',refresh_token:state.noRefresh?undefined:'refresh-secret',scope:[...state.options.scope].join(' ')}};}
        async verifyIdToken(options){state.verification=options;if(state.invalidToken)throw Error('Invalid signature or audience');return {getPayload:()=>({sub:'student-id',email:state.email || 'student@school.org',name:'Student',email_verified:!state.unverified,nonce:state.wrongNonce?'wrong':state.options.nonce})};}
        async request({url,params,paramsSerializer,method='GET',data}) {
            requests.push({url,params,method,data,credentials:this.credentials,query:paramsSerializer(params)});
            if(url.endsWith(':turnIn')){if(state.turnInFailure)throw {response:{status:503}};state.submissionState='TURNED_IN';return {data:{}};}
            if(url.endsWith(':return')) {if(state.returnFailure)throw {response:{status:503}};return {data:{}};}
            if(method==='PATCH')return {data:{...data,id:'submission-1'}};
            if(url.endsWith('/studentSubmissions'))return {data:{studentSubmissions:[{id:'submission-1',userId:state.wrongStudent?'other':'student-id',courseId:'course-1',courseWorkId:'work-1',associatedWithDeveloper:!state.foreignWork,state:state.submissionState || 'TURNED_IN'}]}};
            if(state.works && state.works[url.split('/').pop()])return {data:state.works[url.split('/').pop()]};
            if(url.endsWith('/courseWork/work-1') && state.workUnavailable)throw {response:{status:503}};
            if(url.endsWith('/courseWork/work-1'))return {data:{id:'work-1',associatedWithDeveloper:!state.foreignWork,state:state.draft?'DRAFT':'PUBLISHED',maxPoints:state.changedMax?20:(state.maxPoints || 12)}};
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
        if(n==='./quiz-email-login')return {request:async()=>({message:'Check your email.'}),verify:async()=>({sub:'email:2',email:'teacher@outlook.com',name:'Teacher',userId:2,role:'teacher',authMethod:'email'})};
        if(n==='./teacher-apps')return require('../lib/teacher-apps');
        if(n==='./quiz-teachers')return {registered:async email=>email==='disrael@saracademy.org'?{userId:1,email}:email==='second@school.org'?{userId:2,email}:null};
        if(n==='./vocabulary-pages')return {getPage:async()=>({}),authenticatePage:(_,p)=>p==='teacher-secret'?null:{status:401,error:'Incorrect password'}};
        if(n.endsWith('questions.json'))return require(n);
        return require(n);
    }};
    const source=fs.readFileSync(path.join(__dirname,'../lib/quiz-account.js'),'utf8');
    const salt=source.match(/const TEACHER_SALT = '([^']+)'/)[1];
    const testHash=require('crypto').scryptSync('portal-test-password',salt,64).toString('hex');
    vm.runInNewContext(source.replace(/const TEACHER_HASH = '[^']+'/,"const TEACHER_HASH = '"+testHash+"'"),ctx);
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
    assert.equal(h.state.options.scope.length,4);assert(h.state.options.scope.includes('https://www.googleapis.com/auth/classroom.coursework.me'));assert.equal(h.state.options.access_type,'offline');assert(h.blobs.has('quiz-google/students/student-id.txt'));assert(!h.blobs.get('quiz-google/students/student-id.txt').includes('refresh-secret'));assert.equal(h.api.unseal(h.blobs.get('quiz-google/students/student-id.txt')).refreshToken,'refresh-secret');assert.equal(h.state.options.prompt,'select_account');
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
test('Grade transfer binds to stored assignment and student, preserves extra credit, and saves only a draft',async()=>{
    const h=harness(),f=gradeFixture(h);
    const result=await h.api.sendGrade(f.req,f.record,f.grading);
    assert.equal(result.score,15.5);assert.equal(result.draft,true);
    const patch=h.requests.find(r=>r.method==='PATCH');assert(patch.url.endsWith('/courseWork/work-1/studentSubmissions/submission-1'));
    assert.equal(patch.params.updateMask,'draftGrade');assert.equal(patch.data.draftGrade,15.5);assert.equal(patch.data.assignedGrade,undefined);assert(!h.requests.some(r=>r.url.endsWith(':return')));
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
test('Draft grades update without returning work, regardless of submission state',async()=>{
    const h=harness(),f=gradeFixture(h);
    for(const state of ['NEW','TURNED_IN','RETURNED']) {
        h.state.submissionState=state;
        f.grading.total-=1;
        const result=await h.api.sendGrade(f.req,f.record,f.grading);
        assert.equal(result.draft,true);
        assert.equal(h.requests.filter(r=>r.method==='PATCH').at(-1).data.draftGrade,f.grading.total);
    }
    assert(!h.requests.some(r=>r.url.endsWith(':return')));
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

test('Retake assignment has a separate class link and eight-point Classroom draft',async()=>{
    const h=harness(),req=h.request({method:'POST',query:{},body:{action:'assign',courseId:'course-1',quiz:'gemara-6-intro-retake'},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'}});
    const result=await h.run(req);assert.equal(result.code,200);assert(result.data.url.includes('/gemara-6-intro-retake/'));
    const created=h.requests.find(r=>r.method==='POST');assert.equal(created.data.maxPoints,8);assert.equal(created.data.state,'DRAFT');
    const id=new URL(result.data.url).searchParams.get('class');
    assert.equal(h.api.unseal(h.blobs.get('quiz-google/classes/'+id+'.txt')).quiz,'gemara-6-intro-retake');
    const student=h.request({query:{action:'student',classId:id,quiz:'gemara-6-intro-retake'}});
    assert.equal((await h.run(student)).data.questions.length,6);
    student.query.quiz='gemara-6-wl-2';assert.equal((await h.run(student)).code,403);
    await assert.rejects(h.api.requireStudent(h.request(),'c'.repeat(32),'gemara-6-intro-retake'),/not been assigned/);
});
test('Retake sign-in returns to the retake, and unknown quiz IDs cannot redirect',async()=>{
    const h=harness(),login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'student',quiz:'gemara-6-intro-retake',classId:'c'.repeat(32)}}));
    const result=await h.run(h.request({query:{action:'callback',code:'code',state:h.state.options.state},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}}));
    assert.equal(result.code,303);assert(result.headers.Location.startsWith('/Penina-Quizzes/gemara-6-intro-retake/'));
    assert.equal((await h.run(h.request({query:{action:'config',quiz:'../../external'}}))).code,400);
});
test('Retake grades use its eight-point assignment and cannot target the original quiz',async()=>{
    const h=harness(),classId='c'.repeat(32),record={classId,sub:'student-id'},grading={pending:0,total:7.5};
    h.blobs.set('quiz-google/classes/'+classId+'.txt',h.api.seal({quiz:'gemara-6-intro-retake',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1'}));
    const req=h.request({headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'}});
    await assert.rejects(h.api.sendGrade(req,record,grading),/assigned this quiz/);
    await assert.rejects(h.api.sendGrade(req,record,grading,'gemara-6-intro-retake'),/8 points/);
    h.state.maxPoints=8;const sent=await h.api.sendGrade(req,record,grading,'gemara-6-intro-retake');
    assert.equal(sent.maxPoints,8);assert.equal(sent.score,7.5);assert.equal(sent.draft,true);
});

test('Grade 8 retake assignment has a separate class link and eight-point Classroom draft',async()=>{
    const h=harness(),req=h.request({method:'POST',query:{},body:{action:'assign',courseId:'course-1',quiz:'gemara-8-intro-retake'},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'}});
    const result=await h.run(req);assert.equal(result.code,200);assert(result.data.url.includes('/gemara-8-intro-retake/'));
    const created=h.requests.find(r=>r.method==='POST');assert.equal(created.data.maxPoints,8);assert.equal(created.data.state,'DRAFT');
    const id=new URL(result.data.url).searchParams.get('class');
    assert.equal(h.api.unseal(h.blobs.get('quiz-google/classes/'+id+'.txt')).quiz,'gemara-8-intro-retake');
    const student=h.request({query:{action:'student',classId:id,quiz:'gemara-8-intro-retake'}});
    assert.equal((await h.run(student)).data.questions.length,6);
    student.query.quiz='gemara-6-wl-2';assert.equal((await h.run(student)).code,403);
    await assert.rejects(h.api.requireStudent(h.request(),'c'.repeat(32),'gemara-8-intro-retake'),/not been assigned/);
});
test('Grade 8 retake sign-in returns to the retake, and unknown quiz IDs cannot redirect',async()=>{
    const h=harness(),login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'student',quiz:'gemara-8-intro-retake',classId:'c'.repeat(32)}}));
    const result=await h.run(h.request({query:{action:'callback',code:'code',state:h.state.options.state},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}}));
    assert.equal(result.code,303);assert(result.headers.Location.startsWith('/Penina-Quizzes/gemara-8-intro-retake/'));
    assert.equal((await h.run(h.request({query:{action:'config',quiz:'../../external'}}))).code,400);
});
test('Grade 8 retake grades use its eight-point assignment and cannot target the original quiz',async()=>{
    const h=harness(),classId='c'.repeat(32),record={classId,sub:'student-id'},grading={pending:0,total:7.5};
    h.blobs.set('quiz-google/classes/'+classId+'.txt',h.api.seal({quiz:'gemara-8-intro-retake',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1'}));
    const req=h.request({headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'}});
    await assert.rejects(h.api.sendGrade(req,record,grading),/assigned this quiz/);
    await assert.rejects(h.api.sendGrade(req,record,grading,'gemara-8-intro-retake'),/8 points/);
    h.state.maxPoints=8;const sent=await h.api.sendGrade(req,record,grading,'gemara-8-intro-retake');
    assert.equal(sent.maxPoints,8);assert.equal(sent.score,7.5);assert.equal(sent.draft,true);
});

test('Google-only teacher login derives privileges from the verified registered email',async()=>{
    const h=harness(), req=h.request({method:'POST',query:{},body:{action:'login',role:'teacher',portal:true,userId:1,email:'disrael@saracademy.org'}});
    const login=await h.run(req);assert.equal(login.code,200);assert.equal(h.state.options.prompt,'select_account');
    const callback=h.request({query:{action:'callback',state:h.state.options.state,code:'code'},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}});
    assert.equal((await h.run(callback)).code,403);
    assert.equal(h.blobs.has('quiz-google/teachers/student-id.txt'),false);
    h.state.email='disrael@saracademy.org';h.state.unverified=true;assert.equal((await h.run(callback)).code,401);h.state.unverified=false;
    const result=await h.run(callback);assert.equal(result.code,303);assert.equal(result.headers.Location,'/');
    const cookie=result.headers['Set-Cookie'][1].split(';')[0];
    assert(result.headers['Set-Cookie'][1].includes('Max-Age=2592000'));
    assert.equal(h.api.isAccountOwner({headers:{cookie}}),true);
    const info=await h.run(h.request({query:{action:'teacher'},headers:{cookie}}));assert.equal(info.data.userId,1);
});
test('Legacy grade login cannot create an owner portal session',async()=>{
    const h=harness();h.state.email='disrael@saracademy.org';
    const login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'teacher',password:'teacher-secret'}}));
    const result=await h.run(h.request({query:{action:'callback',code:'code',state:h.state.options.state},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}}));assert.equal(result.code,403);
});
test('Assignment list is restricted to the signed-in owner and excludes other teachers',async()=>{
    const h=harness(),headers={cookie:h.cookie({sub:'teacher-id',role:'teacher',userId:1,email:'disrael@saracademy.org'})};
    h.blobs.set('quiz-google/classes/'+ 'd'.repeat(32)+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1',className:'Gemara'}));
    h.blobs.set('quiz-google/classes/'+ 'e'.repeat(32)+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'someone-else',courseId:'course-2',courseWorkId:'work-2',className:'Private class'}));
    const result=await h.run(h.request({query:{action:'assignments'},headers}));assert.equal(result.code,200);assert.equal(result.data.assignments.length,1);assert.equal(result.data.assignments[0].classId,'d'.repeat(32));assert.equal(JSON.stringify(result.data).includes('Private class'),false);
    assert.equal((await h.run(h.request({query:{action:'assignments'}}))).code,403);
});
test('Publishing uses the stored assignment and requires active teacher membership',async()=>{
    const h=harness(),headers={cookie:h.cookie({sub:'teacher-id',role:'teacher'}),origin:'https://www.penina-hebrew.org'};
    const req=h.request({method:'POST',query:{},headers,body:{action:'publish-assignment',courseId:'course-1'}});
    assert.equal((await h.run(req)).code,403);
    assert.equal((await h.run({...req,body:{action:'assign',courseId:'course-1'}})).code,200);
    h.state.draft=true;assert.equal((await h.run(req)).code,200);
    const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.data.state,'PUBLISHED');assert.equal(patch.params.updateMask,'state');
    h.state.teacher=false;assert.equal((await h.run(req)).code,403);h.state.teacher=true;
    h.state.active=false;assert.equal((await h.run(req)).code,403);h.state.active=true;
    h.state.foreignWork=true;assert.equal((await h.run(req)).code,409);
    assert.equal((await h.run({...req,headers:{...headers,origin:'https://attacker.example'}})).code,403);
});

test('Saved assignments remain listed when Classroom status cannot be fetched',async()=>{
    const h=harness();h.state.workUnavailable=true;
    h.blobs.set('quiz-google/classes/'+ 'd'.repeat(32)+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1',className:'Gemara'}));
    const result=await h.run(h.request({query:{action:'assignments'},headers:{cookie:h.cookie({sub:'teacher-id',role:'teacher',userId:1,email:'disrael@saracademy.org'})}}));
    assert.equal(result.code,200);assert.equal(result.data.assignments.length,1);assert.equal(result.data.assignments[0].state,'UNKNOWN');
});


test('Correction list puts posted quizzes first by posting time, then drafts by creation time',async()=>{
    const h=harness(),headers={cookie:h.cookie({sub:'teacher-id',role:'teacher',userId:1,email:'disrael@saracademy.org'})};
    h.state.works={
        older:{state:'PUBLISHED',creationTime:'2026-01-01T10:00:00Z',updateTime:'2026-10-20T10:00:00Z'},
        draft:{state:'DRAFT',creationTime:'2026-10-15T10:00:00Z',updateTime:'2026-10-21T10:00:00Z'},
        newerDraft:{state:'DRAFT',creationTime:'2026-10-22T10:00:00Z',updateTime:'2026-10-22T10:00:00Z'},
        recent:{state:'PUBLISHED',creationTime:'2026-01-02T10:00:00Z',updateTime:'2026-10-19T10:00:00Z'}
    };
    for(const [i,id] of ['older','draft','recent','newerDraft'].entries())h.blobs.set('quiz-google/classes/'+String(i).repeat(32)+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:id,className:id,...(id==='older'?{postedAt:'2026-10-10T10:00:00Z'}:{})}));
    const load=()=>h.run(h.request({query:{action:'assignments'},headers}));
    let result=await load();
    assert.equal(result.code,200);
    assert.equal(result.data.assignments.map(a=>a.className).join(','),'recent,older,newerDraft,draft');
    h.state.works.recent.updateTime='2026-11-01T10:00:00Z';
    h.state.works.draft.state='PUBLISHED';
    result=await load();
    assert.equal(result.data.assignments.map(a=>a.className).join(','),'draft,recent,older,newerDraft');
    assert.equal(result.data.assignments[1].postedAt,'2026-10-19T10:00:00Z');
    delete h.state.works;
    h.state.googleFailure=true;
    result=await load();
    assert.equal(result.data.assignments.map(a=>a.className).join(','),'draft,recent,older,newerDraft');
});

test('Assigned teacher sign-in binds Google email and carries its number without owner privileges',async()=>{
 const h=harness();const login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'teacher',portal:true,email:'second@school.org',password:'2-signin'}}));
 assert.equal(login.code,200);assert.equal(h.state.options.prompt,'select_account');
 const callback=h.request({query:{action:'callback',state:h.state.options.state,code:'code'},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}});
 assert.equal((await h.run(callback)).code,403);
 h.state.email='second@school.org';const result=await h.run(callback);assert.equal(result.code,303);
 const cookie=result.headers['Set-Cookie'][1].split(';')[0];assert.equal(h.api.isAccountOwner({headers:{cookie}}),false);
 const info=await h.run(h.request({query:{action:'teacher'},headers:{cookie}}));assert.equal(info.data.userId,2);
});

test('Returning teachers reuse saved refresh tokens without repeating consent',async()=>{
 const h=harness();h.state.email='disrael@saracademy.org';h.state.noRefresh=true;
 h.blobs.set('quiz-google/teachers/student-id.txt',h.api.seal({refreshToken:'existing-token'}));
 const login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'teacher',portal:true}}));
 const result=await h.run(h.request({query:{action:'callback',state:h.state.options.state,code:'code'},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}}));
 assert.equal(result.code,303);assert.equal(result.headers.Location,'/');
 assert.equal(h.api.unseal(h.blobs.get('quiz-google/teachers/student-id.txt')).refreshToken,'existing-token');
 assert.equal(h.state.options.prompt,'select_account');
});
test('Missing offline access requests consent once, while explicit reconnect requests it immediately',async()=>{
 const h=harness();h.state.email='disrael@saracademy.org';h.state.noRefresh=true;
 const req=h.request({method:'POST',query:{},body:{action:'login',role:'teacher',portal:true}});
 const login=await h.run(req);
 const callback=(cookie)=>h.request({query:{action:'callback',state:h.state.options.state,code:'code'},headers:{cookie:cookie.split(';')[0]}});
 const retry=await h.run(callback(login.headers['Set-Cookie']));assert.equal(retry.code,303);assert(retry.headers.Location.startsWith('https://accounts.google.com/'));assert.equal(h.state.options.prompt,'consent');
 assert.equal((await h.run(callback(retry.headers['Set-Cookie']))).code,403);
 h.state.noRefresh=false;assert.equal((await h.run(callback(retry.headers['Set-Cookie']))).headers.Location,'/');
 req.body.reconnect=true;await h.run(req);assert.equal(h.state.options.prompt,'select_account consent');
});

 test('Archiving skips Classroom lookups until requested, persists, restores, and rejects other teachers',async()=>{
 const h=harness(),id='d'.repeat(32);
 h.blobs.set('quiz-google/classes/'+id+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1',className:'Gemara'}));
 const headers={cookie:h.cookie({sub:'teacher-id',role:'teacher',userId:1,email:'disrael@saracademy.org'}),origin:'https://www.penina-hebrew.org'};
 const change=archived=>h.run(h.request({method:'POST',headers,query:{},body:{action:'archive-assignment',classId:id,archived}}));
 assert.equal((await change(true)).code,200);
 h.requests.length=0;
 const active=await h.run(h.request({headers,query:{action:'assignments'}}));
 assert.equal(active.data.assignments.length,0);assert.equal(h.requests.length,0);
 const archive=await h.run(h.request({headers,query:{action:'assignments',archived:'true'}}));
 assert.equal(archive.data.assignments.length,1);assert.equal(archive.data.assignments[0].classId,id);
 assert.equal((await h.run(h.request({method:'POST',headers:{...headers,cookie:h.cookie({sub:'other',role:'teacher',userId:2})},query:{},body:{action:'archive-assignment',classId:id,archived:false}}))).code,403);
 assert.equal((await change(false)).code,200);
 assert.equal((await h.run(h.request({headers,query:{action:'assignments'}}))).data.assignments.length,1);
 assert.equal((await h.run(h.request({headers,query:{action:'assignments',archived:'true'}}))).data.assignments.length,0);
 });


function turnInFixture(h){
 const classId='c'.repeat(32);
 h.blobs.set('quiz-google/classes/'+classId+'.txt',h.api.seal({quiz:'gemara-6-wl-2',owner:'teacher-id',courseId:'course-1',courseWorkId:'work-1'}));
 h.blobs.set('quiz-google/students/student-id.txt',h.api.seal({scope:'https://www.googleapis.com/auth/classroom.coursework.me',refreshToken:'student-refresh'}));
 h.state.submissionState='CREATED';
 return {req:h.request({method:'POST'}),record:{sub:'student-id',classId}};
}
test('Turn-in uses only the submitting student credentials and never changes grades',async()=>{
 const h=harness(),f=turnInFixture(h);
 assert.equal((await h.api.turnInSubmission(f.req,f.record)).turnedIn,true);
 const call=h.requests.find(r=>r.url.endsWith(':turnIn'));assert(call);assert.equal(call.method,'POST');assert.equal(call.credentials.refresh_token,'student-refresh');assert(call.url.endsWith('/courseWork/work-1/studentSubmissions/submission-1:turnIn'));
 assert(!h.requests.some(r=>r.method==='PATCH' || r.url.endsWith(':return')));
 await h.api.turnInSubmission(f.req,f.record);assert.equal(h.requests.filter(r=>r.url.endsWith(':turnIn')).length,1);
 h.state.submissionState='RETURNED';await h.api.turnInSubmission(f.req,f.record);assert.equal(h.requests.filter(r=>r.url.endsWith(':turnIn')).length,1);
});
test('Turn-in rejects missing permission, wrong student, teacher sessions and foreign assignments',async()=>{
 for(const mutate of [
  (h,f)=>h.blobs.delete('quiz-google/students/student-id.txt'),
  (h,f)=>f.record.sub='someone-else',
  (h,f)=>f.req.headers.cookie=h.cookie({role:'teacher'}),
  h=>h.state.foreignWork=true,
  h=>h.state.wrongStudent=true,
  (h,f)=>f.record.classId='d'.repeat(32),
  (h,f)=>f.req.headers.origin='https://other.example'
 ]){const h=harness(),f=turnInFixture(h);mutate(h,f);await assert.rejects(()=>h.api.turnInSubmission(f.req,f.record));assert(!h.requests.some(r=>r.url.endsWith(':turnIn')));}
});
test('Turn-in failures can retry without publishing a grade',async()=>{
 const h=harness(),f=turnInFixture(h);h.state.turnInFailure=true;
 await assert.rejects(()=>h.api.turnInSubmission(f.req,f.record));h.state.turnInFailure=false;
 assert.equal((await h.api.turnInSubmission(f.req,f.record)).turnedIn,true);assert(!h.requests.some(r=>r.method==='PATCH'));
});


test('Email routes require same-origin POST and issue the normal secure teacher session',async()=>{
 const h=harness();
 for(const action of ['email-login','email-verify']){
  const req=h.request({method:'POST',query:{action},body:{},headers:{origin:'https://attacker.example'}});
  assert.equal((await h.run(req)).code,403);
  req.headers.origin='https://www.penina-hebrew.org';const result=await h.run(req);assert.equal(result.code,200);
  if(action==='email-verify'){
   const cookie=result.headers['Set-Cookie'][0];assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
   const user=h.api.session({headers:{cookie:cookie.split(';')[0]}});assert.equal(user.userId,2);assert.equal(user.email,'teacher@outlook.com');assert.equal(user.role,'teacher');
  }
 }
});

for (const returnHome of [undefined, false, true]) {
 test(`Account sign-in returns home with returnHome=${returnHome}`,async()=>{
  const h=harness();h.state.email='second@school.org';
  const login=await h.run(h.request({method:'POST',query:{},body:{action:'login',role:'teacher',portal:true,...(returnHome===undefined?{}:{returnHome})}}));
  assert.equal(login.code,200);
  const result=await h.run(h.request({query:{action:'callback',state:h.state.options.state,code:'code'},headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}}));
  assert.equal(result.code,303);assert.equal(result.headers.Location,'/');
 });
}

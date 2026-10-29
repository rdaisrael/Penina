'use strict';
const crypto = require('crypto');
const {OAuth2Client} = require('google-auth-library');
const {list, put, del} = require('@vercel/blob');
const {getPage, authenticatePage} = require('./vocabulary-pages');
const ORIGIN = 'https://www.penina-hebrew.org';

// User 1's verifier is server-only. Never store or return the plaintext password.
const TEACHER_EMAIL = 'disrael@saracademy.org';
const TEACHER_SALT = '9adf02a26beea55b4cd9895e5d5a455f';
const TEACHER_HASH = 'fcdc1e0f5d7e14a7beba84df41e5fdb782d2c77f78748acffd9b0b9f154de7f6baf0551e4273ea4492be61119665cb0337ed694a9cc3da0af995e2f61e1366dc';
function verifyTeacher(email,password) {
    if(typeof password!=='string' || password.length>256 || typeof email!=='string')return false;
    const candidate=crypto.scryptSync(password,TEACHER_SALT,64);
    return crypto.timingSafeEqual(candidate,Buffer.from(TEACHER_HASH,'hex')) && email.trim().toLowerCase()===TEACHER_EMAIL;
}
function isAccountOwner(req) {
    try {const user=session(req);return user.role==='teacher' && user.userId===1 && user.email.toLowerCase()===TEACHER_EMAIL;}catch(_){return false;}
}

const API = '/api/game-scores?game=quiz-account';
const REDIRECT = ORIGIN + API + '&action=callback';
const DEFAULT_QUIZ = 'gemara-6-wl-2';
const QUIZZES = {
    'gemara-6-wl-2': {title:'Gemara 6 · Quiz WL #2',maxPoints:12,description:'12 regular points plus up to 4 extra-credit points.'},
    'gemara-6-intro-retake': {title:'Gemara 6 WL - Intro (Retake)',maxPoints:8,description:'6 questions, worth 8 points. Questions 1 and 6 require teacher correction.'},
    'gemara-8-intro-retake': {title:'Gemara 8 WL - Intro (Retake)',maxPoints:8,description:'6 questions, worth 8 points. Questions 1 and 6 require teacher correction.'}
};
async function quizInfo(id = DEFAULT_QUIZ) {
    if(typeof id==='string' && /^custom-[a-f0-9]{32}$/.test(id))return require("./quiz-builder").info(id);
    if(typeof id !== 'string' || !Object.hasOwn(QUIZZES,id))fail(400,'Choose an available Penina quiz.');
    return {...QUIZZES[id],id,path:'/Penina-Quizzes/'+id+'/'};
}
async function quizQuestions(id) {
    if(typeof id==='string' && /^custom-[a-f0-9]{32}$/.test(id))return require("./quiz-builder-model").publicQuestions(await require("./quiz-builder").published(id));
    if(id==='gemara-8-intro-retake')return require('../Penina-Quizzes/gemara-8-intro-retake/questions.json');
    return id === DEFAULT_QUIZ ? require('../Penina-Quizzes/gemara-6-wl-2/questions.json') : require('../Penina-Quizzes/gemara-6-intro-retake/questions.json');
}
const SESSION = '__Host-penina-quiz-session', STATE = '__Host-penina-quiz-state';
const IDLE_MILLISECONDS = 10 * 60 * 1000;
const PREFIX = 'quiz-google/';
const SCOPES = ['openid','email','profile'];
const STUDENT_SCOPE = 'https://www.googleapis.com/auth/classroom.coursework.me';
const TEACHER_SCOPES = ['https://www.googleapis.com/auth/classroom.courses.readonly','https://www.googleapis.com/auth/classroom.rosters.readonly','https://www.googleapis.com/auth/classroom.coursework.students'];
function fail(status,message) { const error=new Error(message);error.status=status;throw error; }
function ready() {return Boolean(process.env.GOOGLE_CLASSROOM_CLIENT_ID && process.env.GOOGLE_CLASSROOM_CLIENT_SECRET && process.env.BLOB_READ_WRITE_TOKEN);}
function client() {
    if(!ready()) fail(503,'Google sign-in is awaiting setup by the site owner.');
    return new OAuth2Client(process.env.GOOGLE_CLASSROOM_CLIENT_ID,process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,REDIRECT);
}
function key() {
    const secret=process.env.QUIZ_STORAGE_SECRET || process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if(!secret) fail(503,'Quiz account storage is not configured.');
    return crypto.createHash('sha256').update('penina-google-v1:'+secret).digest();
}
function seal(value) {
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
    cipher.setAAD(Buffer.from(PREFIX));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
function unseal(raw) {
    const data=Buffer.from(raw || '','base64url');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    decipher.setAAD(Buffer.from(PREFIX));decipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
}
function cookie(req,name) {
    const value=(req.headers?.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
    return value ? value.slice(name.length+1) : '';
}
function sharedActivity(req) {
    const value=Number(cookie(req,'penina_activity'))||0;
    return value>0 && value<=Date.now()+60_000 ? value : 0;
}
function setSharedActivityCookie(value) {return `penina_activity=${value}; Domain=penina-hebrew.org; Path=/; Secure; SameSite=Lax; Max-Age=3600`;}
function setCookie(name,value,maxAge) {return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
function session(req) {
    try {const s=unseal(cookie(req,SESSION)),lastActivity=Math.max(Number(s.idleAt)||0,sharedActivity(req));if(s.kind==='session' && s.exp>Date.now() && (!lastActivity || Date.now()-lastActivity<=IDLE_MILLISECONDS) && s.sub && s.email)return {...s,idleAt:lastActivity || Date.now()};}catch(_){}
    fail(401,'Sign in to Penina to continue.');
}
function pendingPassword(req) {
    try {const value=unseal(cookie(req,SESSION));if(value.kind==='password-change' && value.exp>Date.now() && value.role==='teacher' && value.userId && value.email && value.credentialVersion)return value;}catch(_){}
    return null;
}
function issueTeacherLogin(res,identity) {
    const seconds=identity.mustChangePassword?600:30*24*3600;
    const login={...identity,kind:identity.mustChangePassword?'password-change':'session',idleAt:Date.now(),exp:Date.now()+seconds*1000};
    delete login.mustChangePassword;
    res.setHeader('Set-Cookie',[setCookie(SESSION,seal(login),seconds),setSharedActivityCookie(login.idleAt)]);
    return {ok:true,passwordChangeRequired:!!identity.mustChangePassword};
}
function touchSession(req,res) {
    try {
        const s=unseal(cookie(req,SESSION));
        if(s.kind!=='session'||s.exp<=Date.now()||!s.sub||!s.email)return false;
        const lastActivity=Math.max(Number(s.idleAt)||0,sharedActivity(req));
        if(lastActivity && Date.now()-lastActivity>IDLE_MILLISECONDS){res.setHeader('Set-Cookie',setCookie(SESSION,'',0));return false;}
        s.idleAt=Date.now();res.setHeader('Set-Cookie',setCookie(SESSION,seal(s),Math.max(0,Math.floor((s.exp-Date.now())/1000))));return true;
    } catch (_) { return false; }
}
function safeId(id) {return typeof id==='string' && /^[a-f0-9]{32}$/.test(id);}
async function read(path) {
    const found=await list({prefix:PREFIX+path,limit:10});
    const blob=found.blobs.find(b=>b.pathname===PREFIX+path);
    if(!blob)return null;
    const response=await fetch(blob.url,{cache:'no-store'});
    if(!response.ok)fail(503,'The class connection could not be read. Try again.');
    return unseal(await response.text());
}
async function write(path,value) {await put(PREFIX+path,seal(value),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:true});}
async function google(owner,path,query={},options={},student=false) {
    const connection=await read((student?'students/':'teachers/')+owner+'.txt');
    if(student && (!connection || connection.scope!==STUDENT_SCOPE))fail(403,'Sign in to Penina again and allow Classroom turn-in access, or open Classroom and mark this assignment as done.');
    if(!connection?.refreshToken && !(student && connection.accessToken && connection.expiryDate>Date.now()))fail(503,student?'Classroom sign-in expired. Open Classroom and mark this assignment as done.':'Your teacher needs to reconnect Google Classroom.');
    const auth=client();auth.setCredentials(connection.refreshToken?{refresh_token:connection.refreshToken}:{access_token:connection.accessToken,expiry_date:connection.expiryDate});
    try {
        const result=await auth.request({url:'https://classroom.googleapis.com/v1/'+path,params:query,paramsSerializer:params=>{
            const search=new URLSearchParams();
            for(const [name,value] of Object.entries(params))for(const item of (Array.isArray(value)?value:[value]))search.append(name,String(item));
            return search.toString();
        },...options,retry:false});
        return result.data;
    } catch(error) {
        const status=error.response?.status;
        const message=status===404?'This Google account or Classroom item is not available in the assigned class.':
            status===403 || status===401?'The class connection needs teacher or school administrator approval. Reconnect Google Classroom.':
            'Google Classroom could not complete the request. Please try again.';
        const translated=new Error(message);translated.status=status===404?403:503;
        translated.googleRejected=[400,401,403,404,429].includes(status);
        throw translated;
    }
}
// Called only after the quiz answers have been stored successfully.
async function turnInSubmission(req,record,quizId=DEFAULT_QUIZ) {
    sameOrigin(req);
    const user=session(req);
    if(user.role!=='student' || user.sub!==record.sub || !safeId(record.classId))fail(403,'Only the submitting student can turn in this work.');
    const assignment=await read('classes/'+record.classId+'.txt');
    if(!assignment || assignment.quiz!==quizId || !assignment.courseWorkId)fail(409,'This quiz has no linked Classroom assignment.');
    const workPath='courses/'+encodeURIComponent(assignment.courseId)+'/courseWork/'+encodeURIComponent(assignment.courseWorkId);
    const page=await google(user.sub,workPath+'/studentSubmissions',{userId:'me'}, {},true);
    const submission=(page.studentSubmissions || []).find(item=>item.userId===user.sub && item.courseId===assignment.courseId && item.courseWorkId===assignment.courseWorkId && item.associatedWithDeveloper);
    if(!submission)fail(403,'Your Classroom submission could not be verified.');
    // Never resubmit work already returned by the teacher, including on retries.
    if(submission.state==='TURNED_IN' || submission.state==='RETURNED')return {turnedIn:true,state:submission.state};
    await google(user.sub,workPath+'/studentSubmissions/'+encodeURIComponent(submission.id)+':turnIn',{}, {method:'POST',data:{}},true);
    return {turnedIn:true,state:'TURNED_IN'};
}
// Assignment destinations come exclusively from authenticated server records.
async function syncPotentialPoints(req,quizId) {
    sameOrigin(req);
    const user=session(req),quiz=await quizInfo(quizId);
    if(user.role!=='teacher' || quiz.owner!==user.sub)fail(403,'Only the quiz author can update Classroom points.');
    const result={maxPoints:quiz.maxPoints,updated:0,unchanged:0,failures:[]};
    if(!Number.isInteger(quiz.maxPoints))return {...result,warning:'Saved in Penina. Google Classroom requires a whole-number regular total. Adjust the regular points to a whole number and save again to sync Classroom.'};
    let cursor;
    do {
        const page=await list({prefix:PREFIX+'classes/',cursor,limit:1000});
        for(const blob of page.blobs) {
            const response=await fetch(blob.url,{cache:'no-store'});
            if(!response.ok)fail(503,'Linked assignments could not all be checked. Save again to retry Classroom syncing.');
            const assignment=unseal(await response.text());
            if(assignment.owner!==user.sub || assignment.quiz!==quizId || !assignment.courseWorkId)continue;
            try {
                const coursePath='courses/'+encodeURIComponent(assignment.courseId);
                const teacher=await google(user.sub,coursePath+'/teachers/'+encodeURIComponent(user.sub));
                if(teacher.userId!==user.sub)fail(403,'Your teacher membership could not be verified.');
                const course=await google(user.sub,coursePath);
                if(course.courseState!=='ACTIVE')fail(409,'This Classroom class is not active.');
                const workPath=coursePath+'/courseWork/'+encodeURIComponent(assignment.courseWorkId);
                const work=await google(user.sub,workPath);
                if(!work.associatedWithDeveloper || !['DRAFT','PUBLISHED'].includes(work.state))fail(409,'The linked assignment is unavailable or cannot be updated by Penina.');
                const latest=await quizInfo(quizId);
                if(latest.maxPoints!==quiz.maxPoints)fail(409,'Quiz points changed during syncing. Save the latest points again to retry.');
                if(work.maxPoints===quiz.maxPoints){result.unchanged++;continue;}
                const updated=await google(user.sub,workPath,{updateMask:'maxPoints'},{method:'PATCH',data:{maxPoints:quiz.maxPoints}});
                if(updated.maxPoints!==quiz.maxPoints)fail(503,'Classroom did not confirm the new points. Save again to retry.');
                result.updated++;
            }catch(error){result.failures.push({className:assignment.className || 'Classroom class',message:error.message});}
        }
        cursor=page.hasMore?page.cursor:undefined;
    }while(cursor);
    return result;
}
// Only server-stored class and Google subject IDs determine a grade's destination.
async function sendGrade(req,record,grading,quizId = DEFAULT_QUIZ) {
    const quiz=await quizInfo(quizId);
    sameOrigin(req);
    const user=session(req);
    if(user.role!=='teacher')fail(403,'Connect your Google teacher account before sending grades.');
    if(!safeId(record.classId) || !record.sub || record.isClassTeacher)fail(400,'This record has no student Classroom assignment.');
    if(grading.pending || !Number.isFinite(grading.total))fail(400,'Correct all written questions before sending a grade.');
    const assignment=await read('classes/'+record.classId+'.txt');
    if(!assignment || assignment.quiz!==quiz.id || assignment.owner!==user.sub)fail(403,'Connect the Google account that assigned this quiz.');
    if(!assignment.courseWorkId)fail(409,'Create the Classroom assignment from Penina teacher tools first.');
    const coursePath='courses/'+encodeURIComponent(assignment.courseId);
    const teacher=await google(user.sub,coursePath+'/teachers/'+encodeURIComponent(user.sub));
    if(teacher.userId!==user.sub)fail(403,'Your teacher membership could not be verified.');
    const course=await google(user.sub,coursePath);
    if(course.courseState!=='ACTIVE')fail(403,'This Classroom class is not active.');
    const workPath=coursePath+'/courseWork/'+encodeURIComponent(assignment.courseWorkId);
    const work=await google(user.sub,workPath);
    if(!work.associatedWithDeveloper || work.state!=='PUBLISHED' || work.maxPoints!==quiz.maxPoints)fail(409,`Publish the Penina assignment in Classroom and keep its maximum at ${quiz.maxPoints} points before sending grades.`);
    const student=await google(user.sub,coursePath+'/students/'+encodeURIComponent(record.sub));
    if(student.userId!==record.sub)fail(403,'The student is no longer enrolled in this class.');
    const data=await google(user.sub,workPath+'/studentSubmissions',{userId:record.sub,pageSize:100});
    const submission=(data.studentSubmissions || []).find(item=>item.userId===record.sub && item.courseId===assignment.courseId && item.courseWorkId===assignment.courseWorkId);
    if(!submission || !submission.associatedWithDeveloper)fail(409,'The student submission is not available for this Penina assignment yet.');
    const submissionPath=workPath+'/studentSubmissions/'+encodeURIComponent(submission.id);
    await google(user.sub,submissionPath,{updateMask:'draftGrade'},{method:'PATCH',data:{draftGrade:grading.total}});
    return {score:grading.total,maxPoints:quiz.maxPoints,draft:true,
        sentAt:new Date().toISOString(),courseWorkId:assignment.courseWorkId};
}
async function requireStudent(req,classId,quizId = DEFAULT_QUIZ) {
    const quiz=await quizInfo(quizId);
    if(req.method==='POST')sameOrigin(req);
    const identity=session(req);
    if(!safeId(classId))fail(403,'Open the quiz link your teacher posted for your class.');
    const assignment=await read('classes/'+classId+'.txt');
    if(!assignment || assignment.quiz!==quiz.id)fail(403,'This quiz has not been assigned to this class.');
    const course=await google(assignment.owner,'courses/'+encodeURIComponent(assignment.courseId));
    if(course.courseState!=='ACTIVE')fail(403,'This Classroom class is not active.');
    const owner=await google(assignment.owner,`courses/${encodeURIComponent(assignment.courseId)}/teachers/${encodeURIComponent(assignment.owner)}`);
    if(owner.userId!==assignment.owner)fail(403,'The assigned teacher could not be verified.');
    let isClassTeacher=identity.sub===owner.userId;
    if(!isClassTeacher) {
        try {
            const teacher=await google(assignment.owner,`courses/${encodeURIComponent(assignment.courseId)}/teachers/${encodeURIComponent(identity.sub)}`);
            isClassTeacher=teacher.userId===identity.sub;
        } catch(error) {if(error.status!==403)throw error;}
    }
    if(!isClassTeacher) {
        const student=await google(assignment.owner,`courses/${encodeURIComponent(assignment.courseId)}/students/${encodeURIComponent(identity.sub)}`);
        if(student.userId!==identity.sub)fail(403,'This Google account is not enrolled in the class assigned this quiz.');
    }
    return {...identity,isClassTeacher,classId,courseId:assignment.courseId,className:assignment.className};
}
function sameOrigin(req) {if(req.headers?.origin!==ORIGIN)fail(403,'Open this page on Penina to continue.');}
async function handle(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    const action=req.query?.action || req.body?.action;
    try {
        const quiz=await quizInfo(req.query?.quiz || req.body?.quiz || DEFAULT_QUIZ);
        if(req.method==='GET' && action==='config')return res.status(200).json({configured:ready()});
        if(req.method==='GET' && action==='callback') {
            let state;
            try {state=unseal(cookie(req,STATE));}catch(_){fail(400,'The sign-in request expired. Start again from Penina.');}
            res.setHeader('Set-Cookie',setCookie(STATE,'',0));
            if(state.kind!=='oauth' || state.exp<Date.now() || state.state!==req.query.state || typeof req.query.code!=='string')
                fail(400,'Google sign-in was cancelled or expired. Start again from Penina.');
            const auth=client();
            const {tokens}=await auth.getToken({code:req.query.code,codeVerifier:state.verifier});
            const ticket=await auth.verifyIdToken({idToken:tokens.id_token,audience:process.env.GOOGLE_CLASSROOM_CLIENT_ID});
            const identity=ticket.getPayload();
            if(identity.nonce!==state.nonce || !identity.email_verified || !identity.sub || !identity.email)fail(401,'Google could not verify this account.');
            let teacherIdentity;
            if(state.portal) {
                if(state.role!=='teacher')fail(403,'Use a registered teacher account.');
                teacherIdentity=await require('./quiz-teachers').registered(identity.email);
                if(!teacherIdentity)fail(403,'This Google account is not registered as a Penina teacher. Sign in with your registered school account.');
            }
            if(state.role==='teacher' && !state.portal && identity.email.toLowerCase()===TEACHER_EMAIL)fail(403,'Sign in with Google from Penina Home.');
            if(state.role==='teacher') {
                const granted=(tokens.scope || '').split(' ');
                if(!TEACHER_SCOPES.every(scope=>granted.includes(scope)))fail(403,'Allow the requested Classroom permissions, then reconnect.');
                const previous=await read('teachers/'+identity.sub+'.txt');
                const refreshToken=tokens.refresh_token || previous?.refreshToken;
                if(!refreshToken) {
                    if(state.consentRetry)fail(403,'Google Classroom access was not granted. Sign in again and allow the requested permissions.');
                    state.consentRetry=true;
                    state.state=crypto.randomBytes(24).toString('hex');
                    state.nonce=crypto.randomBytes(24).toString('hex');
                    state.exp=Date.now()+10*60*1000;
                    res.setHeader('Set-Cookie',setCookie(STATE,seal(state),600));
                    res.setHeader('Location',auth.generateAuthUrl({scope:[...SCOPES,...TEACHER_SCOPES],state:state.state,nonce:state.nonce,prompt:'consent',login_hint:identity.email,access_type:'offline',code_challenge:crypto.createHash('sha256').update(state.verifier).digest('base64url'),code_challenge_method:'S256'}));
                    return res.status(303).end();
                }
                await write('teachers/'+identity.sub+'.txt',{refreshToken,email:identity.email,connectedAt:new Date().toISOString()});
            }
            if(state.role==='student' && (tokens.scope || '').split(' ').includes(STUDENT_SCOPE)) {
                const previous=await read('students/'+identity.sub+'.txt');
                const refreshToken=tokens.refresh_token || (previous?.scope===STUDENT_SCOPE?previous.refreshToken:undefined);
                await write('students/'+identity.sub+'.txt',{scope:STUDENT_SCOPE,refreshToken,accessToken:refreshToken?undefined:tokens.access_token,expiryDate:tokens.expiry_date,connectedAt:new Date().toISOString()});
            }
            const sessionSeconds=state.role==='teacher'?30*24*3600:24*3600;
            const login={kind:'session',sub:identity.sub,email:identity.email,name:identity.name || identity.email,role:state.role,authMethod:'google',idleAt:Date.now(),exp:Date.now()+sessionSeconds*1000,...(state.portal?{userId:teacherIdentity.userId}:{})};
            res.setHeader('Set-Cookie',[setCookie(STATE,'',0),setCookie(SESSION,seal(login),sessionSeconds),setSharedActivityCookie(login.idleAt)]);
            if(state.portal){res.setHeader('Location','/');return res.status(303).end();}
            const destination=(await quizInfo(state.quiz)).path;
            if(state.builder && state.role==='teacher'){res.setHeader('Location','/Penina-Quizzes/builder/');return res.status(303).end();}
            res.setHeader('Location',state.role==='teacher'?(state.quiz.startsWith('custom-')?'/Penina-Quizzes/custom/teacher.html?quiz='+state.quiz:destination+'teacher.html'):destination+(destination.includes('?')?'&':'?')+'class='+state.classId);
            return res.status(303).end();
        }
        if(req.method==='POST')sameOrigin(req);
        if(req.method==='POST' && action==='email-login') {
            return res.status(200).json(await require('./quiz-email-login').request(req,{seal}));
        }
        if(req.method==='POST' && action==='email-verify') {
            const identity=await require('./quiz-email-login').verify(req,{unseal});
            return res.status(200).json(issueTeacherLogin(res,identity));
        }
        if(req.method==='POST' && action==='password-login') {
            const identity=await require('./quiz-teachers').passwordLogin(req.body.email,req.body.password);
            return res.status(200).json(issueTeacherLogin(res,identity));
        }
        if(req.method==='POST' && action==='password-change') {
            const login=pendingPassword(req);
            if(!login)fail(401,'Sign in again to change your temporary password.');
            await require('./quiz-teachers').changeInitialPassword(login,req.body.password);
            delete login.credentialVersion;
            return res.status(200).json(issueTeacherLogin(res,login));
        }
        if(req.method==='POST' && action==='login') {
            const role=req.body.role==='teacher'?'teacher':'student';
            if(role==='teacher') {
                if(req.body.portal!==true) {
                    const denied=authenticatePage(await getPage('sixth'),req.body.password);
                    if(denied)return res.status(denied.status).json({error:denied.error});
                }
            } else if(!safeId(req.body.classId))fail(403,'Open the quiz link your teacher posted for your class.');
            const auth=client(),state={kind:'oauth',portal:role==='teacher' && req.body.portal===true,builder:req.body.builder===true,quiz:quiz.id,state:crypto.randomBytes(24).toString('hex'),nonce:crypto.randomBytes(24).toString('hex'),verifier:crypto.randomBytes(32).toString('base64url'),role,classId:req.body.classId,exp:Date.now()+10*60*1000};
            const options={scope:role==='teacher'?[...SCOPES,...TEACHER_SCOPES]:[...SCOPES,STUDENT_SCOPE],state:state.state,nonce:state.nonce,prompt:role==='teacher' && req.body.reconnect===true?'select_account consent':'select_account',code_challenge:crypto.createHash('sha256').update(state.verifier).digest('base64url'),code_challenge_method:'S256'};
            options.access_type='offline';
            res.setHeader('Set-Cookie',setCookie(STATE,seal(state),600));
            return res.status(200).json({url:auth.generateAuthUrl(options)});
        }
        if(req.method==='POST' && action==='logout') {res.setHeader('Set-Cookie',setCookie(SESSION,'',0));return res.status(200).json({ok:true});}
        if(req.method==='POST' && action==='activity') {session(req);return res.status(204).end();}
        if(req.method==='GET' && action==='student') {
            const user=await requireStudent(req,req.query.classId,quiz.id);
            return res.status(200).json({sub:user.sub,name:user.name,email:user.email,className:user.className,isClassTeacher:user.isClassTeacher,questions:await quizQuestions(quiz.id),title:quiz.title,durationMinutes:quiz.durationMinutes,forwardOnlyFrom:quiz.forwardOnlyFrom ?? null,checkpointMessage:quiz.checkpointMessage});
        }
        if(req.method==='GET' && action==='image') {
            if(quiz.id!==DEFAULT_QUIZ)fail(404,'This quiz has no image.');
            await requireStudent(req,req.query.classId,quiz.id);
            res.setHeader('Content-Type','image/png');
            return res.status(200).end(require('fs').readFileSync(require('path').join(__dirname,'../Penina-Quizzes/gemara-6-wl-2/talmud-page.png')));
        }
        if(req.method==='GET' && action==='teacher' && pendingPassword(req))return res.status(200).json({passwordChangeRequired:true});
        const user=session(req);
        if(user.role!=='teacher')fail(403,'Connect a teacher account to choose a class.');
        if(req.method==='GET' && action==='teacher') {
            if(!user.userId)fail(401,'Sign in to Teacher tools to continue.');
            const teacher=await require('./quiz-teachers').registered(user.email);
            if(!teacher || teacher.userId!==user.userId)fail(403,'This teacher account is not active.');
            return res.status(200).json({email:user.email,name:teacher.name || user.name,userId:user.userId,apps:require('./teacher-apps').appsFor(teacher)});
        }
        if(req.method==='POST' && action==='archive-assignment') {
            if(!user.userId)fail(403,'Sign in to Teacher tools to continue.');
            const id=req.body.classId;
            if(!safeId(id) || typeof req.body.archived!=='boolean')fail(400,'Choose a quiz to archive or restore.');
            const item=await read('classes/'+id+'.txt');
            if(!item || item.owner!==user.sub || !item.courseWorkId)fail(403,'Only the assigned teacher can archive this quiz.');
            const marker='assignment-archives/'+encodeURIComponent(user.sub)+'/'+id+'.txt';
            if(req.body.archived)await write(marker,{archivedAt:new Date().toISOString()});
            else await del(PREFIX+marker);
            return res.status(200).json({ok:true});
        }
        if(req.method==='GET' && action==='assignments') {
            if(!user.userId)fail(403,'Sign in to Teacher tools to continue.');
            const archived=req.query.archived==='true',archiveIds=new Set();let archiveCursor;
            do {
                const page=await list({prefix:PREFIX+'assignment-archives/'+encodeURIComponent(user.sub)+'/',cursor:archiveCursor,limit:1000});
                for(const blob of page.blobs)archiveIds.add(blob.pathname.split('/').pop().replace('.txt',''));
                archiveCursor=page.hasMore?page.cursor:undefined;
            }while(archiveCursor);
            const assignments=[];let cursor;
            do {
                const page=await list({prefix:PREFIX+'classes/',cursor,limit:1000});
                for(const blob of page.blobs) {
                    const classId=blob.pathname.split('/').pop().replace('.txt','');
                    if(archiveIds.has(classId)!==archived)continue;
                    const response=await fetch(blob.url,{cache:'no-store'});
                    if(!response.ok)fail(503,'Assignments could not be loaded. Try again.');
                    const item=unseal(await response.text());
                    if(item.owner!==user.sub || !item.courseWorkId)continue;
                    const info=await quizInfo(item.quiz);
                    // Saved reports remain usable when one Classroom item is unavailable.
                    let work={state:'UNKNOWN'};
                    try {work=await google(user.sub,'courses/'+encodeURIComponent(item.courseId)+'/courseWork/'+encodeURIComponent(item.courseWorkId));}
                    catch(_) { /* The list labels the unverified Classroom status explicitly. */ }
                    if(work.state==='DELETED')continue;
                    const createdAt=work.creationTime || item.createdAt || blob.uploadedAt || null;
                    // Classroom exposes no original publication time. Capture its timestamp
                    // once for externally posted/legacy work so later edits never reorder it.
                    const postedAt=work.state==='DRAFT'?null:item.postedAt || (work.state==='PUBLISHED'?(work.scheduledTime || work.updateTime || createdAt):null);
                    if(postedAt && !item.postedAt)await write('classes/'+blob.pathname.split('/').pop(),{...item,postedAt});
                    assignments.push({classId:blob.pathname.split('/').pop().replace('.txt',''),quiz:item.quiz,state:work.state,createdAt,postedAt,title:info.title,courseId:item.courseId,className:item.className});
                }
                cursor=page.hasMore?page.cursor:undefined;
            }while(cursor);
            const assignmentGroup=a=>a.state==='DRAFT'?1:a.state==='PUBLISHED' || a.postedAt?0:2;
            return res.status(200).json({assignments:assignments.sort((a,b)=>assignmentGroup(a)-assignmentGroup(b)||(Date.parse(b.postedAt || b.createdAt)||0)-(Date.parse(a.postedAt || a.createdAt)||0)||a.className.localeCompare(b.className)||a.title.localeCompare(b.title))});
        }
        if(req.method==='POST' && action==='publish-assignment') {
            if(quiz.owner && quiz.owner!==user.sub)fail(403,'Only the quiz author can publish this assignment.');
            const id=req.body.courseId;
            if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))fail(400,'Choose a class.');
            const classId=crypto.createHmac('sha256',key()).update(user.sub+':'+id+':'+quiz.id).digest('hex').slice(0,32);
            const assignment=await read('classes/'+classId+'.txt');
            if(!assignment?.courseWorkId || assignment.owner!==user.sub || assignment.quiz!==quiz.id)fail(403,'Create this class assignment first.');
            const coursePath='courses/'+encodeURIComponent(id);
            const teacher=await google(user.sub,coursePath+'/teachers/'+encodeURIComponent(user.sub));
            if(teacher.userId!==user.sub)fail(403,'You must teach this class.');
            const course=await google(user.sub,coursePath);
            if(course.courseState!=='ACTIVE')fail(403,'Choose an active class.');
            const workPath=coursePath+'/courseWork/'+encodeURIComponent(assignment.courseWorkId);
            const work=await google(user.sub,workPath);
            if(!work.associatedWithDeveloper || work.maxPoints!==quiz.maxPoints || !['DRAFT','PUBLISHED'].includes(work.state))fail(409,'Check this assignment in Classroom before publishing.');
            if(work.state==='DRAFT') {
                const posted=await google(user.sub,workPath,{updateMask:'state'},{method:'PATCH',data:{state:'PUBLISHED'}});
                await write('classes/'+classId+'.txt',{...assignment,postedAt:posted.updateTime || new Date().toISOString()});
            } else if(!assignment.postedAt) {
                await write('classes/'+classId+'.txt',{...assignment,postedAt:work.scheduledTime || work.updateTime || work.creationTime || assignment.createdAt || new Date().toISOString()});
            }
            return res.status(200).json({state:'PUBLISHED',className:course.name});
        }
        if(req.method==='GET' && action==='courses') {
            const courses=[];let pageToken;
            do {
                const data=await google(user.sub,'courses',{teacherId:'me',courseStates:'ACTIVE',pageSize:100,...(pageToken?{pageToken}:{})});
                courses.push(...(data.courses || []).map(c=>({id:c.id,name:c.name,section:c.section || ''})));pageToken=data.nextPageToken;
            }while(pageToken);
            return res.status(200).json({email:user.email,courses});
        }
        if(req.method==='POST' && action==='assign') {
            if(quiz.owner && quiz.owner!==user.sub)fail(403,'Only the quiz author can assign this quiz.');
            const id=req.body.courseId;
            if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))fail(400,'Choose a class.');
            await google(user.sub,`courses/${encodeURIComponent(id)}/teachers/${encodeURIComponent(user.sub)}`);
            const course=await google(user.sub,'courses/'+encodeURIComponent(id));
            if(course.courseState!=='ACTIVE')fail(403,'Choose an active class.');
            const classId=crypto.createHmac('sha256',key()).update(user.sub+':'+id+':'+quiz.id).digest('hex').slice(0,32);
            const classPath='classes/'+classId+'.txt';
            const existing=await read(classPath);
            const url=ORIGIN+quiz.path+(quiz.path.includes('?')?'&':'?')+'class='+classId;
            let work;
            if(existing?.courseWorkId) {
                work=await google(user.sub,`courses/${encodeURIComponent(id)}/courseWork/${encodeURIComponent(existing.courseWorkId)}`);
                if(work.state==='DELETED')fail(409,'The linked Classroom assignment was deleted. Restore it before using this quiz link.');
            } else {
                // Recover an assignment if Google succeeded but the response/storage write was lost.
                let pageToken;
                do {
                    const page=await google(user.sub,`courses/${encodeURIComponent(id)}/courseWork`,{pageSize:100,courseWorkStates:['DRAFT','PUBLISHED'],...(pageToken?{pageToken}:{})});
                    work=(page.courseWork || []).find(w=>w.associatedWithDeveloper && w.materials?.some(m=>m.link?.url===url));
                    pageToken=page.nextPageToken;
                }while(!work && pageToken);
                if(!work) {
                    // Atomic claim prevents concurrent clicks from publishing duplicate assignments.
                    try {await put(PREFIX+'assignment-claims/'+classId+'.txt',seal({createdAt:new Date().toISOString()}),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
                    catch(_) {fail(409,'Assignment creation is already in progress or needs recovery. Check Classroom drafts, then try again.');}
                    try {work=await google(user.sub,`courses/${encodeURIComponent(id)}/courseWork`,{}, {method:'POST',data:{
                        title:quiz.title,description:'Complete the quiz on Penina, then mark this assignment as done in Classroom. Your teacher will review written answers and return your grade. '+quiz.description,
                        workType:'ASSIGNMENT',state:'DRAFT',maxPoints:quiz.maxPoints,materials:[{link:{url,title:'Open the Penina quiz'}}]
                    }});} catch(error) {
                        // Explicit rejections cannot have created coursework; allow a corrected request to retry.
                        // An ambiguous network failure keeps the claim, and the list above recovers any created draft.
                        if(error.googleRejected)await del(PREFIX+'assignment-claims/'+classId+'.txt');
                        throw error;
                    }
                }
            }
            if(!work?.id || !work.associatedWithDeveloper)fail(503,'The Classroom assignment could not be verified.');
            await write(classPath,{...(existing || {}),quiz:quiz.id,owner:user.sub,courseId:id,className:course.name,courseWorkId:work.id,createdAt:work.creationTime || existing?.createdAt || new Date().toISOString()});
            return res.status(200).json({url,classroomURL:work.alternateLink || 'https://classroom.google.com/',className:course.name,state:work.state});
        }
        return res.status(400).json({error:'Choose an available quiz account action.'});
    }catch(error){return res.status(error.status || 503).json({error:error.status?error.message:'Sign-in could not be completed. Please try again.'});}
}
async function classRoster(req,courseId,quizId) {
    sameOrigin(req);
    const user=session(req),quiz=await quizInfo(quizId);
    if(user.role!=='teacher' || quiz.owner!==user.sub)fail(403,'Only the quiz author can view its roster.');
    if(typeof courseId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(courseId))fail(400,'Choose a class to view its roster.');
    const coursePath='courses/'+encodeURIComponent(courseId);
    const teacher=await google(user.sub,coursePath+'/teachers/'+encodeURIComponent(user.sub));
    if(teacher.userId!==user.sub)fail(403,'Your teacher membership could not be verified.');
    const course=await google(user.sub,coursePath);
    if(course.courseState!=='ACTIVE')fail(403,'Choose an active class.');
    const classId=crypto.createHmac('sha256',key()).update(user.sub+':'+courseId+':'+quiz.id).digest('hex').slice(0,32);
    const assignment=await read('classes/'+classId+'.txt');
    const students=[];let pageToken;
    do {
        const page=await google(user.sub,coursePath+'/students',{pageSize:100,...(pageToken?{pageToken}:{})});
        for(const student of page.students || [])students.push({id:student.userId,name:student.profile?.name?.fullName || 'Student '+student.userId});
        pageToken=page.nextPageToken;
    }while(pageToken);
    return {classId,className:course.name,assigned:Boolean(assignment?.courseWorkId),students:students.sort((a,b)=>a.name.localeCompare(b.name))};
}
module.exports={turnInSubmission,syncPotentialPoints,isAccountOwner,verifyTeacher,handle,requireStudent,sendGrade,session,touchSession,seal,unseal,classRoster};

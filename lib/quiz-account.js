'use strict';
const crypto = require('crypto');
const {OAuth2Client} = require('google-auth-library');
const {list, put, del} = require('@vercel/blob');
const {getPage, authenticatePage} = require('./vocabulary-pages');
const ORIGIN = 'https://www.penina-hebrew.org';
const API = '/api/game-scores?game=quiz-account';
const REDIRECT = ORIGIN + API + '&action=callback';
const QUIZ = '/Penina-Quizzes/gemara-6-wl-2/';
const SESSION = '__Host-penina-quiz-session', STATE = '__Host-penina-quiz-state';
const PREFIX = 'quiz-google/';
const SCOPES = ['openid','email','profile'];
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
function setCookie(name,value,maxAge) {return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
function session(req) {
    try {const s=unseal(cookie(req,SESSION));if(s.kind==='session' && s.exp>Date.now() && s.sub && s.email)return s;}catch(_){}
    fail(401,'Sign in with your Google account to continue.');
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
async function google(owner,path,query={},options={}) {
    const connection=await read('teachers/'+owner+'.txt');
    if(!connection?.refreshToken)fail(503,'Your teacher needs to reconnect Google Classroom.');
    const auth=client();auth.setCredentials({refresh_token:connection.refreshToken});
    try {
        const result=await auth.request({url:'https://classroom.googleapis.com/v1/'+path,params:query,...options,retry:false});
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
// Only server-stored class and Google subject IDs determine a grade's destination.
async function sendGrade(req,record,grading) {
    sameOrigin(req);
    const user=session(req);
    if(user.role!=='teacher')fail(403,'Connect your Google teacher account before sending grades.');
    if(!safeId(record.classId) || !record.sub || record.isClassTeacher)fail(400,'This record has no student Classroom assignment.');
    if(grading.pending || !Number.isFinite(grading.total))fail(400,'Correct all four written and extra-credit questions before sending a grade.');
    const assignment=await read('classes/'+record.classId+'.txt');
    if(!assignment || assignment.quiz!=='gemara-6-wl-2' || assignment.owner!==user.sub)fail(403,'Connect the Google account that assigned this quiz.');
    if(!assignment.courseWorkId)fail(409,'Create the Classroom assignment from Penina teacher tools first.');
    const coursePath='courses/'+encodeURIComponent(assignment.courseId);
    const teacher=await google(user.sub,coursePath+'/teachers/'+encodeURIComponent(user.sub));
    if(teacher.userId!==user.sub)fail(403,'Your teacher membership could not be verified.');
    const course=await google(user.sub,coursePath);
    if(course.courseState!=='ACTIVE')fail(403,'This Classroom class is not active.');
    const workPath=coursePath+'/courseWork/'+encodeURIComponent(assignment.courseWorkId);
    const work=await google(user.sub,workPath);
    if(!work.associatedWithDeveloper || work.state!=='PUBLISHED' || work.maxPoints!==12)fail(409,'Publish the Penina assignment in Classroom and keep its maximum at 12 points before sending grades.');
    const student=await google(user.sub,coursePath+'/students/'+encodeURIComponent(record.sub));
    if(student.userId!==record.sub)fail(403,'The student is no longer enrolled in this class.');
    const data=await google(user.sub,workPath+'/studentSubmissions',{userId:record.sub,pageSize:100});
    const submission=(data.studentSubmissions || []).find(item=>item.userId===record.sub && item.courseId===assignment.courseId && item.courseWorkId===assignment.courseWorkId);
    if(!submission || !submission.associatedWithDeveloper)fail(409,'The student submission is not available for this Penina assignment yet.');
    const submissionPath=workPath+'/studentSubmissions/'+encodeURIComponent(submission.id);
    await google(user.sub,submissionPath,{updateMask:'draftGrade,assignedGrade'},{method:'PATCH',data:{draftGrade:grading.total,assignedGrade:grading.total}});
    // Returning work is only permitted after the student has marked it turned in.
    let returned=submission.state==='RETURNED', returnPending=false;
    if(submission.state==='TURNED_IN') {
        try {await google(user.sub,submissionPath+':return',{}, {method:'POST',data:{}});returned=true;}
        catch(_) {returnPending=true;}
    }
    return {score:grading.total,maxPoints:12,returned,returnPending,needsTurnIn:!returned && !returnPending,
        sentAt:new Date().toISOString(),courseWorkId:assignment.courseWorkId};
}
async function requireStudent(req,classId) {
    if(req.method==='POST')sameOrigin(req);
    const identity=session(req);
    if(!safeId(classId))fail(403,'Open the quiz link your teacher posted for your class.');
    const assignment=await read('classes/'+classId+'.txt');
    if(!assignment || assignment.quiz!=='gemara-6-wl-2')fail(403,'This quiz has not been assigned to this class.');
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
            if(state.role==='teacher') {
                const granted=(tokens.scope || '').split(' ');
                if(!TEACHER_SCOPES.every(scope=>granted.includes(scope)))fail(403,'Allow the requested Classroom permissions, then reconnect.');
                const previous=await read('teachers/'+identity.sub+'.txt');
                const refreshToken=tokens.refresh_token || previous?.refreshToken;
                if(!refreshToken)fail(403,'Reconnect Google Classroom and allow access so enrollment can be checked.');
                await write('teachers/'+identity.sub+'.txt',{refreshToken,email:identity.email,connectedAt:new Date().toISOString()});
            }
            const login={kind:'session',sub:identity.sub,email:identity.email,name:identity.name || identity.email,role:state.role,exp:Date.now()+24*3600*1000};
            res.setHeader('Set-Cookie',[setCookie(STATE,'',0),setCookie(SESSION,seal(login),24*3600)]);
            res.setHeader('Location',state.role==='teacher'?QUIZ+'teacher.html':QUIZ+'?class='+state.classId);
            return res.status(303).end();
        }
        if(req.method==='POST')sameOrigin(req);
        if(req.method==='POST' && action==='login') {
            const role=req.body.role==='teacher'?'teacher':'student';
            if(role==='teacher') {
                const denied=authenticatePage(await getPage('sixth'),req.body.password);
                if(denied)return res.status(denied.status).json({error:denied.error});
            } else if(!safeId(req.body.classId))fail(403,'Open the quiz link your teacher posted for your class.');
            const auth=client(),state={kind:'oauth',state:crypto.randomBytes(24).toString('hex'),nonce:crypto.randomBytes(24).toString('hex'),verifier:crypto.randomBytes(32).toString('base64url'),role,classId:req.body.classId,exp:Date.now()+10*60*1000};
            const options={scope:role==='teacher'?[...SCOPES,...TEACHER_SCOPES]:SCOPES,state:state.state,nonce:state.nonce,prompt:role==='teacher'?'select_account consent':'select_account',code_challenge:crypto.createHash('sha256').update(state.verifier).digest('base64url'),code_challenge_method:'S256'};
            if(role==='teacher')options.access_type='offline';
            res.setHeader('Set-Cookie',setCookie(STATE,seal(state),600));
            return res.status(200).json({url:auth.generateAuthUrl(options)});
        }
        if(req.method==='POST' && action==='logout') {res.setHeader('Set-Cookie',setCookie(SESSION,'',0));return res.status(200).json({ok:true});}
        if(req.method==='GET' && action==='student') {
            const user=await requireStudent(req,req.query.classId);
            return res.status(200).json({sub:user.sub,name:user.name,email:user.email,className:user.className,isClassTeacher:user.isClassTeacher,questions:require('../Penina-Quizzes/gemara-6-wl-2/questions.json')});
        }
        if(req.method==='GET' && action==='image') {
            await requireStudent(req,req.query.classId);
            res.setHeader('Content-Type','image/png');
            return res.status(200).end(require('fs').readFileSync(require('path').join(__dirname,'../Penina-Quizzes/gemara-6-wl-2/talmud-page.png')));
        }
        const user=session(req);
        if(user.role!=='teacher')fail(403,'Connect a teacher account to choose a class.');
        if(req.method==='GET' && action==='courses') {
            const courses=[];let pageToken;
            do {
                const data=await google(user.sub,'courses',{teacherId:'me',courseStates:'ACTIVE',pageSize:100,...(pageToken?{pageToken}:{})});
                courses.push(...(data.courses || []).map(c=>({id:c.id,name:c.name,section:c.section || ''})));pageToken=data.nextPageToken;
            }while(pageToken);
            return res.status(200).json({email:user.email,courses});
        }
        if(req.method==='POST' && action==='assign') {
            const id=req.body.courseId;
            if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))fail(400,'Choose a class.');
            await google(user.sub,`courses/${encodeURIComponent(id)}/teachers/${encodeURIComponent(user.sub)}`);
            const course=await google(user.sub,'courses/'+encodeURIComponent(id));
            if(course.courseState!=='ACTIVE')fail(403,'Choose an active class.');
            const classId=crypto.createHmac('sha256',key()).update(user.sub+':'+id+':gemara-6-wl-2').digest('hex').slice(0,32);
            const classPath='classes/'+classId+'.txt';
            const existing=await read(classPath);
            const url=ORIGIN+QUIZ+'?class='+classId;
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
                        title:'Gemara 6 · Quiz WL #2',description:'Complete the quiz on Penina, then mark this assignment as done in Classroom. Your teacher will review written answers and return your grade. 12 regular points plus up to 4 extra-credit points.',
                        workType:'ASSIGNMENT',state:'DRAFT',maxPoints:12,materials:[{link:{url,title:'Open the Penina quiz'}}]
                    }});} catch(error) {
                        // Explicit rejections cannot have created coursework; allow a corrected request to retry.
                        // An ambiguous network failure keeps the claim, and the list above recovers any created draft.
                        if(error.googleRejected)await del(PREFIX+'assignment-claims/'+classId+'.txt');
                        throw error;
                    }
                }
            }
            if(!work?.id || !work.associatedWithDeveloper)fail(503,'The Classroom assignment could not be verified.');
            await write(classPath,{quiz:'gemara-6-wl-2',owner:user.sub,courseId:id,className:course.name,courseWorkId:work.id});
            return res.status(200).json({url,classroomURL:work.alternateLink || 'https://classroom.google.com/',className:course.name,state:work.state});
        }
        return res.status(400).json({error:'Choose an available quiz account action.'});
    }catch(error){return res.status(error.status || 503).json({error:error.status?error.message:'Google sign-in could not be completed. Please try again.'});}
}
module.exports={handle,requireStudent,sendGrade,session,seal,unseal};

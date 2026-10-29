const crypto = require('crypto');
const {list, put, get} = require('@vercel/blob');
const PREFIX = 'quiz-teacher-numbers/';
const account = () => require('./quiz-account');
function number(password) {
    const match = typeof password === 'string' && /^([1-9][0-9]{0,8})-\S+$/.exec(password);
    return match ? Number(match[1]) : null;
}
function checkCode(value, kind) {
    if (typeof value !== 'string' || value.length > 256) return false;
    const expected = kind === 'create' ? 'c880488da11a0e54fb695fa503d72468c3e89ca07464066d86c0ed245d7b4ab9' : '64ca08a590e617c7d21c044f505fbff4e8d4fea4a95ba8394becddcc6e60a1e5';
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(), Buffer.from(expected,'hex'));
}
function fail(status,message) {throw Object.assign(new Error(message),{status});}
async function records() {
    const result=[];let cursor;
    do {
        const page=await list({prefix:PREFIX,cursor,limit:1000});
        for(const blob of page.blobs) {
            // Authorization must read current storage, not a cached public Blob response.
            const response=await get(blob.url,{access:'public',useCache:false});
            if(!response || response.statusCode!==200)fail(503,'Teacher assignments could not be loaded.');
            const teacher=account().unseal(await new Response(response.stream).text());
            Object.defineProperty(teacher,'_etag',{value:response.blob.etag,writable:true});
            result.push(teacher);
        }
        cursor=page.hasMore?page.cursor:undefined;
    }while(cursor);
    return result;
}
async function updateTeacher(previous, next) {
    if(!previous._etag)fail(503,'Teacher details could not be verified. Please reload and try again.');
    try {
        const result=await put(PREFIX+previous.userId+'.txt',account().seal(next),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:true,cacheControlMaxAge:60,ifMatch:previous._etag});
        previous._etag=result.etag;
    } catch(error) {
        if(error.name==='BlobPreconditionFailedError')fail(409,'This user changed while you were editing. Refresh the user list and try again.');
        throw error;
    }
}
// Temporary credentials are stored only inside the encrypted teacher record for welcome retries.
function temporaryCredentials() {
    const temporaryPassword=crypto.randomBytes(18).toString('base64url');
    const salt=crypto.randomBytes(16).toString('hex');
    return {passwordEnabled:true,mustChangePassword:true,temporaryPassword,salt,hash:crypto.scryptSync(temporaryPassword,salt,64).toString('hex'),credentialVersion:crypto.randomUUID()};
}
async function passwordLogin(email,password) {
    email=typeof email==='string'?email.trim().toLowerCase():'';
    if(!email || email.length>254 || typeof password!=='string' || password.length>256)fail(401,'Email or password is incorrect.');
    // Atomically reserve at most ten attempts per address per fifteen-minute window.
    const prefix='quiz-password-attempts/'+crypto.createHash('sha256').update(email).digest('hex')+'/'+Math.floor(Date.now()/900000)+'/';
    let allowed=false;
    for(let i=0;i<10;i++) {
        try {await put(prefix+i+'.txt','attempt',{access:'public',addRandomSuffix:false,allowOverwrite:false});allowed=true;break;}
        catch(error){const existing=await list({prefix:prefix+i+'.txt',limit:10});if(!existing.blobs.some(b=>b.pathname===prefix+i+'.txt'))throw error;}
    }
    if(!allowed)fail(429,'Too many sign-in attempts. Try again in 15 minutes or use an email sign-in link.');
    const teacher=(await records()).find(t=>t.email===email && !t.deleted && !t.deletingPages && t.passwordEnabled);
    const candidate=crypto.scryptSync(password,teacher?.salt || 'penina-unregistered-account',64);
    if(!teacher || !crypto.timingSafeEqual(candidate,Buffer.from(teacher.hash,'hex')))fail(401,'Email or password is incorrect.');
    return require('./quiz-email-login').identity(teacher,account());
}
async function changeInitialPassword(login,password) {
    if(typeof password!=='string' || password.length<12 || password.length>128)fail(400,'Choose a password between 12 and 128 characters.');
    const teacher=(await records()).find(t=>t.userId===login.userId && t.email===login.email && !t.deleted && !t.deletingPages);
    if(!teacher || !teacher.mustChangePassword || teacher.credentialVersion!==login.credentialVersion)fail(401,'This password setup has expired. Sign in again.');
    if(crypto.timingSafeEqual(crypto.scryptSync(password,teacher.salt,64),Buffer.from(teacher.hash,'hex')))fail(400,'Choose a new password different from your temporary password.');
    const salt=crypto.randomBytes(16).toString('hex');
    const next={...teacher,salt,hash:crypto.scryptSync(password,salt,64).toString('hex'),mustChangePassword:false,credentialVersion:crypto.randomUUID()};
    delete next.temporaryPassword;
    await updateTeacher(teacher,next);
}
// Registry lookup; callers must verify account ownership before issuing a session.
async function registered(email) {
    if(typeof email!=='string')return null;
    email=email.trim().toLowerCase();
    if(email==='disrael@saracademy.org')return {userId:1,email,name:'David Israel'};
    const teacher=(await records()).find(t=>t.email===email && !t.deleted && !t.deletingPages);
    return teacher?{userId:teacher.userId,email:teacher.email,name:teacher.name,apps:require('./teacher-apps').appsFor(teacher),mustChangePassword:!!teacher.mustChangePassword,credentialVersion:teacher.credentialVersion,sessionVersion:teacher.sessionVersion}:null;
}
async function verify(email,password) {
    if(account().verifyTeacher(email,password))return {userId:1,email:'disrael@saracademy.org',name:'David Israel'};
    const id=number(password);
    if(!id || id===1 || typeof email!=='string' || password.length>256)return null;
    const teacher=(await records()).find(t=>t.userId===id && t.email===email.trim().toLowerCase() && !t.deleted && !t.deletingPages);
    if(!teacher)return null;
    return crypto.timingSafeEqual(crypto.scryptSync(password,teacher.salt,64),Buffer.from(teacher.hash,'hex'))?teacher:null;
}
async function manage(req) {
    if(!account().isAccountOwner(req))fail(403,'Sign in as David Israel to manage teacher numbers.');
    let welcomeEmail;
    if(req.method==='POST' && req.body?.operation==='access') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const userId=Number(req.body.userId);
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999)fail(400,'Your administrator account always has full access. Choose another teacher.');
        const teacher=(await records()).find(t=>t.userId===userId && !t.deleted);
        if(!teacher)fail(404,'That teacher was not found.');
        if(teacher.deletingPages)fail(409,'Finish deleting this teacher before making other changes.');
        if(req.body.email!==teacher.email)fail(409,'The teacher details changed. Refresh the list and try again.');
        const apps=require('./teacher-apps').validateApps(req.body.apps);
        await updateTeacher(teacher,{...teacher,apps});
    } else if(req.method==='POST' && req.body?.operation==='welcome') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const teacher=(await records()).find(t=>t.userId===Number(req.body.userId) && !t.deleted && !t.deletingPages);
        if(!teacher)fail(404,'That teacher was not found.');
        if(!teacher.passwordEnabled){await updateTeacher(teacher,{...teacher,...temporaryCredentials()});Object.assign(teacher,(await records()).find(t=>t.userId===teacher.userId));}
        try {welcomeEmail=await require('./teacher-welcome-email').sendWelcome(teacher,{resend:true});} catch(error) {welcomeEmail={status:'failed',error:error.message};}
    } else if(req.method==='POST' && req.body?.operation==='delete') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const userId=Number(req.body.userId);
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999)fail(400,'Your administrator account cannot be deleted. Choose another teacher.');
        const teacher=(await records()).find(t=>t.userId===userId && !t.deleted);
        if(!teacher)fail(404,'That teacher was not found.');
        if(req.body.email!==teacher.email)fail(409,'The teacher details changed. Refresh the list and try again.');
        if(req.body.deleteWebpages!==undefined && typeof req.body.deleteWebpages!=='boolean')fail(400,'Choose whether to delete webpages.');
        if(teacher.deletingQuizzes && req.body.deleteQuizzes!==true)fail(409,'Content deletion is incomplete. Select both deletion options and retry.');
        if(req.body.deleteQuizzes!==undefined && typeof req.body.deleteQuizzes!=='boolean')fail(400,'Choose whether to delete quizzes.');
        if(teacher.deletingPages && req.body.deleteWebpages!==true)fail(409,'Webpage deletion is incomplete. Select the webpage checkbox and retry.');
        if(req.body.deleteWebpages===true || req.body.deleteQuizzes===true) {
            if(req.body.confirmPermanentDeletion!==true)fail(400,'Confirm that deleting this user and their webpages cannot be undone.');
            // Block new writes before gathering page contents; keep this record for retries.
            await updateTeacher(teacher,{...teacher,deletingPages:true,deletingQuizzes:req.body.deleteQuizzes===true});
            try {
                if(req.body.deleteWebpages===true)await require('./vocabulary-pages').deleteOwnedPages(userId);
                if(req.body.deleteQuizzes===true)await require('./teacher-content').deleteOwnedQuizzes(teacher);
            }
            catch(_) {fail(503,'Content deletion did not finish. Some content may already be deleted. Teacher access is blocked; keep the deletion options selected and retry.');}
        }
        // Only completed removal of both content types releases the number. Keep a CAS marker for safe reuse.
        await updateTeacher(teacher,{userId,email:teacher.email,deleted:true,reusable:req.body.deleteWebpages===true && req.body.deleteQuizzes===true});
    } else if(req.method==='POST') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const body=req.body || {};
        const userId=Number(body.userId),name=typeof body.name==='string'?body.name.trim():'',email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999 || !name || name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)fail(400,'Enter a new number (2 or higher), name, and school email.');
        const current=await records(),previous=current.find(t=>t.userId===userId);
        if(email==='disrael@saracademy.org' || current.some(t=>t.email===email && !t.reusable))fail(409,'That email already has a teacher number.');
        const apps=require('./teacher-apps').validateApps(body.apps ?? []);
        const teacher={userId,name,email,apps,sessionVersion:crypto.randomUUID(),...temporaryCredentials()};
        try {if(previous?.deleted && previous.reusable)await updateTeacher(previous,teacher);else await put(PREFIX+userId+'.txt',account().seal(teacher),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
        catch(error){if((await records()).some(t=>t.userId===userId))fail(409,'That teacher number is already assigned.');throw error;}
        try {welcomeEmail=await require('./teacher-welcome-email').sendWelcome(teacher);} catch(error) {welcomeEmail={status:'failed',error:error.message};}
    }
    const teachers=[{userId:1,name:'David Israel',email:'disrael@saracademy.org'},...(await records()).filter(t=>!t.deleted).map(t=>({userId:t.userId,name:t.name,email:t.email,apps:require('./teacher-apps').appsFor(t),deletingPages:!!t.deletingPages,deletingQuizzes:!!t.deletingQuizzes}))];
    return {teachers:teachers.sort((a,b)=>a.userId-b.userId),...(welcomeEmail?{welcomeEmail}:{})};
}
async function rejectDeletedSession(req) {
    if(!(req.headers?.cookie || '').includes('__Host-penina-quiz-session='))return;
    let user;
    try { user=account().session(req); } catch (_) { return; }
    if(user.role!=='teacher' || user.email?.toLowerCase()==='disrael@saracademy.org')return;
    const current=await records();
    const active=current.find(t=>t.userId===user.userId && t.email===user.email?.toLowerCase() && !t.deleted && !t.deletingPages);
    if(!active || (active.sessionVersion && active.sessionVersion!==user.sessionVersion))fail(403,'This teacher account has been deleted or replaced. Sign in again.');
    if(user.authMethod!=='google' && current.some(t=>t.mustChangePassword && (t.userId===user.userId || t.email===user.email?.toLowerCase())))fail(403,'Sign in on Penina Home and change your temporary password before opening apps.');
    const deleted=current.some(t=>(t.deleted || t.deletingPages) && (t.userId===user.userId || t.email===user.email?.toLowerCase()));
    if(deleted)fail(403,'This teacher account has been deleted.');
}
module.exports={passwordLogin,changeInitialPassword,number,checkCode,verify,registered,manage,rejectDeletedSession};

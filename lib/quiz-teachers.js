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
// Registry lookup; callers must verify account ownership before issuing a session.
async function registered(email) {
    if(typeof email!=='string')return null;
    email=email.trim().toLowerCase();
    if(email==='disrael@saracademy.org')return {userId:1,email,name:'David Israel'};
    const teacher=(await records()).find(t=>t.email===email && !t.deleted && !t.deletingPages);
    return teacher?{userId:teacher.userId,email:teacher.email,name:teacher.name,apps:require('./teacher-apps').appsFor(teacher)}:null;
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
        try {welcomeEmail=await require('./teacher-welcome-email').sendWelcome(teacher,{resend:true});} catch(error) {welcomeEmail={status:'failed',error:error.message};}
    } else if(req.method==='POST' && req.body?.operation==='delete') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const userId=Number(req.body.userId);
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999)fail(400,'Your administrator account cannot be deleted. Choose another teacher.');
        const teacher=(await records()).find(t=>t.userId===userId && !t.deleted);
        if(!teacher)fail(404,'That teacher was not found.');
        if(req.body.email!==teacher.email)fail(409,'The teacher details changed. Refresh the list and try again.');
        if(req.body.deleteWebpages!==undefined && typeof req.body.deleteWebpages!=='boolean')fail(400,'Choose whether to delete webpages.');
        if(teacher.deletingPages && req.body.deleteWebpages!==true)fail(409,'Webpage deletion is incomplete. Select the webpage checkbox and retry.');
        if(req.body.deleteWebpages===true) {
            if(req.body.confirmPermanentDeletion!==true)fail(400,'Confirm that deleting this user and their webpages cannot be undone.');
            // Block new writes before gathering page contents; keep this record for retries.
            await updateTeacher(teacher,{...teacher,deletingPages:true});
            try {await require('./vocabulary-pages').deleteOwnedPages(userId);}
            catch(_) {fail(503,'Webpage deletion did not finish. Some pages may already be deleted. Teacher access is blocked; keep the webpage checkbox selected and retry.');}
        }
        // Reserve the number so existing content can never pass to a new account.
        await updateTeacher(teacher,{userId,email:teacher.email,deleted:true});
    } else if(req.method==='POST') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const body=req.body || {};
        const userId=Number(body.userId),name=typeof body.name==='string'?body.name.trim():'',email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999 || !name || name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)fail(400,'Enter a new number (2 or higher), name, and school email.');
        if(email==='disrael@saracademy.org' || (await records()).some(t=>t.email===email))fail(409,'That email already has a teacher number.');
        const apps=require('./teacher-apps').validateApps(body.apps ?? []);
        const salt=crypto.randomBytes(16).toString('hex');
        const password=crypto.randomBytes(32).toString('hex');
        const teacher={userId,name,email,apps,salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};
        try {await put(PREFIX+userId+'.txt',account().seal(teacher),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
        catch(error){if((await records()).some(t=>t.userId===userId))fail(409,'That teacher number is already assigned.');throw error;}
        try {welcomeEmail=await require('./teacher-welcome-email').sendWelcome(teacher);} catch(error) {welcomeEmail={status:'failed',error:error.message};}
    }
    const teachers=[{userId:1,name:'David Israel',email:'disrael@saracademy.org'},...(await records()).filter(t=>!t.deleted).map(t=>({userId:t.userId,name:t.name,email:t.email,apps:require('./teacher-apps').appsFor(t),deletingPages:!!t.deletingPages}))];
    return {teachers:teachers.sort((a,b)=>a.userId-b.userId),...(welcomeEmail?{welcomeEmail}:{})};
}
async function rejectDeletedSession(req) {
    if(!(req.headers?.cookie || '').includes('__Host-penina-quiz-session='))return;
    let user;
    try { user=account().session(req); } catch (_) { return; }
    if(user.role!=='teacher' || user.email?.toLowerCase()==='disrael@saracademy.org')return;
    const deleted=(await records()).some(t=>(t.deleted || t.deletingPages) && (t.userId===user.userId || t.email===user.email?.toLowerCase()));
    if(deleted)fail(403,'This teacher account has been deleted.');
}
module.exports={number,checkCode,verify,registered,manage,rejectDeletedSession};

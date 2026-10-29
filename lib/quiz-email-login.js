'use strict';
const crypto=require('crypto');
const {put,list}=require('@vercel/blob');
const PREFIX='quiz-google/email-login/';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function claim(path,value) {
    try {await put(PREFIX+path,value,{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
    catch(error){
        const existing=await list({prefix:PREFIX+path,limit:10});
        if(existing.blobs.some(blob=>blob.pathname===PREFIX+path))return false;
        throw error;
    }
    return true;
}
async function request(req,account) {
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid email address.');
    const from=process.env.QUIZ_EMAIL_FROM || process.env.LIVE_SCORE_EMAIL_FROM;
    if(!process.env.RESEND_API_KEY || !from || !process.env.BLOB_READ_WRITE_TOKEN)fail(503,'Email sign-in is awaiting setup by the site owner.');
    const message='If this email is registered with Penina, a sign-in link is on its way. Check your inbox and spam folder. The link expires in 10 minutes.';
    // Atomic, shared storage limits mail across server instances. Never reveal registration.
    if(!await claim('requests/'+digest(email)+'/'+Math.floor(Date.now()/300000)+'.txt','requested'))return {message};
    const teacher=await require('./quiz-teachers').registered(email);
    if(!teacher)return {message};
    const token=account.seal({kind:'email-login',email,userId:teacher.userId,sessionVersion:teacher.sessionVersion,nonce:crypto.randomBytes(32).toString('hex'),exp:Date.now()+600000});
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from,to:[email],subject:'Sign in to Penina',text:'Open this link to sign in to Penina:\n\nhttps://www.penina-hebrew.org/#email-signin='+token+'\n\nThis link works once and expires in 10 minutes. If you did not request it, ignore this email.'}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail(503,'The sign-in email could not be sent. Please try again in five minutes.');
    return {message};
}
async function verify(req,account) {
    let login;
    try {if(typeof req.body?.token!=='string' || req.body.token.length>4096)throw Error();login=account.unseal(req.body.token);}catch(_){fail(400,'This sign-in link is invalid. Request a new link.');}
    if(login.kind!=='email-login' || !(login.exp>Date.now()) || !/^[a-f0-9]{64}$/.test(login.nonce || ''))fail(400,'This sign-in link has expired. Request a new link.');
    const teacher=await require('./quiz-teachers').registered(login.email);
    if(!teacher || teacher.userId!==login.userId || teacher.sessionVersion!==login.sessionVersion)fail(403,'This teacher account is not active. Contact David Israel for access.');
    const user=await identity(teacher,account);
    const legacyUsed=PREFIX+'used/'+digest(login.nonce)+'.txt';
    if((await list({prefix:legacyUsed,limit:10})).blobs.some(blob=>blob.pathname===legacyUsed))fail(400,'This sign-in link has already been used. Request a new link.');
    if(!await claim('used-by-email/'+digest(login.email.toLowerCase())+'/'+digest(login.nonce)+'.txt','used'))fail(400,'This sign-in link has already been used. Request a new link.');
    return user;
}
async function identity(teacher,account) {
    // Retain existing Google-owned content for teachers who have already connected.
    let sub='email:'+teacher.userId,cursor;
    do {
        const page=await list({prefix:'quiz-google/teachers/',cursor,limit:1000});
        for(const blob of page.blobs){
            const response=await fetch(blob.url,{cache:'no-store'});
            if(!response.ok)fail(503,'Your account could not be loaded. Please try again.');
            const connection=account.unseal(await response.text());
            if(connection.email?.toLowerCase()===teacher.email){sub=blob.pathname.slice('quiz-google/teachers/'.length,-4);break;}
        }
        cursor=sub.startsWith('email:') && page.hasMore?page.cursor:undefined;
    }while(cursor);
    return {sub,email:teacher.email,name:teacher.name,userId:teacher.userId,role:'teacher',sessionVersion:teacher.sessionVersion,authMethod:'email',mustChangePassword:!!teacher.mustChangePassword,credentialVersion:teacher.credentialVersion};
}
module.exports={request,verify,identity};

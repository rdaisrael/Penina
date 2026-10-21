const crypto = require('crypto');
const {list, put} = require('@vercel/blob');
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
            const response=await fetch(blob.url,{cache:'no-store'});
            if(!response.ok)fail(503,'Teacher assignments could not be loaded.');
            result.push(account().unseal(await response.text()));
        }
        cursor=page.hasMore?page.cursor:undefined;
    }while(cursor);
    return result;
}
async function verify(email,password) {
    if(account().verifyTeacher(email,password))return {userId:1,email:'disrael@saracademy.org',name:'David Israel'};
    const id=number(password);
    if(!id || id===1 || typeof email!=='string' || password.length>256)return null;
    const teacher=(await records()).find(t=>t.userId===id && t.email===email.trim().toLowerCase());
    if(!teacher)return null;
    return crypto.timingSafeEqual(crypto.scryptSync(password,teacher.salt,64),Buffer.from(teacher.hash,'hex'))?teacher:null;
}
async function manage(req) {
    if(!account().isAccountOwner(req))fail(403,'Sign in as David Israel to manage teacher numbers.');
    if(req.method==='POST') {
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open Teacher tools on Penina.');
        const body=req.body || {};
        if(!checkCode(body.assignmentPassword,'assign'))fail(401,'The teacher assignment password is incorrect.');
        const userId=Number(body.userId),name=typeof body.name==='string'?body.name.trim():'',email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(!Number.isSafeInteger(userId) || userId<2 || userId>999999999 || !name || name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || number(body.password)!==userId || body.password.length>256)fail(400,'Enter a new number (2 or higher), name, email, and a teacher password beginning with that number and a hyphen.');
        if(email==='disrael@saracademy.org' || (await records()).some(t=>t.email===email))fail(409,'That email already has a teacher number.');
        const salt=crypto.randomBytes(16).toString('hex');
        const teacher={userId,name,email,salt,hash:crypto.scryptSync(body.password,salt,64).toString('hex')};
        try {await put(PREFIX+userId+'.txt',account().seal(teacher),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
        catch(error){if((await records()).some(t=>t.userId===userId))fail(409,'That teacher number is already assigned.');throw error;}
    }
    const teachers=[{userId:1,name:'David Israel',email:'disrael@saracademy.org'},...(await records()).map(({userId,name,email})=>({userId,name,email}))];
    return {teachers:teachers.sort((a,b)=>a.userId-b.userId)};
}
module.exports={number,checkCode,verify,manage};

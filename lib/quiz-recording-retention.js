'use strict';
const crypto=require('crypto');
const {list,put,del,head,get,BlobNotFoundError,BlobPreconditionFailedError}=require('@vercel/blob');
const DAY=86400000,RETENTION_DAYS=90;
const AUDIO='quiz-recordings/',STATE='quiz-recording-retention/',DELETED='quiz-recording-deletions/';
const LOCK='quiz-recording-retention-lock/run.txt';
const account=()=>require('./quiz-account');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validQuiz=id=>/^custom-[a-f0-9]{32}$/.test(id);
async function all(prefix){
    const items=[];let cursor;
    do{const page=await list({prefix,cursor,limit:1000});items.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined;}while(cursor);
    return items;
}
async function read(path){
    const blob=(await list({prefix:path,limit:10})).blobs.find(b=>b.pathname===path);
    if(!blob)return null;
    const response=await fetch(blob.url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Recording retention state could not be read.');
    return account().unseal(await response.text());
}
async function once(path,value){
    try{await put(path,account().seal(value),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});return value;}
    catch(error){const previous=await read(path);if(!previous)throw error;return previous;}
}
function identify(path){
    const match=/^quiz-recordings\/(custom-[a-f0-9]{32})\/([a-f0-9]{64})(?:\.json|-parts\/[0-9]+\.json)$/.exec(path);
    return match?{quiz:match[1],hash:match[2]}:null;
}
async function inventory(quiz){
    if(quiz && !validQuiz(quiz))fail(400,'Choose a saved quiz.');
    const groups=new Map();
    for(const blob of await all(AUDIO+(quiz?quiz+'/':''))){
        const id=identify(blob.pathname);if(!id)continue;
        const savedAt=new Date(blob.uploadedAt).getTime();
        // Missing dates never qualify for automated deletion.
        const key=id.quiz+'/'+id.hash,group=groups.get(key) || {...id,files:[],savedAt:0};
        group.files.push(blob);group.savedAt=Math.max(group.savedAt,savedAt);groups.set(key,group);
    }
    return [...groups.values()];
}
const markerPath=(quiz,hash)=>DELETED+quiz+'/'+hash+'.txt';
async function deletedHashes(quiz){return new Set((await all(DELETED+quiz+'/')).map(b=>b.pathname.slice((DELETED+quiz+'/').length,-4)));}
async function isDeleted(path){
    const id=identify(path);if(!id)throw Error('Invalid recording path.');
    const marker=markerPath(id.quiz,id.hash);
    return (await list({prefix:marker,limit:1})).blobs.some(b=>b.pathname===marker);
}
async function assertAvailable(path){
    if(await isDeleted(path))fail(410,'This recording has been deleted. Saved grades, feedback, and written answers are still available.');
}
async function removeGroup(group,reason){
    // The durable marker prevents an old upload retry from restoring deleted audio.
    await once(markerPath(group.quiz,group.hash),{deletedAt:new Date().toISOString(),reason});
    const base=AUDIO+group.quiz+'/'+group.hash;
    const files=(await all(base)).filter(b=>identify(b.pathname)?.hash===group.hash);
    const parts=files.filter(b=>b.pathname!==base+'.json');
    for(let i=0;i<parts.length;i+=100)await del(parts.slice(i,i+100).map(b=>b.url));
    const manifest=files.find(b=>b.pathname===base+'.json');if(manifest)await del(manifest.url);
    return files.length;
}
function fingerprint(groups){
    return crypto.createHash('sha256').update(JSON.stringify(groups.flatMap(g=>g.files.map(b=>[b.pathname,b.uploadedAt,b.size])).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
}
async function manual(quiz,user,body){
    const groups=await inventory(quiz.id);
    if(body.action==='recordings-delete-preview')return {
        count:groups.length,bytes:groups.reduce((sum,g)=>sum+g.files.reduce((n,b)=>n+(b.size || 0),0),0),
        token:account().seal({kind:'delete-recordings',quiz:quiz.id,owner:user.sub,fingerprint:fingerprint(groups),exp:Date.now()+15*60000})
    };
    let token;try{token=account().unseal(body.token);}catch(_){fail(400,'Review the recordings again before deleting.');}
    if(body.confirmPermanentDeletion!==true || token.kind!=='delete-recordings' || token.quiz!==quiz.id || token.owner!==user.sub || !(token.exp>Date.now()))fail(400,'Review and confirm permanent recording deletion.');
    if(token.fingerprint!==fingerprint(groups))fail(409,'The recordings changed. Review the current recordings before deleting.');
    let files=0;for(const group of groups)files+=await removeGroup(group,'manual');
    return {deleted:groups.length,files};
}
const dateLabel=ms=>new Date(ms).toLocaleDateString('en-US',{timeZone:'America/New_York',year:'numeric',month:'long',day:'numeric'});
async function notice(path,plan,days,now){
    const receipt=await read(path+'/sent-'+days+'.txt');if(receipt)return receipt;
    // Persist the exact email before sending so interrupted retries use the same payload/key.
    // A new daily attempt receives a fresh deadline; successful sends have durable receipts.
    const generation=Math.floor(now/DAY),noticePath=path+'/notice-'+days+'-'+generation+'.txt';
    const quiz=await read('quiz-builder/published/'+plan.quiz+'.txt');
    if(!quiz || typeof quiz.owner!=='string' || !/^[a-zA-Z0-9:_-]+$/.test(quiz.owner))throw Error('The quiz owner could not be verified.');
    const teacher=await read('quiz-google/teachers/'+quiz.owner+'.txt');
    const to=teacher?.email;
    if(typeof to!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw Error('The quiz owner email is unavailable.');
    const from=process.env.QUIZ_EMAIL_FROM || process.env.LIVE_SCORE_EMAIL_FROM;
    if(!process.env.RESEND_API_KEY || !from)throw Error('Recording reminder email is not configured.');
    const deleteAfter=Math.max(plan.deleteAfter,now+days*DAY);
    const prepared=await once(noticePath,{deleteAfter,payload:{from,to:[to],
        subject:`Penina: recordings scheduled for deletion in ${days} days`,
        text:[`Quiz: ${plan.title}`,`${plan.hashes.length} saved recording(s) are scheduled for automatic deletion on ${dateLabel(deleteAfter)}.`,
            '',`Penina keeps recorded answers for ${RETENTION_DAYS} days. This reminder is ${days} days before scheduled deletion.`,
            'Open the quiz and download any recordings you want to keep before that date:',
            'https://www.penina-hebrew.org/Penina-Quizzes/custom/teacher.html?quiz='+encodeURIComponent(plan.quiz),
            '', 'Only audio recordings and their uploaded parts will be removed. Grades, feedback, written answers, and the quiz will remain.',
            'The cleanup also includes replaced takes, practice recordings, and unfinished uploads. Older recordings or delayed reminders receive extra time before deletion.'
        ].join('\n')}});
    const key=crypto.createHash('sha256').update(noticePath).digest('hex');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'recording-retention-'+key},body:JSON.stringify(prepared.payload),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Recording reminder email was not accepted.');
    return once(path+'/sent-'+days+'.txt',{sentAt:now,deleteAfter:prepared.deleteAfter});
}
async function acquireLock(now){
    const value=account().seal({until:now+10*60000});
    let etag;
    try{
        const metadata=await head(LOCK);
        const response=await get(metadata.url+'?retentionVersion='+encodeURIComponent(metadata.etag),{access:'public',useCache:false});
        if(!response || response.statusCode!==200 || response.blob.etag!==metadata.etag)throw Error('Retention lock could not be verified.');
        if(account().unseal(await new Response(response.stream).text()).until>now)return null;
        etag=metadata.etag;
    }catch(error){if(!(error instanceof BlobNotFoundError))throw error;}
    try{
        const result=await put(LOCK,value,{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{})});
        return result.etag;
    }catch(error){if(error instanceof BlobPreconditionFailedError || (await list({prefix:LOCK,limit:1})).blobs.some(b=>b.pathname===LOCK))return null;throw error;}
}
async function sweep(now=Date.now()){
    const lock=await acquireLock(now);if(!lock)return {busy:true};
    const result={reminders:0,recordingsDeleted:0,failed:0,deferred:0};
    const stopAt=Date.now()+230000;
    try{
        const groups=await inventory(),byId=new Map(groups.map(g=>[g.quiz+'/'+g.hash,g]));
        const plans=[];
        for(const blob of await all(STATE))if(blob.pathname.endsWith('/plan.txt')){
            if(Date.now()>stopAt)return {...result,deferred:result.deferred+1};
            const plan=await read(blob.pathname);if(!plan)throw Error('Retention plan disappeared.');
            plans.push({path:blob.pathname.slice(0,-9),plan});
        }
        const tracked=new Set(plans.flatMap(({plan})=>plan.hashes.map(hash=>plan.quiz+'/'+hash)));
        const cohorts=new Map();
        for(const group of groups){
            if(!Number.isFinite(group.savedAt) || group.savedAt>now-79*DAY || tracked.has(group.quiz+'/'+group.hash))continue;
            const day=new Date(group.savedAt).toISOString().slice(0,10),path=STATE+group.quiz+'/'+day;
            const cohort=cohorts.get(path) || {quiz:group.quiz,hashes:[],deleteAfter:0};
            cohort.hashes.push(group.hash);cohort.deleteAfter=Math.max(cohort.deleteAfter,group.savedAt+RETENTION_DAYS*DAY);cohorts.set(path,cohort);
        }
        for(const [path,cohort] of cohorts){
            if(Date.now()>stopAt)return {...result,deferred:result.deferred+1};
            // Include the whole (long-closed) upload date, then wait for its newest file.
            if(cohort.deleteAfter>now+10*DAY)continue;
            const quiz=await read('quiz-builder/published/'+cohort.quiz+'.txt');
            const plan=await once(path+'/plan.txt',{...cohort,title:quiz?.title || 'Saved quiz',deleteAfter:Math.max(cohort.deleteAfter,now+10*DAY)});
            plans.push({path,plan});
        }
        for(const {path,plan} of plans){
            if(Date.now()>stopAt){result.deferred++;continue;}
            try{
                const remaining=plan.hashes.map(hash=>byId.get(plan.quiz+'/'+hash)).filter(Boolean);
                if(!remaining.length){await del((await all(path+'/')).map(b=>b.url));continue;}
                let first=await read(path+'/sent-10.txt');
                if(!first){first=await notice(path,plan,10,now);result.reminders++;}
                const firstDue=Math.max(plan.deleteAfter,first.deleteAfter,first.sentAt+10*DAY);
                if(now<firstDue-5*DAY)continue;
                let second=await read(path+'/sent-5.txt');
                if(!second){second=await notice(path,{...plan,deleteAfter:firstDue},5,now);result.reminders++;}
                const due=Math.max(firstDue,second.deleteAfter,second.sentAt+5*DAY);
                if(now<due)continue;
                for(const group of remaining){
                    if(Date.now()>stopAt){result.deferred++;break;}
                    // Recheck age and membership; a recovered upload never inherits an older deadline.
                    const files=(await all(AUDIO+group.quiz+'/'+group.hash)).filter(b=>identify(b.pathname)?.hash===group.hash);
                    if(!files.length || files.some(b=>!Number.isFinite(new Date(b.uploadedAt).getTime()) || new Date(b.uploadedAt).getTime()+RETENTION_DAYS*DAY>now))continue;
                    const current={...group,files};
                    await removeGroup(current,'retention');result.recordingsDeleted++;
                }
            }catch(_){result.failed++;}
        }
        return result;
    }finally{try{await del(LOCK,{ifMatch:lock});}catch(_){/* An expired lease must not release another run's lock. */}}
}
async function handle(req,res){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Use GET.'});}
    const secret=process.env.CRON_SECRET,authorization=req.headers?.authorization;
    if(!secret)return res.status(503).json({error:'Recording retention requires CRON_SECRET.'});
    const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(typeof authorization==='string'?authorization:'');
    if(actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected))return res.status(401).json({error:'Unauthorized.'});
    try{const result=await sweep();return res.status(result.failed?503:200).json(result);}
    catch(_){return res.status(503).json({error:'Recording retention could not finish. It will retry on the next scheduled run.'});}
}
module.exports={manual,handle,sweep,inventory,deletedHashes,isDeleted,assertAvailable,removeGroup,RETENTION_DAYS};

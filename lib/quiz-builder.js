'use strict';
const crypto=require('crypto');
const {list,put}=require('@vercel/blob');
const model=require('./quiz-builder-model');
const PREFIX='quiz-builder/';
const validId=id=>typeof id==='string' && /^custom-[a-f0-9]{32}$/.test(id);
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function account(){return require('./quiz-account');}
function owner(req){const user=account().session(req);if(user.role!=='teacher')fail(403,'Connect your Google teacher account to build quizzes.');return user;}
function ownerPath(user){return PREFIX+'teachers/'+crypto.createHash('sha256').update(user.sub).digest('hex')+'/';}
async function read(path){const page=await list({prefix:path,limit:10});const blob=page.blobs.find(b=>b.pathname===path);if(!blob)return null;const response=await fetch(blob.url,{cache:'no-store'});if(!response.ok)fail(503,'The saved quiz could not be loaded. Try again.');return account().unseal(await response.text());}
async function write(path,value,overwrite=true){return put(path,account().seal(value),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:overwrite});}
async function published(id){if(!validId(id))fail(400,'Choose a saved quiz.');const quiz=await read(PREFIX+'published/'+id+'.txt');if(!quiz)fail(404,'This quiz is not published yet.');return quiz;}
async function info(id){const q=await published(id);return {id:q.id,title:q.title,durationMinutes:q.durationMinutes,forwardOnlyFrom:q.forwardOnlyFrom ?? null,checkpointMessage:q.checkpointMessage,maxPoints:q.questions.filter(q=>!q.extraCredit).reduce((n,q)=>n+model.maxPoints(q),0),description:q.questions.length+' questions.',path:'/Penina-Quizzes/custom/?quiz='+q.id,owner:q.owner};}
async function handle(req,res){
    res.setHeader('Cache-Control','no-store');
    try {
        if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
        if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open the quiz builder on Penina.');
        const user=owner(req),body=req.body || {},prefix=ownerPath(user);
        if(body.action==='import-vocabulary')return res.status(200).json({rows:require('./quiz-vocabulary').parseTable(body.text)});
        if(body.action==='vocabulary-distractors')return res.status(200).json({rows:await require('./quiz-vocabulary').distractors(body)});
        if(body.action==='vocabulary-coverage')return res.status(200).json({coverage:require('./quiz-vocabulary').coverage(body)});
        if(body.action==='vocabulary-questions')return res.status(200).json({questions:await require('./quiz-vocabulary').questions(body)});
        if(body.action==='list'){
            const quizzes=[];let cursor;
            do{const page=await list({prefix,cursor,limit:1000});for(const blob of page.blobs){const r=await fetch(blob.url,{cache:'no-store'});if(!r.ok)fail(503,'Your quiz library could not be loaded.');const q=account().unseal(await r.text());quizzes.push({id:q.id,title:q.title,published:Boolean(q.published),updatedAt:q.updatedAt,count:q.questions.length});}cursor=page.hasMore?page.cursor:undefined;}while(cursor);
            return res.status(200).json({email:user.email,quizzes:quizzes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
        }
        if(body.action==='save'){
            const value=model.validateQuiz(body.quiz),id=body.id || 'custom-'+crypto.randomBytes(16).toString('hex');
            if(!validId(id))fail(400,'Choose a valid quiz.');
            const old=await read(prefix+id+'.txt');
            if(old?.published)fail(409,'This quiz is published. Duplicate it to make changes for a new assignment.');
            // A publication is immutable, even if the draft status write was interrupted.
            if(await read(PREFIX+'published/'+id+'.txt'))fail(409,'This quiz is published. Duplicate it before editing.');
            const vocabulary=body.quiz.vocabulary===undefined?undefined:require('./quiz-vocabulary').source(body.quiz.vocabulary);
            const quiz={...value,...(vocabulary?{vocabulary}:{}),id,owner:user.sub,updatedAt:new Date().toISOString(),published:false};
            await write(prefix+id+'.txt',quiz);return res.status(200).json({quiz});
        }
        if(!validId(body.id))fail(400,'Choose a saved quiz.');
        const quiz=await read(prefix+body.id+'.txt');if(!quiz)fail(404,'This quiz is not in your library.');
        if(body.action==='load')return res.status(200).json({quiz});
        if(body.action==='publish'){
            model.validateQuiz(quiz,true);
            const {vocabulary,...publishable}=quiz;
            const snapshot={...publishable,published:true};
            try{await write(PREFIX+'published/'+quiz.id+'.txt',snapshot,false);}catch(error){const existing=await read(PREFIX+'published/'+quiz.id+'.txt');if(!existing || existing.owner!==user.sub)throw error;Object.assign(snapshot,existing);}
            await write(prefix+quiz.id+'.txt',{...snapshot,...(quiz.vocabulary?{vocabulary:quiz.vocabulary}:{})});return res.status(200).json({quiz:{...snapshot,...(quiz.vocabulary?{vocabulary:quiz.vocabulary}:{})}});
        }
        fail(400,'Choose a quiz builder action.');
    }catch(error){return res.status(error.status || 503).json({error:error.status?error.message:'Your quiz could not be saved or loaded. Keep this page open and try again.'});}
}
module.exports={handle,published,info,owner,validId};

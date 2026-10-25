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
async function published(id){if(!validId(id))fail(400,'Choose a saved quiz.');const quiz=await read(PREFIX+'published/'+id+'.txt');if(!quiz)fail(404,'This quiz is not published yet.');const prefix=PREFIX+'points/'+id+'/';
    let cursor,latest;
    do {const page=await list({prefix,cursor,limit:1000});for(const blob of page.blobs)if(!latest || blob.pathname>latest)latest=blob.pathname;cursor=page.hasMore?page.cursor:undefined;}while(cursor);
    const adjustment=latest?await read(latest):null;
    if(latest && !adjustment)fail(503,'Potential points could not be loaded. Try again.');
    return {...quiz,pointsRevision:adjustment?.revision || 0,questions:quiz.questions.map((q,i)=>adjustment?{...q,...adjustment.scoring?.[i],potentialPoints:adjustment.points[i]}:q)};}
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
        if(['load-points','save-points'].includes(body.action)) {
            const current=await published(body.id);
            if(current.owner!==user.sub)fail(403,'Only the quiz author can edit potential points.');
            let classroom;
            if(body.action==='save-points') {
                if(body.revision!==current.pointsRevision)fail(409,'Potential points have changed. Close and reopen the editor before saving.');
                if(!Array.isArray(body.points) || body.points.length!==current.questions.length || !body.points.every(n=>typeof n==='number' && Number.isFinite(n) && n>=0.5 && n<=5000 && Number.isInteger(n*2)))fail(400,'Enter 0.5–5,000 potential points per question, in half-point steps.');
                const modes=body.scoringModes ?? current.questions.map(q=>q.scoringMode || 'total');
                if(!Array.isArray(modes) || modes.length!==current.questions.length || modes.some((mode,i)=>!['total','response'].includes(mode) && !(mode==='proportional' && current.questions[i].scoringMode===mode)))fail(400,'Choose per question or per correct answer for every question.');
                const scoring=current.questions.map((q,i)=>modes[i]!== (q.scoringMode || 'total')
                    ? {points:body.points[i]/(modes[i]==='response'?model.responseCount(q):1),scoringMode:modes[i],perResponseCredit:true,allowHalfCredit:true}
                    : {points:q.points,scoringMode:q.scoringMode || 'total',perResponseCredit:q.perResponseCredit===true,allowHalfCredit:q.allowHalfCredit===true});
                if(body.points.some((n,i)=>n!==model.maxPoints(current.questions[i]) || modes[i]!== (current.questions[i].scoringMode || 'total'))) {
                    const revision=current.pointsRevision+1;
                    const path=PREFIX+'points/'+body.id+'/'+String(revision).padStart(10,'0')+'.txt';
                    try {await write(path,{revision,points:body.points,scoring,updatedAt:new Date().toISOString(),owner:user.sub},false);}
                    catch(error){if(await read(path))fail(409,'Another edit was saved. Close and reopen the editor to review it.');throw error;}
                    current.pointsRevision=revision;
                    current.questions=current.questions.map((q,i)=>({...q,...scoring[i],potentialPoints:body.points[i]}));
                }
            }
            if(body.action==='save-points') {
                try {classroom=await account().syncPotentialPoints(req,body.id);}
                catch(error){classroom={warning:'Saved in Penina, but Classroom syncing could not finish. '+(error.status?error.message:'Save again to retry.')};}
            }
            return res.status(200).json({classroom,id:current.id,title:current.title,revision:current.pointsRevision,questions:current.questions.map(q=>({prompt:q.prompt,type:q.type,answer:q.answer,scoringMode:q.scoringMode || 'total',responseCount:model.responseCount(q),items:q.type==='match'?q.items:undefined,direction:q.direction,wordBank:q.wordBank,extraCredit:q.extraCredit===true,potentialPoints:model.maxPoints(q)}))});
        }
        if(body.action==='load')return res.status(200).json({quiz:quiz.published?{...quiz,...await published(body.id)}:quiz});
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

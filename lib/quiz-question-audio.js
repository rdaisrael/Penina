'use strict';
const crypto=require('crypto');
const {list,put}=require('@vercel/blob');
const settings=require('../Penina-Quizzes/question-audio');
function fail(status,message){throw Object.assign(Error(message),{status});}
function path(owner,id){if(!settings.validId(id))fail(400,'Choose a valid teacher recording.');return 'quiz-question-audio/'+crypto.createHash('sha256').update(owner).digest('hex')+'/'+id+'/';}
async function read(pathname){
    const page=await list({prefix:pathname,limit:10}),blob=page.blobs.find(b=>b.pathname===pathname);
    if(!blob)return null;
    const response=await fetch(blob.url,{cache:'no-store',signal:AbortSignal.timeout(45000)});
    if(!response.ok)fail(503,'The teacher recording could not be loaded. Try again.');
    return require('./quiz-account').unseal(await response.text());
}
async function write(pathname,value){
    // Content-addressed attachments are immutable and safe to reuse in copies.
    const existing=await read(pathname);
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(value))fail(409,'This audio upload changed. Upload it again.');return;}
    try{await put(pathname,require('./quiz-account').seal(value),{access:'public',contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});}
    catch(error){if(JSON.stringify(await read(pathname))!==JSON.stringify(value))throw error;}
}
async function manifest(owner,id){const value=await read(path(owner,id)+'audio.txt');if(!value)fail(400,'Finish uploading the teacher recording before saving.');return value;}
async function save(owner,body){
    const prefix=path(owner,body.audioId),{part,totalBytes}=body;
    if(!Number.isInteger(totalBytes) || totalBytes<46 || totalBytes>settings.MAX_BYTES || !Number.isInteger(part) || part<0 || part>=Math.ceil(totalBytes/settings.PART_BYTES) || typeof body.audio!=='string' || body.audio.length>settings.PART_BYTES*4/3+4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))fail(400,'Choose valid audio upload parts, up to 5 minutes.');
    const bytes=Buffer.from(body.audio,'base64');
    if(bytes.toString('base64')!==body.audio || bytes.length!==Math.min(settings.PART_BYTES,totalBytes-part*settings.PART_BYTES))fail(400,'This audio upload is incomplete. Retry uploading it.');
    await write(prefix+part+'.txt',{audio:body.audio,totalBytes,part});
    if(part<Math.ceil(totalBytes/settings.PART_BYTES)-1)return {partSaved:true,part};
    const pieces=[];
    for(let i=0;i<=part;i++){
        const piece=await read(prefix+i+'.txt');
        if(!piece || piece.part!==i || piece.totalBytes!==totalBytes)fail(400,'This recording is missing parts. Retry uploading it.');
        pieces.push(Buffer.from(piece.audio,'base64'));
    }
    const complete=Buffer.concat(pieces);
    if(complete.length!==totalBytes || crypto.createHash('sha256').update(complete).digest('hex')!==body.audioId)fail(400,'This recording is incomplete. Retry uploading it.');
    let durationMs;try{durationMs=settings.inspect(complete);}catch(error){fail(400,error.message);}
    const value={id:body.audioId,durationMs,totalBytes};await write(prefix+'audio.txt',value);
    return {saved:true,teacherAudio:{id:value.id,durationMs}};
}
async function load(owner,id,part){
    const value=await manifest(owner,id);
    if(!Number.isInteger(part) || part<0 || part>=Math.ceil(value.totalBytes/settings.PART_BYTES))fail(400,'Choose a valid recording part.');
    const piece=await read(path(owner,id)+part+'.txt');if(!piece)fail(503,'This recording could not be loaded. Try again.');
    return {...piece,id};
}
async function validateQuestions(owner,questions){
    const seen=new Map();
    for(const q of questions){
        if(!q.teacherAudio)continue;
        const value=seen.get(q.teacherAudio.id) || await manifest(owner,q.teacherAudio.id);seen.set(value.id,value);
        if(value.durationMs!==q.teacherAudio.durationMs)fail(400,'The teacher recording duration has changed. Upload it again.');
    }
}
module.exports={save,load,validateQuestions};

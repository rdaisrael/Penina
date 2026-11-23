'use strict';
const settings=require('../Penina-Quizzes/custom/recording-settings');
const {UPLOAD_BYTES,PART_BYTES,MAX_BYTES}=settings;
function validateRecording(body,question={}){
    const fail=message=>{const error=new Error(message);error.status=400;throw error;};
    if(typeof body.audio!=='string' || body.audio.length>Math.ceil(UPLOAD_BYTES/3)*4+100)fail('The recording upload is too large. Retry saving in smaller parts.');
    const match=/^data:(audio\/(?:webm|mp4|ogg)(?:;codecs=[a-zA-Z0-9., -]+)?);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.audio);
    if(!match)fail('Use an audio recording in WebM, MP4, or Ogg format.');
    const bytes=Buffer.from(match[2],'base64');
    if(!bytes.length || bytes.length>UPLOAD_BYTES || bytes.toString('base64')!==match[2])fail('The recording upload is incomplete or too large. Retry saving.');
    const multipart=body.part!==undefined || body.totalParts!==undefined || body.totalBytes!==undefined;
    if(multipart){
        if(!Number.isInteger(body.totalBytes) || body.totalBytes<=UPLOAD_BYTES || body.totalBytes>MAX_BYTES || body.totalParts!==Math.ceil(body.totalBytes/PART_BYTES) || !Number.isInteger(body.part) || body.part<0 || body.part>=body.totalParts)fail('Choose valid recording upload parts.');
        if(bytes.length!==Math.min(PART_BYTES,body.totalBytes-body.part*PART_BYTES))fail('This recording part is incomplete. Retry saving.');
    }
    const mime=match[1].split(';')[0];
    const signature=mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime==='audio/ogg'?bytes.subarray(0,4).toString()==='OggS':bytes.subarray(4,8).toString()==='ftyp';
    if((!multipart || body.part===0) && !signature)fail('This audio file is not a valid recording. Record your answer again.');
    if(!settings.validMinutes(settings.minutes(question)) || typeof body.durationMs!=='number' || !Number.isFinite(body.durationMs) || body.durationMs<1 || body.durationMs>settings.limitMs(question))fail('Record an answer up to '+settings.label(question)+'.');
    return {audio:body.audio,durationMs:body.durationMs,...(multipart?{part:body.part,totalParts:body.totalParts,totalBytes:body.totalBytes}:{})};
}
function completeRecording(parts,last,question){
    const fail=()=>{const error=new Error('The recording is missing parts. Retry saving it.');error.status=400;throw error;};
    parts.sort((a,b)=>a.part-b.part);
    if(parts.length!==last.totalParts)fail();
    const header=last.audio.slice(0,last.audio.indexOf(','));
    for(let i=0;i<parts.length;i++){
        const part=validateRecording(parts[i],question);
        if(part.part!==i || part.totalParts!==last.totalParts || part.totalBytes!==last.totalBytes || part.durationMs!==last.durationMs || part.audio.slice(0,part.audio.indexOf(','))!==header)fail();
    }
    return {chunked:true,totalParts:last.totalParts,totalBytes:last.totalBytes,durationMs:last.durationMs,header};
}
module.exports={validateRecording,completeRecording,MAX_BYTES,UPLOAD_BYTES};

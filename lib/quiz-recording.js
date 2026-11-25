'use strict';
const settings=require('../Penina-Quizzes/custom/recording-settings');
const {UPLOAD_BYTES,PART_BYTES,MAX_BYTES}=settings;
function validateRecording(body,question={}){
    const fail=message=>{const error=new Error(message);error.status=400;throw error;};
    if(typeof body.audio!=='string' || body.audio.length>Math.ceil(UPLOAD_BYTES/3)*4+300)fail('The recording upload is too large. Retry saving in smaller parts.');
    const parsed=settings.parseAudio(body.audio);
    if(!parsed)fail('This recording has an unsupported audio format. Record again, or use your previous saved recording if available.');
    const bytes=Buffer.from(parsed.encoded,'base64');
    if(!bytes.length || bytes.length>UPLOAD_BYTES || bytes.toString('base64')!==parsed.encoded)fail('The recording upload is incomplete or too large. Retry saving.');
    const multipart=body.part!==undefined || body.totalParts!==undefined || body.totalBytes!==undefined;
    if(multipart){
        if(!Number.isInteger(body.totalBytes) || body.totalBytes<=UPLOAD_BYTES || body.totalBytes>MAX_BYTES || body.totalParts!==Math.ceil(body.totalBytes/PART_BYTES) || !Number.isInteger(body.part) || body.part<0 || body.part>=body.totalParts)fail('Choose valid recording upload parts.');
        if(bytes.length!==Math.min(PART_BYTES,body.totalBytes-body.part*PART_BYTES))fail('This recording part is incomplete. Retry saving.');
    }
    const mime=parsed.mime;
    const signature=mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime==='audio/ogg'?bytes.subarray(0,4).toString()==='OggS':bytes.subarray(4,8).toString()==='ftyp';
    if((!multipart || body.part===0) && !signature)fail('This audio file is not a valid recording. Record your answer again.');
    if(!settings.validStoredMinutes(settings.minutes(question)) || typeof body.durationMs!=='number' || !Number.isFinite(body.durationMs) || body.durationMs<1 || body.durationMs>settings.limitMs(question))fail('Record an answer up to '+settings.label(question)+'.');
    return {audio:body.audio,durationMs:body.durationMs,...(multipart?{part:body.part,totalParts:body.totalParts,totalBytes:body.totalBytes}:{})};
}
function completeRecording(parts,last,question){
    const fail=()=>{const error=new Error('The recording is missing parts. Retry saving it.');error.status=400;throw error;};
    parts.sort((a,b)=>a.part-b.part);
    if(parts.length!==last.totalParts)fail();
    const header=settings.parseAudio(last.audio)?.header;
    for(let i=0;i<parts.length;i++){
        const part=validateRecording(parts[i],question);
        if(part.part!==i || part.totalParts!==last.totalParts || part.totalBytes!==last.totalBytes || part.durationMs!==last.durationMs || settings.parseAudio(part.audio).header!==header)fail();
    }
    return {chunked:true,totalParts:last.totalParts,totalBytes:last.totalBytes,durationMs:last.durationMs,header};
}
module.exports={validateRecording,completeRecording,MAX_BYTES,UPLOAD_BYTES};

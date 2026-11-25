/* Teacher audio accompanies a question; it is never a student's answer. */
(function(root,factory){if(typeof module==='object' && module.exports)module.exports=factory();else root.QuizQuestionAudio=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const LIMIT_MS=300000,RATE=16000,PART_BYTES=1500000,MAX_BYTES=44+RATE*2*LIMIT_MS/1000;
    const validId=id=>typeof id==='string' && /^[a-f0-9]{64}$/.test(id);
    const valid=value=>value && validId(value.id) && Number.isFinite(value.durationMs) && value.durationMs>0 && value.durationMs<=LIMIT_MS;
    const label=ms=>Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');
    // A single canonical PCM format lets the server verify the actual duration,
    // including uploads whose filename or supplied duration is misleading.
    function inspect(bytes){
        if(bytes.length<46 || bytes.length>MAX_BYTES)throw Error('Use a recording up to 5 minutes.');
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
        if(text(0,4)!=='RIFF' || text(8,12)!=='WAVE' || text(12,16)!=='fmt ' || text(36,40)!=='data' || view.getUint32(4,true)!==bytes.length-8 || view.getUint32(16,true)!==16 || view.getUint16(20,true)!==1 || view.getUint16(22,true)!==1 || view.getUint32(24,true)!==RATE || view.getUint32(28,true)!==RATE*2 || view.getUint16(32,true)!==2 || view.getUint16(34,true)!==16 || view.getUint32(40,true)!==bytes.length-44 || (bytes.length-44)%2)throw Error('This audio could not be read. Upload or record it again.');
        return (bytes.length-44)/(RATE*2)*1000;
    }
    function encode(samples){
        const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer);
        for(const [at,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);
        view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,RATE,true);view.setUint32(28,RATE*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,samples.length*2,true);
        samples.forEach((sample,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767),true));
        inspect(bytes);return bytes;
    }
    function render(q){return valid(q.teacherAudio)?`<div class="question-audio" data-question-audio="${q.teacherAudio.id}" data-audio-duration="${q.teacherAudio.durationMs}"><p>Teacher recording · ${label(q.teacherAudio.durationMs)}</p><button type="button" data-question-audio-load>Load teacher recording</button><audio controls preload="none" aria-label="Teacher recording" hidden></audio><p data-question-audio-status role="status"></p></div>`:'';}
    function bind(root,request){
        const cache=new Map();
        root.addEventListener('click',async event=>{
            const button=event.target.closest('[data-question-audio-load]');if(!button)return;
            const box=button.closest('[data-question-audio]'),id=box.dataset.questionAudio,message=box.querySelector('[data-question-audio-status]'),audio=box.querySelector('audio');
            button.disabled=true;message.textContent='Loading teacher recording…';
            try{
                if(!cache.has(id)){
                    const pieces=[];let totalBytes;
                    for(let part=0;totalBytes===undefined || part<Math.ceil(totalBytes/PART_BYTES);part++){
                        const value=await request({action:'question-audio-load',audioId:id,part},box);
                        if(value.id!==id || value.part!==part || !Number.isInteger(value.totalBytes) || value.totalBytes<46 || value.totalBytes>MAX_BYTES || totalBytes!==undefined && value.totalBytes!==totalBytes || typeof value.audio!=='string' || value.audio.length>PART_BYTES*4/3+4)throw Error('This recording could not be loaded. Try again.');
                        totalBytes=value.totalBytes;
                        const bytes=Uint8Array.from(atob(value.audio),c=>c.charCodeAt(0));
                        if(bytes.length!==Math.min(PART_BYTES,totalBytes-part*PART_BYTES))throw Error('This recording is incomplete. Try again.');
                        pieces.push(bytes);
                    }
                    const bytes=new Uint8Array(totalBytes);pieces.forEach((piece,i)=>bytes.set(piece,i*PART_BYTES));
                    if(inspect(bytes)!==Number(box.dataset.audioDuration))throw Error('This recording could not be verified. Try again.');
                    cache.set(id,URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})));
                }
                audio.preload='metadata';audio.src=cache.get(id);audio.hidden=false;button.hidden=true;message.textContent='';
                audio.onerror=()=>{message.textContent='This recording could not be played. Try loading it again.';button.hidden=false;};
                audio.load();audio.focus();
            }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
        });
        window.addEventListener('pagehide',event=>{if(event.persisted)return;for(const url of cache.values())URL.revokeObjectURL(url);cache.clear();});
    }
    return {LIMIT_MS,RATE,PART_BYTES,MAX_BYTES,validId,valid,label,inspect,encode,render,bind};
});

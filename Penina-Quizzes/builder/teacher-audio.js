'use strict';
const TeacherAudio=(()=>{
    const settings=QuizQuestionAudio,pending=new WeakMap();
    let capture=null;
    function renderTools(q){
        return `<div class="teacher-audio-tools"><h3>Teacher recording (optional)</h3><p class="hint">Students can listen while answering. Upload an audio file or record here, up to 5 minutes.</p><label>Upload / replace recording<input type="file" data-teacher-audio-file accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"></label><div class="teacher-audio-actions"><button type="button" data-teacher-audio-record>Record teacher audio</button><button type="button" data-teacher-audio-stop hidden>Stop recording</button>${pending.has(q)?'<button type="button" data-teacher-audio-retry>Retry uploading recording</button><button type="button" data-teacher-audio-discard>Discard unsaved recording</button>':''}${q.teacherAudio?'<button type="button" class="secondary" data-teacher-audio-remove>Remove recording</button>':''}</div><p data-teacher-audio-status role="status" aria-live="polite">${pending.has(q)?'Recording not attached yet. Retry uploading it or discard it. Keep this page open.':''}</p>${pending.has(q)?'<audio data-teacher-audio-preview controls aria-label="Unsaved teacher recording"></audio>':''}${settings.render(q)}</div>`;
    }
    function box(q){return $('questions').querySelector(`[data-index="${quiz.questions.indexOf(q)}"] .teacher-audio-tools`);}
    function message(q,text){const target=box(q)?.querySelector('[data-teacher-audio-status]');if(target)target.textContent=text;}
    function clear(q){const take=pending.get(q);if(take)URL.revokeObjectURL(take.url);pending.delete(q);}
    function refresh(){
        for(const q of quiz.questions){
            const take=pending.get(q),player=box(q)?.querySelector('[data-teacher-audio-preview]');
            if(take && player){
                if(player.src!==take.url)player.src=take.url;
                // Type changes replace the question object; retain the pending
                // take until it has been uploaded or explicitly discarded.
                for(const button of box(q).closest('[data-index]').querySelectorAll('[data-action="change-type"],[data-action="undo-type"]'))button.disabled=true;
            }
        }
        $('duplicate').disabled ||= quiz.questions.some(q=>pending.has(q));
        if(capture){const stop=box(capture.q)?.querySelector('[data-teacher-audio-stop]');if(stop){stop.hidden=false;stop.disabled=false;}}
        for(const button of $('questions').querySelectorAll('[data-question-audio-load]'))button.disabled=busy;
    }
    async function normalize(blob,recorded=false){
        if(!blob.size || blob.size>50*1024*1024)throw Error('Choose an audio file up to 50 MB and 5 minutes.');
        const Audio=window.AudioContext || window.webkitAudioContext;
        if(!Audio)throw Error('Audio uploads are not supported in this browser. Try a current browser.');
        const context=new Audio();let decoded;
        try{decoded=await context.decodeAudioData(await blob.arrayBuffer());}
        catch(_){throw Error('This audio file could not be read. Try an MP3, M4A, WAV, OGG, or WebM audio file supported by your browser.');}
        finally{await context.close();}
        if(!recorded && decoded.duration*1000>settings.LIMIT_MS)throw Error('This recording is longer than 5 minutes. Choose a shorter recording.');
        // Encoder padding and delayed browser timers must never extend a take
        // beyond the limit. Uploaded files are rejected, never silently trimmed.
        const length=Math.min(Math.round(decoded.duration*settings.RATE),settings.LIMIT_MS/1000*settings.RATE);
        if(!length)throw Error('No audio was captured. Try recording again.');
        const offline=new OfflineAudioContext(1,length,settings.RATE),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
        const rendered=await offline.startRendering();return settings.encode(rendered.getChannelData(0));
    }
    async function attach(q,bytes){
        const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        clear(q);pending.set(q,{id,bytes,url:URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))});changed();render();await upload(q);
    }
    async function upload(q){
        const take=pending.get(q);if(!take)return;
        try{
            let result;
            for(let start=0,part=0;start<take.bytes.length;start+=settings.PART_BYTES,part++){
                message(q,`Uploading recording (${part+1} of ${Math.ceil(take.bytes.length/settings.PART_BYTES)})…`);
                const slice=take.bytes.subarray(start,start+settings.PART_BYTES);
                let binary='';for(let at=0;at<slice.length;at+=32768)binary+=String.fromCharCode(...slice.subarray(at,at+32768));
                result=await api('question-audio-save',{audioId:take.id,part,totalBytes:take.bytes.length,audio:btoa(binary)});
                if(start+settings.PART_BYTES<take.bytes.length && (!result.partSaved || result.part!==part))throw Error('This recording part was not saved. Retry uploading it.');
            }
            if(!result.saved || !settings.valid(result.teacherAudio) || result.teacherAudio.id!==take.id)throw Error('The recording upload did not finish. Retry uploading it.');
            q.teacherAudio=result.teacherAudio;clear(q);changed();render();message(q,'Recording attached. Save your draft to keep it with this question.');
        }catch(error){render();message(q,error.message+' Your new recording is still here to listen to and retry. Any previous recording is unchanged.');throw error;}
    }
    async function record(q){
        if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)throw Error('Microphone recording is not supported in this browser. Upload an audio file instead.');
        for(const audio of document.querySelectorAll('audio'))audio.pause();
        let stream,recorder,timer,tick;
        try{
            message(q,'Allow microphone access to begin recording…');
            stream=await navigator.mediaDevices.getUserMedia({audio:true});
            const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
            recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});
            const chunks=[],started=Date.now();
            const stopped=new Promise((resolve,reject)=>{
                recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
                recorder.onerror=()=>reject(Error('The microphone recording stopped unexpectedly. Try again.'));
                recorder.onstop=()=>resolve(new Blob(chunks,{type:chunks[0]?.type || mime || 'audio/webm'}));
            });
            capture={q,stop:()=>{if(recorder.state!=='inactive')recorder.stop();}};
            recorder.start(1000);refresh();
            const update=()=>{const elapsed=Date.now()-started;message(q,'Recording '+settings.label(Math.min(elapsed,settings.LIMIT_MS))+' / 5:00');if(elapsed>=settings.LIMIT_MS)capture?.stop();};
            update();tick=setInterval(update,250);timer=setTimeout(()=>capture?.stop(),settings.LIMIT_MS);
            const blob=await stopped;
            clearTimeout(timer);clearInterval(tick);stream.getTracks().forEach(track=>track.stop());capture=null;box(q).querySelector('[data-teacher-audio-stop]').hidden=true;
            message(q,'Preparing your recording…');await attach(q,await normalize(blob,true));
        }catch(error){if(error.name==='NotAllowedError')throw Error('Microphone access was denied. Allow access and try again, or upload an audio file.');throw error;}
        finally{clearTimeout(timer);clearInterval(tick);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(track=>track.stop());capture=null;const stop=box(q)?.querySelector('[data-teacher-audio-stop]');if(stop)stop.hidden=true;}
    }
    function ready(){if(capture || quiz.questions.some(q=>pending.has(q)))throw Error('Finish uploading or discard the unsaved teacher recording before saving or previewing.');}
    async function act(q,task){await run(async()=>{try{await task();}catch(error){if(!pending.has(q))message(q,error.message);throw error;}});}
    function bind(){
        settings.bind($('questions'),record=>api(record.action,record));
        $('questions').addEventListener('change',event=>{
            if(!event.target.matches('[data-teacher-audio-file]') || busy || quiz.published)return;
            const file=event.target.files[0],q=quiz.questions[Number(event.target.closest('[data-index]').dataset.index)];event.target.value='';if(!file)return;
            act(q,async()=>{message(q,'Reading audio file…');await attach(q,await normalize(file));});
        });
        $('questions').addEventListener('click',event=>{
            const button=event.target.closest('button');if(!button)return;
            if(button.hasAttribute('data-teacher-audio-stop')){capture?.stop();return;}
            if(busy || quiz.published)return;
            const article=button.closest('[data-index]');if(!article)return;const q=quiz.questions[Number(article.dataset.index)];
            if(button.hasAttribute('data-teacher-audio-record'))act(q,()=>record(q));
            if(button.hasAttribute('data-teacher-audio-retry'))act(q,()=>upload(q));
            if(button.hasAttribute('data-teacher-audio-discard')){clear(q);changed();render();}
            if(button.hasAttribute('data-teacher-audio-remove')){delete q.teacherAudio;changed();render();}
        });
        window.addEventListener('beforeunload',event=>{if(capture || busy){event.preventDefault();event.returnValue='';}});
        window.addEventListener('pagehide',()=>capture?.stop());
    }
    return {render:renderTools,refresh,ready,bind};
})();

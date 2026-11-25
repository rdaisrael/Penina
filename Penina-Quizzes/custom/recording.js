'use strict';
// Recordings use small answer references; audio is kept out of quiz JSON/localStorage.
const QuizRecording=(()=>{
    const settings=QuizRecordingSettings,MAX_BYTES=settings.MAX_BYTES;
    const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const validReference=value=>/^recording:[a-f0-9]{32}$/.test(value);
    const validAudio=value=>!!settings.parseAudio(value);
    const content=q=>q.type==='recording' && q.content?`<div class="recording-content" dir="${q.direction==='rtl'?'rtl':'ltr'}">${esc(q.content)}</div>`:'';
    function player(index,reference,id='',deleted=false){
        if(deleted)return '<p class="recording-deleted">Recording deleted. Saved grades and feedback are retained.</p>';
        return validReference(reference)?`<div class="recording-player" data-recording-index="${index}" data-reference="${esc(reference)}" data-submission-id="${esc(id)}"><button type="button" data-recording-play>Load recording</button><audio controls preload="none" aria-label="Recorded answer for question ${index+1}" hidden></audio><a data-recording-download hidden>Download recording</a><p data-playback-status role="status"></p></div>`:'<p>No recording.</p>';
    }
    function controls(index,question={}){
        return `<div class="recording-controls" data-recorder="${index}" data-recording-minutes="${esc(settings.minutes(question))}"><input type="hidden" name="q${index}-0"><p>Record your answer, then listen to check it. You can record again before locking or submitting. Maximum: ${esc(settings.label(question))}.</p><div class="recording-actions"><button type="button" data-recording-start>Record answer</button><button type="button" data-recording-stop hidden>Stop recording</button><button type="button" data-recording-retry hidden>Retry saving recording</button><button type="button" data-recording-previous hidden>Use previous saved recording</button></div><p data-recording-status role="status" aria-live="polite">Ready to record.</p><div data-recording-preview></div></div>`;
    }
    async function loadRecording(request,record){
        const value=await request(record);
        if(!value.chunked)return value;
        if(!Number.isInteger(value.totalBytes) || value.totalBytes<=settings.UPLOAD_BYTES || value.totalBytes>MAX_BYTES || value.totalParts!==Math.ceil(value.totalBytes/settings.PART_BYTES))throw Error('This recording could not be loaded.');
        const pieces=[];
        for(let part=0;part<value.totalParts;part++){
            const piece=await request({...record,part});
            const parsed=settings.parseAudio(piece.audio);
            if(!parsed || piece.part!==part || piece.totalParts!==value.totalParts || piece.totalBytes!==value.totalBytes || piece.durationMs!==value.durationMs || parsed.header!==value.header)throw Error('This recording part could not be loaded.');
            pieces.push(parsed.encoded);
        }
        const encoded=pieces.join(''),bytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
        if(bytes!==value.totalBytes)throw Error('This recording is incomplete. Try loading it again.');
        return {audio:value.header+','+encoded,durationMs:value.durationMs};
    }
    // Only stopped, unsaved recordings need durable browser storage. Successful
    // uploads can be restored through the authenticated API on another device.
    let database;
    function db(){
        if(!database)database=new Promise((resolve,reject)=>{
            const request=indexedDB.open('penina-quiz-recordings',1);
            request.onupgradeneeded=()=>request.result.createObjectStore('audio');
            request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(Error('Browser recording storage is unavailable.'));
        });
        return database;
    }
    async function cache(key,operation,value){
        const database=await db();
        return new Promise((resolve,reject)=>{
            const tx=database.transaction('audio',operation==='get'?'readonly':'readwrite'),store=tx.objectStore('audio');
            const request=operation==='get'?store.get(key):operation==='put'?store.put(value,key):store.delete(key);
            tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
    }
    function bindPlayback(root,load){
        root.addEventListener('click',async event=>{
            const button=event.target.closest('[data-recording-play]');if(!button || !root.contains(button))return;
            const container=button.closest('.recording-player'),message=container.querySelector('[data-playback-status]');
            button.disabled=true;message.textContent='Loading recording…';
            try{
                const result=await load(Number(container.dataset.recordingIndex),container.dataset.reference,container.dataset.submissionId,container);
                if(!validAudio(result.audio))throw Error('This recording could not be played.');
                const audio=container.querySelector('audio');audio.preload='auto';audio.src=result.audio;audio.hidden=false;button.hidden=true;message.textContent='';
                const mime=settings.parseAudio(result.audio).mime;
                const link=container.querySelector('[data-recording-download]');link.href=result.audio;link.download='recorded-answer.'+(mime==='audio/mp4'?'m4a':mime==='audio/ogg'?'ogg':'webm');link.hidden=false;
                audio.onerror=()=>{message.textContent='This browser could not play the recording. Download it to listen in an audio player.';};
                audio.load();
                audio.focus();
            }catch(error){message.textContent=error.message+(error.status===410?'':' Try loading again.');if(error.status===410)button.hidden=true;}
            finally{button.disabled=false;}
        });
    }
    function bind({root,request,session,canEdit,changed}){
        const memory=new Map(),uploads=new Map(),errors=new Map(),previousSaved=new Map();
        let active=null,acquiring=false,finishing=null,reverting=false,closed=false;
        const box=index=>root.querySelector(`[data-recorder="${index}"]`);
        const field=index=>box(index).querySelector('input');
        const say=(index,message)=>{box(index).querySelector('[data-recording-status]').textContent=message;};
        const cacheKey=reference=>session().key+':'+session().id+':'+reference;
        async function local(reference){return memory.get(reference) || await cache(cacheKey(reference),'get').catch(()=>null);}
        async function discard(reference){memory.delete(reference);await cache(cacheKey(reference),'delete').catch(()=>{});}
        async function savedBefore(reference){
            if(!validReference(reference))return '';
            const value=await local(reference);
            return value && !value.uploaded && !session().preview?(validReference(value.previous)?value.previous:''):reference;
        }
        async function load(index,reference){
            const value=await local(reference);if(value)return value;
            if(session().preview)throw Error('This preview recording is no longer available. Record it again.');
            return loadRecording(request,{action:'recording-load',id:session().id,token:session().token,index,reference});
        }
        bindPlayback(root,load);
        function refresh(){
            for(const container of root.querySelectorAll('[data-recorder]')){
                const index=Number(container.dataset.recorder),reference=field(index).value,start=container.querySelector('[data-recording-start]'),stop=container.querySelector('[data-recording-stop]');
                const recording=active?.index===index;
                start.textContent=reference?'Record again':'Record answer';start.hidden=recording;
                const busy=!!active || acquiring || !!finishing || reverting || uploads.size>0;
                start.disabled=!canEdit(index) || busy;
                stop.hidden=!recording;stop.disabled=false;
                const previous=container.querySelector('[data-recording-previous]');
                previous.hidden=!previousSaved.has(index);previous.disabled=!canEdit(index) || busy;
                container.querySelector('[data-recording-retry]').disabled=busy;
                const preview=container.querySelector('[data-recording-preview]');
                if(preview.dataset.reference!==reference){preview.innerHTML=reference?player(index,reference):'';preview.dataset.reference=reference;}
            }
        }
        async function save(index,reference){
            if(uploads.has(reference))return uploads.get(reference);
            const job=(async()=>{
                const value=await local(reference);
                if(!value || value.uploaded)return;
                say(index,session().preview?'Recording saved in this browser for preview.':'Saving recording…');
                if(!session().preview){
                    for(const piece of settings.uploads(value.audio,value.durationMs)){
                        if(piece.totalParts)say(index,'Saving recording… '+Math.round(piece.part/piece.totalParts*100)+'%');
                        const result=await request({action:'recording-save',id:session().id,token:session().token,index,reference,...piece});
                        const final=piece.part===undefined || piece.part===piece.totalParts-1;
                        if(final?!result.saved:!result.partSaved || result.part!==piece.part)throw Error('The recording was not saved. Try again.');
                    }
                    value.uploaded=true;memory.set(reference,value);await cache(cacheKey(reference),'delete').catch(()=>{});
                }
                errors.delete(index);
                previousSaved.delete(index);
                if(value.previous){await discard(value.previous);delete value.previous;}
                say(index,session().preview?'Preview recording ready. Listen below.':'Recording saved. Listen below or record again.');
                box(index).querySelector('[data-recording-retry]').hidden=true;
            })();
            uploads.set(reference,job);refresh();
            try{await job;}
            catch(error){say(index,error.message+(previousSaved.has(index)?' Your previous saved recording is still available. Retry saving, or choose Use previous saved recording.':' Keep this page open, or retry saving before continuing.'));box(index).querySelector('[data-recording-retry]').hidden=false;throw error;}
            finally{uploads.delete(reference);refresh();}
        }
        async function finish(recording){
            clearInterval(recording.timer);recording.stream.getTracks().forEach(track=>track.stop());
            active=null;
            const previous=field(recording.index).value,fallback=await savedBefore(previous);
            if(fallback)previousSaved.set(recording.index,fallback);
            // Chunks carry the actual format even if the recorder resets its
            // MIME label on stop. Store just the supported container name.
            const mime=recording.chunks.map(chunk=>settings.audioMime(chunk.type)).find(Boolean) || settings.audioMime(recording.recorder.mimeType) || settings.audioMime(recording.mimeType);
            const data=new Blob(recording.chunks,{type:mime || ''});
            if(recording.error || !mime || !data.size || data.size>MAX_BYTES){
                const error=recording.error || Error(!mime?'This recording has an unsupported audio format. Record again.':'The recording is empty or too large. Record a shorter answer.');
                errors.set(recording.index,error);say(recording.index,error.message+(fallback?' You can use your previous saved recording.':''));throw error;
            }
            let audio;
            try{audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('The recording could not be read. Record again.'));reader.readAsDataURL(data);});}
            catch(error){errors.set(recording.index,error);say(recording.index,error.message+(fallback?' You can use your previous saved recording.':''));throw error;}
            const reference='recording:'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
            const value={audio,durationMs:Math.min(recording.limitMs,Math.max(1,recording.stopped-recording.started)),...(fallback?{previous:fallback}:{})};
            memory.set(reference,value);
            let cached=true;await cache(cacheKey(reference),'put',value).catch(()=>{cached=false;});
            field(recording.index).value=reference;errors.delete(recording.index);changed();refresh();
            // Keep the last saved take and its reference until the replacement
            // uploads. Repeated failed redos must not overwrite that fallback.
            if(cached && previous && previous!==fallback)await discard(previous);
            try{await save(recording.index,reference);}
            catch(error){if(!cached)say(recording.index,'Recording is only on this page. Keep it open and retry saving. '+error.message);throw error;}
            if(previous && previous!==fallback)await discard(previous);
        }
        async function usePrevious(index){
            const reference=previousSaved.get(index);
            if(!reference || !canEdit(index) || active || acquiring || finishing || reverting || uploads.size)return;
            reverting=true;refresh();
            try{
                const value=await load(index,reference);
                if(!validAudio(value.audio))throw Error('The previous recording could not be loaded.');
                const replaced=field(index).value;
                field(index).value=reference;errors.delete(index);previousSaved.delete(index);changed();
                if(replaced!==reference)await discard(replaced);
                box(index).querySelector('[data-recording-retry]').hidden=true;
                say(index,'Using your previous saved recording. Listen below or continue.');
            }catch(error){say(index,error.message+' Your new recording has been kept.');}
            finally{reverting=false;refresh();}
        }
        async function stop(){
            if(active){const recording=active;if(recording.recorder.state!=='inactive')recording.recorder.stop();return recording.done;}
            if(finishing)return finishing;
        }
        async function start(index){
            if(!canEdit(index) || active || acquiring || finishing || reverting || uploads.size)return;
            if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined'){say(index,'Audio recording is unavailable. Open this quiz in a browser with microphone recording support.');return;}
            if(field(index).value && !confirm('Record a new answer? Your last saved recording will stay available if the new one cannot be saved.'))return;
            acquiring=true;refresh();say(index,'Allow microphone access to begin recording.');
            let stream;
            try{
                stream=await navigator.mediaDevices.getUserMedia({audio:true});
                if(closed || !canEdit(index)) {stream.getTracks().forEach(track=>track.stop());return;}
                const mimeType=['audio/mp4;codecs=mp4a.40.2','audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
                if(!mimeType)throw Error('This browser cannot record a supported audio format. Try another browser.');
                const minutes=Number(box(index).dataset.recordingMinutes),limitMs=minutes*60000;
                if(!settings.validStoredMinutes(minutes))throw Error('This question has an invalid recording time limit. Reload the quiz.');
                const recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:48000}),recording={index,stream,recorder,mimeType,chunks:[],started:Date.now(),size:0,limitMs};
                let resolveDone;recording.done=new Promise(resolve=>{resolveDone=resolve;});
                recorder.ondataavailable=event=>{if(event.data.size){recording.chunks.push(event.data);recording.size+=event.data.size;if(recording.size>MAX_BYTES && recorder.state!=='inactive')recorder.stop();}};
                recorder.onerror=()=>{recording.error=Error('Microphone recording was interrupted. Record your answer again.');if(recorder.state!=='inactive')recorder.stop();};
                recorder.onstop=()=>{
                    recording.stopped=Date.now();
                    finishing=finish(recording).then(()=>null,error=>error).finally(()=>{finishing=null;refresh();});
                    finishing.then(resolveDone);
                };
                stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(recorder.state!=='inactive')recorder.stop();}));
                root.querySelectorAll('audio').forEach(audio=>audio.pause());
                recorder.start(1000);active=recording;errors.delete(index);
                const update=()=>{const elapsed=Math.min(limitMs,Date.now()-recording.started);say(index,'Recording · '+Math.floor(elapsed/60000)+':'+String(Math.floor(elapsed/1000)%60).padStart(2,'0')+' / '+minutes+':00');if(elapsed>=limitMs && recorder.state!=='inactive')recorder.stop();};
                update();recording.timer=setInterval(update,250);
            }catch(error){stream?.getTracks().forEach(track=>track.stop());say(index,error.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser settings, then choose Record answer.':error.name==='NotFoundError'?'No microphone was found. Connect a microphone and try again.':error.message);}
            finally{acquiring=false;refresh();}
        }
        async function flush(){
            if(reverting)throw Error('Wait for your previous recording to load before continuing.');
            // An unanswered permission prompt must not hang a timed submission.
            if(acquiring && !session().expired)throw Error('Allow or dismiss the microphone request before continuing.');
            const failure=await stop();if(failure && !(session().expired && [...errors.values()].includes(failure)))throw failure;
            for(const container of root.querySelectorAll('[data-recorder]')){
                const index=Number(container.dataset.recorder),reference=field(index).value;
                if(errors.has(index) && !session().expired)throw errors.get(index);
                if(reference)await save(index,reference);
            }
            changed();refresh();
        }
        root.addEventListener('click',event=>{
            const container=event.target.closest('[data-recorder]');if(!container)return;
            const index=Number(container.dataset.recorder);
            if(event.target.closest('[data-recording-start]'))start(index);
            if(event.target.closest('[data-recording-stop]'))stop();
            if(event.target.closest('[data-recording-retry]'))save(index,field(index).value).catch(()=>{});
            if(event.target.closest('[data-recording-previous]'))usePrevious(index);
        });
        window.addEventListener('beforeunload',event=>{if(active || acquiring || finishing || uploads.size || [...memory.values()].some(v=>!v.uploaded && !session().preview)){event.preventDefault();event.returnValue='';}});
        window.addEventListener('pagehide',()=>{closed=true;active?.stream.getTracks().forEach(track=>track.stop());});
        window.addEventListener('pageshow',()=>{closed=false;});
        refresh();
        for(const container of root.querySelectorAll('[data-recorder]')){
            const index=Number(container.dataset.recorder),reference=field(index).value;
            if(reference)local(reference).then(value=>{
                if(value && !value.uploaded && !session().preview && field(index).value===reference){
                    if(validReference(value.previous))previousSaved.set(index,value.previous);
                    say(index,'Recording recovered in this browser. '+(previousSaved.has(index)?'Retry saving, or choose Use previous saved recording.':'Retry saving before continuing.'));
                    container.querySelector('[data-recording-retry]').hidden=false;refresh();
                }
            });
        }
        return {flush,refresh,load};
    }
    return {controls,content,player,bind,bindPlayback,loadRecording};
})();

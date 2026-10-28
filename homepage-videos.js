'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const API = '/videos/manage';
    let generation = 0, active = null, totalBytes = 0, maximum = 1024 ** 3;
    const sizeText = bytes => bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(1) + ' MB';
    function hide() {
        generation++;
        active?.controller.abort();
        $('video-manager').hidden = true;
        $('video-list').replaceChildren();
        $('video-upload-form').reset();
        $('video-status').textContent = '';
        $('video-storage').textContent = '';
        $('video-progress').hidden = true;
        $('video-cancel').hidden = true;
    }
    async function request(options = {}, query = '') {
        const response = await fetch(API + query, {cache:'no-store',credentials:'same-origin',...options});
        if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Video uploads are awaiting connection to storage.');
        const data = await response.json();
        if (!response.ok) throw Object.assign(Error(data.error || 'The video request failed.'), {status:response.status});
        return data;
    }
    const post = (body, signal) => request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    function row(video) {
        const item = document.createElement('li');
        const title = document.createElement('h3'); title.textContent = video.title;
        const details = document.createElement('p'); details.textContent = sizeText(video.size);
        const address = document.createElement('input'); address.type = 'text'; address.readOnly = true;
        address.value = video.url || new URL(video.path,location.origin).href;
        address.setAttribute('aria-label','Standalone viewer URL for ' + video.title);
        address.onclick = () => address.select();
        const urlRow = document.createElement('div'); urlRow.className = 'video-url';
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-url';
        copy.setAttribute('aria-label','Copy viewer URL for Classroom: ' + video.title);
        copy.title = 'Copy viewer URL for Classroom';
        const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
        icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true');
        const paper = document.createElementNS('http://www.w3.org/2000/svg','rect');
        paper.setAttribute('x','5'); paper.setAttribute('y','5'); paper.setAttribute('width','14'); paper.setAttribute('height','16'); paper.setAttribute('rx','2');
        const tab = document.createElementNS('http://www.w3.org/2000/svg','path');
        tab.setAttribute('d','M9 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1');
        const lines = document.createElementNS('http://www.w3.org/2000/svg','path');
        lines.setAttribute('d','M9 11h6M9 15h6');
        icon.append(paper,tab,lines); copy.append(icon);
        urlRow.append(address,copy);
        const open = document.createElement('a'); open.href = address.value; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Preview viewer page';
        copy.onclick = async () => {
            let copied = false;
            try { await navigator.clipboard.writeText(address.value); copied = true; } catch (_) {}
            if (!copied) {
                address.focus(); address.select();
                try { copied = document.execCommand('copy'); } catch (_) {}
            }
            $('video-status').textContent = copied ? 'Viewer URL copied for Google Classroom.' : 'Copy was blocked. The viewer URL is selected so you can copy it.';
        };
        item.append(title,details,urlRow,open);
        return item;
    }
    async function refresh(token = generation) {
        const data = await request();
        if (token !== generation) return;
        maximum = data.maxFileBytes;
        totalBytes = data.totalBytes;
        $('video-list').replaceChildren(...data.videos.map(row));
        $('video-storage').textContent = `${data.videos.length} video${data.videos.length === 1 ? '' : 's'} · ${sizeText(totalBytes)} stored. The free storage allowance is 10 GB; additional storage may be billed.`;
        $('video-empty').hidden = data.videos.length !== 0;
        $('video-upload-fields').disabled = false;
    }
    async function show(user) {
        hide();
        if (user?.userId !== 1 || user.email?.toLowerCase() !== 'disrael@saracademy.org') return;
        const token = generation;
        $('video-manager').hidden = false;
        $('video-upload-fields').disabled = true;
        $('video-status').textContent = 'Loading videos…';
        try { await refresh(token); if (token === generation) $('video-status').textContent = ''; }
        catch (error) { if (token === generation) { if ([401,403].includes(error.status)) hide(); else $('video-status').textContent = error.message; } }
    }
    $('video-refresh').onclick = async () => {
        if (active) return;
        const token = generation;
        try { await refresh(token); if (token === generation) $('video-status').textContent = ''; }
        catch (error) { if (token === generation) $('video-status').textContent = error.message; }
    };
    $('video-file').onchange = () => {
        const file = $('video-file').files[0];
        if (file && !$('video-title').value.trim()) $('video-title').value = file.name.replace(/\.mp4$/i,'').slice(0,120);
    };
    $('video-cancel').onclick = () => active?.controller.abort();
    async function retry(operation,signal) {
        for (let attempt=0; ; attempt++) {
            try { return await operation(); }
            catch (error) {
                if (signal.aborted || attempt === 2 || (error.status && error.status < 500)) throw error;
            }
        }
    }
    $('video-upload-form').onsubmit = async event => {
        event.preventDefault();
        if (active) return;
        const file = $('video-file').files[0], title = $('video-title').value.trim();
        if (!file || !/\.mp4$/i.test(file.name) || file.size > maximum || !title) { $('video-status').textContent = 'Choose an MP4 video up to 1 GB and enter its title.'; return; }
        if (totalBytes + file.size > 9.5e9 && !window.confirm('This upload would bring your videos close to or above the 10 GB free allowance. Additional storage may be billed. Continue?')) return;
        const token = generation, controller = new AbortController();
        const job = {controller}; active = job;
        $('video-upload-fields').disabled = true;
        $('video-progress').hidden = false; $('video-progress').value = 0;
        $('video-cancel').hidden = false;
        $('video-status').textContent = 'Starting upload…';
        let id, completed = false;
        try {
            const started = await post({action:'start',title,size:file.size},controller.signal);
            id = started.id;
            const parts = [];
            for (let offset=0; offset < file.size; offset += started.chunkSize) {
                const end = Math.min(file.size,offset+started.chunkSize), part = parts.length+1;
                parts.push(await retry(()=>request({method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file.slice(offset,end),signal:controller.signal},`?id=${id}&part=${part}`),controller.signal));
                if (token !== generation) throw Error('Upload cancelled.');
                const percent = Math.round(end / file.size * 100);
                $('video-progress').value = percent;
                $('video-status').textContent = `Uploading ${title}… ${percent}%`;
            }
            $('video-status').textContent = 'Finishing upload…';
            $('video-cancel').hidden = true;
            // Completion is retriable if the response is lost. Do not abort it on a cancel after submission.
            await retry(()=>post({action:'complete',id,parts}),controller.signal);
            completed = true;
            if (token !== generation) return;
            $('video-upload-form').reset();
            await refresh(token);
            if (token === generation) $('video-status').textContent = 'Video uploaded. Its viewer URL is below and the video is now listed in the public library.';
        } catch (error) {
            if (id && !completed) { try { await post({action:'abort',id}); } catch (_) {} }
            if (token === generation) $('video-status').textContent = controller.signal.aborted ? 'Upload cancelled.' : (completed ? 'Video uploaded, but the list could not refresh. Choose Refresh videos.' : error.message);
        } finally {
            if (active === job) active = null;
            if (token === generation) { $('video-upload-fields').disabled = false; $('video-cancel').hidden = true; $('video-progress').hidden = true; }
        }
    };
    window.PeninaVideos = {show,hide};
})();

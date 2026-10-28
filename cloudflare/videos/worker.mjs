const ORIGIN = 'https://www.penina-hebrew.org';
const VIDEO_ORIGIN = 'https://video.penina-hebrew.org';
const OWNER = 'disrael@saracademy.org';
const CHUNK = 8 * 1024 * 1024;
const MAX_BYTES = 1024 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;
const keyFor = id => `videos/${id}.mp4`;
const pendingKey = id => `uploads/${id}.json`;
const videoExtensions = new Set(['mp4','m4v','mov','webm','mkv','avi','mpg','mpeg','3gp']);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const keyToken = key => {
    const bytes = new TextEncoder().encode(key);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
function tokenKey(token) {
    if (!/^[a-zA-Z0-9_-]+$/.test(token || '')) fail(404,'Video not found.');
    try {
        const binary = atob(token.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-token.length%4)%4));
        return new TextDecoder().decode(Uint8Array.from(binary,char=>char.charCodeAt(0)));
    } catch (_) { fail(404,'Video not found.'); }
}
function isVideoKey(key) {
    if (typeof key !== 'string' || key.length > 1024 || key.startsWith('uploads/')) return false;
    const managed = /^videos\/[a-f0-9]{32}\.mp4$/i.test(key);
    if (managed) return true;
    if (key.includes('/') || key.startsWith('.')) return false;
    const extension = key.split('.').pop()?.toLowerCase();
    return videoExtensions.has(extension);
}
const typeFor = key => ({mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mpg:'video/mpeg',mpeg:'video/mpeg','3gp':'video/3gpp'})[key.split('.').pop()?.toLowerCase()] || 'application/octet-stream';

async function owner(request, authFetch) {
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('__Host-penina-quiz-session=')) fail(401, 'Sign in to Penina to manage videos.');
    // Verify the existing signed session at the existing server. No shared signing key in the browser/Worker.
    const response = await authFetch(`${ORIGIN}/api/game-scores?game=quiz-account&action=teacher`, {
        headers:{Cookie:cookie}, redirect:'error', cache:'no-store', signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) fail(response.status === 401 ? 401 : 403, 'Sign in as David Israel to manage videos.');
    const user = await response.json();
    if (user.userId !== 1 || user.email?.toLowerCase() !== OWNER) fail(403, 'Only David Israel can manage videos.');
}
async function readLimited(request, maximum) {
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = []; let size = 0;
    while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maximum) { await reader.cancel(); fail(413, 'The upload is too large.'); }
        chunks.push(value);
    }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; }
    return result;
}
async function readJSON(request) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Send JSON for this action.');
    try { return JSON.parse(new TextDecoder().decode(await readLimited(request,65536))); }
    catch (error) { if (error.status) throw error; fail(400,'The request was not valid.'); }
}
async function pending(bucket, id) {
    if (!ID.test(id || '')) fail(400, 'Choose a valid upload.');
    const object = await bucket.get(pendingKey(id));
    if (!object) fail(404, 'This upload is no longer available. Start again.');
    return object.json();
}
async function listing(bucket) {
    let cursor, totalBytes = 0; const videos = [];
    do {
        const page = await bucket.list({prefix:'',limit:1000,include:['customMetadata','httpMetadata'],...(cursor?{cursor}:{})});
        for (const object of page.objects) {
            const key = object.key;
            if (!isVideoKey(key)) continue;
            const filename = key.split('/').pop();
            const title = object.customMetadata?.title || filename.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ');
            const token = keyToken(key);
            totalBytes += object.size;
            videos.push({id:key.startsWith('videos/')?key.slice(7,-4):token,token,title,size:object.size,uploadedAt:object.uploaded.toISOString(),url:`${VIDEO_ORIGIN}/watch/${token}`,mediaUrl:`${VIDEO_ORIGIN}/_media/${token}`});
        }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    videos.sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt));
    return {videos,totalBytes,maxFileBytes:MAX_BYTES};
}
async function manage(request, env, url, authFetch) {
    await owner(request, authFetch);
    const bucket = env.VIDEOS;
    if (!bucket) fail(503, 'Video storage is not connected yet.');
    if (request.method === 'GET') return json(await listing(bucket));
    if (request.headers.get('Origin') !== ORIGIN) fail(403, 'Open the video manager on Penina.');
    if (request.method === 'PUT') {
        const id = url.searchParams.get('id'), partNumber = Number(url.searchParams.get('part'));
        const session = await pending(bucket,id);
        if (session.expiresAt < Date.now()) fail(410, 'This upload expired. Start again.');
        const count = Math.ceil(session.size / CHUNK);
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) fail(400, 'Invalid upload part.');
        const expected = Math.min(CHUNK,session.size - (partNumber - 1) * CHUNK);
        const bytes = await readLimited(request,expected);
        if (bytes.length !== expected) fail(400, 'The upload part was incomplete. Please retry.');
        if (partNumber === 1 && (bytes.length < 12 || new TextDecoder().decode(bytes.slice(4,8)) !== 'ftyp')) fail(415, 'Choose an MP4 video file.');
        const upload = bucket.resumeMultipartUpload(keyFor(id),session.uploadId);
        return json(await upload.uploadPart(partNumber,bytes));
    }
    if (request.method !== 'POST') return new Response(null,{status:405,headers:{Allow:'GET, POST, PUT','Cache-Control':'no-store'}});
    const body = await readJSON(request);
    if (body.action === 'start') {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 120 || /[\x00-\x1f]/.test(title)) fail(400, 'Enter a video title of up to 120 characters.');
        if (!Number.isSafeInteger(body.size) || body.size < 12 || body.size > MAX_BYTES) fail(400, 'Choose an MP4 video up to 1 GB.');
        const id = crypto.randomUUID().replaceAll('-','');
        const upload = await bucket.createMultipartUpload(keyFor(id),{httpMetadata:{contentType:'video/mp4'},customMetadata:{title}});
        try { await bucket.put(pendingKey(id),JSON.stringify({uploadId:upload.uploadId,size:body.size,expiresAt:Date.now()+86400000})); }
        catch (error) { await upload.abort(); throw error; }
        return json({id,chunkSize:CHUNK},201);
    }
    if (!ID.test(body.id || '')) fail(400, 'Choose a valid upload.');
    if (!['complete','abort'].includes(body.action)) fail(400,'Choose an available video action.');
    // Retrying completion after a lost response must return the same finished video.
    if (body.action === 'complete' && await bucket.head(keyFor(body.id))) {
        await bucket.delete(pendingKey(body.id));
        return json({path:`/videos/${body.id}`});
    }
    const session = await pending(bucket,body.id);
    const upload = bucket.resumeMultipartUpload(keyFor(body.id),session.uploadId);
    if (body.action === 'abort') {
        await upload.abort(); await bucket.delete(pendingKey(body.id)); return json({aborted:true});
    }
    if (session.expiresAt < Date.now()) fail(410, 'This upload expired. Start again.');
    const count = Math.ceil(session.size / CHUNK);
    if (!Array.isArray(body.parts) || body.parts.length !== count || body.parts.some((part,i)=>part.partNumber !== i+1 || typeof part.etag !== 'string' || !part.etag || part.etag.length > 256)) fail(400, 'The upload is missing parts. Start again.');
    const object = await upload.complete(body.parts);
    if (object.size !== session.size) { await bucket.delete(keyFor(body.id)); await bucket.delete(pendingKey(body.id)); fail(400,'The uploaded size did not match. Please try again.'); }
    await bucket.delete(pendingKey(body.id));
    return json({path:`/videos/${body.id}`},201);
}
function rangeFor(value,size) {
    if (!value) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) fail(416,'Invalid byte range.');
    let start, end;
    if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) fail(416,'Invalid byte range.'); start = Math.max(0,size-suffix); end = size-1; }
    else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]),size-1) : size-1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) fail(416,'Invalid byte range.');
    return {offset:start,length:end-start+1};
}
async function playback(request,env,key) {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    if (!isVideoKey(key)) fail(404,'Video not found.');
    if (!env.VIDEOS) fail(503,'Video storage is not connected yet.');
    const metadata = await env.VIDEOS.head(key);
    if (!metadata) fail(404,'Video not found.');
    const headers = new Headers({'Content-Type':metadata.httpMetadata?.contentType || typeFor(key),'Accept-Ranges':'bytes','ETag':metadata.httpEtag,'Last-Modified':metadata.uploaded.toUTCString(),'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow'});
    if (request.headers.get('If-None-Match') === metadata.httpEtag) return new Response(null,{status:304,headers});
    let range = null;
    const ifRange = request.headers.get('If-Range');
    if (request.method !== 'HEAD' && (!ifRange || ifRange === metadata.httpEtag || ifRange === metadata.uploaded.toUTCString())) {
        try { range = rangeFor(request.headers.get('Range'),metadata.size); }
        catch (error) { if (error.status !== 416) throw error; headers.set('Content-Range',`bytes */${metadata.size}`); return new Response(null,{status:416,headers}); }
    }
    if (range) headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${metadata.size}`);
    headers.set('Content-Length',String(range?.length ?? metadata.size));
    const object = request.method === 'HEAD' ? null : await env.VIDEOS.get(key,range?{range}:{});
    if (request.method !== 'HEAD' && !object) fail(404,'Video not found.');
    return new Response(object?.body || null,{status:range?206:200,headers});
}
function htmlResponse(request,html,nonce) {
    const script = nonce ? `; script-src 'nonce-${nonce}' https://www.penina-hebrew.org` : '';
    const page=html.replace('</head>','<script defer src="https://www.penina-hebrew.org/session-idle.js"></script><script defer src="https://www.penina-hebrew.org/return-to-penina.js"></script></head>');
    return new Response(request.method === 'HEAD' ? null : page,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; media-src 'self'; style-src 'unsafe-inline'${script}; img-src https://www.penina-hebrew.org; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
async function catalog(request,env) {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    if (!env.VIDEOS) fail(503,'Video storage is not connected yet.');
    const {videos} = await listing(env.VIDEOS);
    const nonce = crypto.randomUUID().replaceAll('-','');
    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="16" rx="2"></rect><path d="M9 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M9 11h6M9 15h6"></path></svg>';
    const cards = videos.map(video=>`<article class="video"><h2><a href="/watch/${video.token}">${escape(video.title)}</a></h2><div class="url-row"><a class="address" href="${video.url}">${video.url}</a><button class="copy-url" type="button" data-copy-url="${video.url}" data-copy-label="Copy viewer URL for Classroom: ${escape(video.title)}" aria-label="Copy viewer URL for Classroom: ${escape(video.title)}" title="Copy URL for Classroom">${copyIcon}</button></div><p class="meta">${escape(new Date(video.uploadedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))} · ${(video.size/1e6).toFixed(1)} MB</p></article>`).join('');
    const script = `<script nonce="${nonce}">document.addEventListener('click',async event=>{const button=event.target.closest('[data-copy-url]');if(!button)return;let copied=false;try{await navigator.clipboard.writeText(button.dataset.copyUrl);copied=true;}catch(_){const field=document.createElement('textarea');field.value=button.dataset.copyUrl;field.style.cssText='position:fixed;opacity:0';document.body.append(field);field.select();try{copied=document.execCommand('copy');}catch(_){}field.remove();}button.title=copied?'Copied':'Copy URL for Classroom';button.setAttribute('aria-label',copied?'Copied viewer URL for Classroom':button.dataset.copyLabel);if(copied){button.dataset.copied='true';setTimeout(()=>{button.removeAttribute('data-copied');button.title='Copy URL for Classroom';button.setAttribute('aria-label',button.dataset.copyLabel);},1500);}});</script>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://www.penina-hebrew.org/Penina-favicon.png?v=4"><title>Penina Video Library</title><style>:root{color-scheme:light;--ink:#20242b;--muted:#687080;--line:#d9dee7;--accent:#4353ff;--paper:#fff;--bg:#f7f6f3}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--ink);background:radial-gradient(circle at top left,rgba(67,83,255,.13),transparent 34rem),linear-gradient(180deg,#fbfaf8,var(--bg));font:17px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}main{width:min(980px,calc(100% - 32px));margin:0 auto;padding:48px 0 70px}.eyebrow{margin:0 0 12px;color:var(--accent);font-size:13px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:clamp(34px,6vw,64px);line-height:1.02;letter-spacing:-.045em}.intro{max-width:680px;margin:16px 0 30px;color:var(--muted);font-size:18px}.videos{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}.video{min-width:0;padding:20px;border:1px solid var(--line);border-radius:20px;background:var(--paper);box-shadow:0 12px 34px rgba(21,28,43,.08)}h2{margin:0 0 14px;font-size:22px;line-height:1.25}.video h2 a{color:inherit;text-decoration:none}.video h2 a:hover{color:var(--accent)}.url-row{display:flex;align-items:center;gap:8px}.address{display:block;flex:1;min-width:0;overflow-wrap:anywhere;color:var(--accent);font-size:14px;font-weight:700}.copy-url{display:grid;flex:0 0 44px;width:44px;height:44px;place-items:center;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--accent);cursor:pointer}.copy-url:hover{background:#f3f4ff}.copy-url[data-copied="true"]{color:#167647}.copy-url svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.meta{margin:12px 0 0;color:var(--muted);font-size:13px}.empty{padding:22px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.8);color:var(--muted);text-align:center}@media(max-width:600px){main{padding-top:30px}.intro{font-size:16px}.videos{grid-template-columns:1fr}}</style></head><body><main><p class="eyebrow">Penina</p><h1>Video Library</h1><p class="intro">Open a lesson to watch it with controls. Select the clipboard icon beside its viewer address to copy the URL for Google Classroom.</p>${videos.length?`<section class="videos" aria-label="Published videos">${cards}</section>`:'<p class="empty">No videos have been published yet.</p>'}</main>${script}</body></html>`;
    return htmlResponse(request,html,nonce);
}
async function viewer(request,env,key) {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    if (!isVideoKey(key)) fail(404,'Video not found.');
    if (!env.VIDEOS) fail(503,'Video storage is not connected yet.');
    const metadata=await env.VIDEOS.head(key);
    if (!metadata) fail(404,'Video not found.');
    const title=escape(metadata.customMetadata?.title || key.split('/').pop().replace(/\.[^.]+$/,'').replace(/[-_]+/g,' '));
    const token=keyToken(key),media=`/_media/${token}`,nonce=crypto.randomUUID().replaceAll('-','');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://www.penina-hebrew.org/Penina-favicon.png?v=4"><title>${title} · Penina Video</title><style>body{margin:0;min-height:100vh;background:radial-gradient(circle at top left,rgba(67,83,255,.13),transparent 34rem),linear-gradient(180deg,#fbfaf8,#f7f6f3);color:#20242b;font:17px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}main{width:min(1000px,calc(100% - 32px));margin:0 auto;padding:48px 0 70px}.eyebrow{margin:0 0 12px;color:#4353ff;font-size:13px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}h1{margin:0 0 24px;font-size:clamp(30px,5vw,52px);line-height:1.08;overflow-wrap:anywhere}.panel{padding:12px;border:1px solid #d9dee7;border-radius:20px;background:#fff;box-shadow:0 12px 34px rgba(21,28,43,.08)}video{display:block;width:100%;max-height:75vh;aspect-ratio:16/9;border-radius:12px;background:#111;object-fit:contain}.note{margin:14px 4px 4px;color:#687080;font-size:14px}@media(max-width:600px){main{padding-top:30px}}</style></head><body><main><p class="eyebrow">Penina Video</p><h1>${title}</h1><section class="panel" aria-label="${title} video"><video id="lesson-video" controls playsinline preload="metadata" src="${media}">Your browser cannot play this video format.</video><p class="note">The video starts automatically after this page loads. If it starts muted, turn on sound with the player controls.</p></section></main><script nonce="${nonce}">window.addEventListener('load',()=>{const video=document.getElementById('lesson-video');video.play().catch(()=>{video.muted=true;return video.play().catch(()=>{});});});</script></body></html>`;
    return htmlResponse(request,html,nonce);
}
export async function handle(request,env,authFetch=fetch) {
    try {
        const url = new URL(request.url);
        if (url.origin === ORIGIN) {
            if (url.pathname === '/videos/manage') return await manage(request,env,url,authFetch);
            const legacy = /^\/videos\/([a-f0-9]{32})\/?$/i.exec(url.pathname);
            if (legacy) return Response.redirect(`${VIDEO_ORIGIN}/watch/${keyToken(keyFor(legacy[1]))}`,308);
            fail(404,'Use the Penina video library.');
        }
        if (url.origin !== VIDEO_ORIGIN) fail(404,'Use the Penina video address.');
        if (url.pathname === '/') return await catalog(request,env);
        const watch = /^\/watch\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
        if (watch) return await viewer(request,env,tokenKey(watch[1]));
        const media = /^\/_media\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
        if (media) return await playback(request,env,tokenKey(media[1]));
        const legacy = /^\/videos\/([a-f0-9]{32})\/?$/i.exec(url.pathname);
        if (legacy) return await viewer(request,env,keyFor(legacy[1]));
        let rootKey;
        try { rootKey=decodeURIComponent(url.pathname.slice(1)); } catch (_) { fail(404,'Video not found.'); }
        if (rootKey && isVideoKey(rootKey) && !rootKey.includes('/')) return Response.redirect(`${VIDEO_ORIGIN}/watch/${keyToken(rootKey)}`,308);
        fail(404,'Video not found.');
    } catch (error) { return json({error:error.status?error.message:'Video storage could not complete the request. Please try again.'},error.status || 503); }
}
export default {fetch(request,env) { return handle(request,env); }};

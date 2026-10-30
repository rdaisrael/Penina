const test = require('node:test');
const assert = require('node:assert/strict');
const ORIGIN = 'https://www.penina-hebrew.org';
const VIDEO_ORIGIN = 'https://video.penina-hebrew.org';
const viewerURL = id => VIDEO_ORIGIN + '/watch/' + Buffer.from('videos/' + id + '.mp4').toString('base64url');
const mediaURL = id => VIDEO_ORIGIN + '/_media/' + Buffer.from('videos/' + id + '.mp4').toString('base64url');
const COOKIE = '__Host-penina-quiz-session=verified-by-origin';
const ID = '1234567890abcdef1234567890abcdef';
const mp4 = () => Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
class Bucket {
    objects = new Map(); uploads = new Map();
    async put(key,data,options={}) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        this.objects.set(key,{bytes,key,size:bytes.length,uploaded:new Date(),httpEtag:'"etag"',...options});
    }
    async head(key) { return this.objects.get(key) || null; }
    async get(key,options={}) {
        const object = await this.head(key); if (!object) return null;
        const range = options.range;
        const data = range ? object.bytes.slice(range.offset,range.offset+range.length) : object.bytes;
        return {...object,body:new Response(data).body,json:async()=>JSON.parse(new TextDecoder().decode(data))};
    }
    async delete(key) { this.objects.delete(key); }
    async list({prefix}) { return {objects:[...this.objects.values()].filter(object=>object.key.startsWith(prefix)),truncated:false}; }
    async createMultipartUpload(key,options) {
        const uploadId = crypto.randomUUID();
        this.uploads.set(uploadId,{key,options,parts:new Map()});
        return {uploadId,...this.resumeMultipartUpload(key,uploadId)};
    }
    resumeMultipartUpload(key,uploadId) {
        const bucket=this;
        return {
            async uploadPart(partNumber,bytes) {
                const upload=bucket.uploads.get(uploadId); if (!upload || upload.key!==key) throw Error('Missing upload');
                const etag='part-'+partNumber;
                upload.parts.set(partNumber,{bytes,etag});return {partNumber,etag};
            },
            async complete(parts) {
                const upload=bucket.uploads.get(uploadId); if (!upload) throw Error('Missing upload');
                const chunks=parts.map(part=>{const chunk=upload.parts.get(part.partNumber);if(!chunk || chunk.etag!==part.etag)throw Error('Invalid part');return chunk.bytes;});
                const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
                await bucket.put(key,bytes,upload.options);bucket.uploads.delete(uploadId);return bucket.head(key);
            },
            async abort() { bucket.uploads.delete(uploadId); }
        };
    }
}
async function harness(identity={userId:1,email:'disrael@saracademy.org'}) {
    const {handle}=await import('../cloudflare/videos/worker.mjs');
    const bucket=new Bucket(), calls=[];
    const auth=async(url,options)=>{calls.push({url,options});return Response.json(identity,{status:identity?200:401});};
    const send=(path='/videos/manage',method='GET',body,headers={})=>handle(new Request(new URL(path,ORIGIN),{method,headers:{Cookie:COOKIE,Origin:ORIGIN,...(body && !(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})}),{VIDEOS:bucket},auth);
    return {bucket,calls,send,handle,auth};
}
async function upload(h,title='Lesson one') {
    const start=await h.send('/videos/manage','POST',{action:'start',title,size:16});assert.equal(start.status,201);
    const {id}=await start.json();
    const part=await h.send(`/videos/manage?id=${id}&part=1`,'PUT',mp4());assert.equal(part.status,200);
    const parts=[await part.json()];
    const complete=await h.send('/videos/manage','POST',{action:'complete',id,parts});assert.equal(complete.status,201);
    return {id,parts};
}
test('Visitors and other teachers cannot list, initiate, or upload videos',async()=>{
    for (const identity of [null,{userId:2,email:'teacher@example.org'},{userId:1,email:'other@example.org'}]) {
        const h=await harness(identity);
        for (const method of ['GET','POST','PUT']) assert([401,403].includes((await h.send('/videos/manage',method,method==='GET'?undefined:{action:'start',title:'x',size:16})).status));
        assert.equal(h.bucket.objects.size,0);assert.equal(h.bucket.uploads.size,0);
    }
    const h=await harness();assert.equal((await h.send('/videos/manage','GET',undefined,{Cookie:''})).status,401);assert.equal(h.calls.length,0);
});
test('Authentication is checked at fixed Penina endpoint and mutation requires exact origin',async()=>{
    const h=await harness();
    assert.equal((await h.send('/videos/manage')).status,200);
    assert.equal(h.calls[0].url,ORIGIN+'/api/game-scores?game=quiz-account&action=teacher');
    assert.equal(h.calls[0].options.headers.Cookie,COOKIE);assert.equal(h.calls[0].options.redirect,'error');
    for(const origin of ['https://attacker.example','null',''])assert.equal((await h.send('/videos/manage','POST',{action:'start',title:'x',size:16},{Origin:origin})).status,403);
});
test('Upload, private directory, share page, and public video work without external requests',async()=>{
    const h=await harness();const {id,parts}=await upload(h,'Hebrew <script>alert(1)</script>');
    const list=await (await h.send()).json();assert.equal(list.videos.length,1);assert.equal(list.totalBytes,16);assert.equal(list.videos[0].url,viewerURL(id));assert.equal(list.videos[0].mediaUrl,mediaURL(id));
    assert.equal(h.bucket.objects.has('uploads/'+id+'.json'),false);
    const retry=await h.send('/videos/manage','POST',{action:'complete',id,parts});assert.equal(retry.status,200);
    const previous=h.calls.length;
    const legacy=await h.send('/videos/'+id,'GET',undefined,{Cookie:''});assert.equal(legacy.status,308);assert.equal(legacy.headers.get('Location'),viewerURL(id));
    const page=await h.send(viewerURL(id),'GET',undefined,{Cookie:''});assert.equal(page.status,200);
    const html=await page.text();assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('src="'+new URL(mediaURL(id)).pathname+'"'));
    const scripts=[...html.matchAll(/<script\b([^>]*)>/g)];
    assert.equal(scripts.length,3);
    assert(scripts.slice(0,2).every(script => /src="https:\/\/www\.penina-hebrew\.org\/(session-idle|return-to-penina)\.js"/.test(script[1])));
    const nonce=/nonce="([^"]+)"/.exec(scripts[2][1])[1];
    assert(page.headers.get('Content-Security-Policy').includes("'nonce-"+nonce+"'"));
    assert.match(page.headers.get('Content-Security-Policy'),/media-src 'self'/);
    const video=await h.send(mediaURL(id),'GET',undefined,{Cookie:''});assert.equal(video.status,200);assert.deepEqual(new Uint8Array(await video.arrayBuffer()),mp4());
    assert.equal(video.headers.get('Content-Type'),'video/mp4');assert.equal(video.headers.get('Location'),null);assert.equal(h.calls.length,previous);
});
test('Seeking, suffix ranges, HEAD, validators, and invalid ranges behave correctly',async()=>{
    const h=await harness();await h.bucket.put('videos/'+ID+'.mp4',mp4());const path=mediaURL(ID);
    for (const [range,expected,contentRange] of [['bytes=4-7',[102,116,121,112],'bytes 4-7/16'],['bytes=12-',[0,0,0,0],'bytes 12-15/16'],['bytes=-4',[0,0,0,0],'bytes 12-15/16'],['bytes=12-999',[0,0,0,0],'bytes 12-15/16']]){
        const response=await h.send(path,'GET',undefined,{Range:range});assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),contentRange);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],expected);
    }
    for(const range of ['bytes=99-','bytes=8-2','bytes=-0','bytes=0-1,4-5','garbage']){
        const response=await h.send(path,'GET',undefined,{Range:range});assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */16');
    }
    const head=await h.send(path,'HEAD');assert.equal(head.headers.get('Content-Length'),'16');assert.equal(await head.text(),'');
    assert.equal((await h.send(path,'GET',undefined,{'If-None-Match':'"etag"'})).status,304);
    assert.equal((await h.send(path,'GET',undefined,{Range:'bytes=4-7','If-Range':'"outdated"'})).status,200);
});
test('Reject invalid format, size, parts, expired uploads; cancellation removes pending upload',async()=>{
    const h=await harness();
    for(const size of [-1,0,1.2,2**31])assert.equal((await h.send('/videos/manage','POST',{action:'start',title:'x',size})).status,400);
    const {id}=await(await h.send('/videos/manage','POST',{action:'start',title:'x',size:16})).json();
    assert.equal((await h.send(`/videos/manage?id=${id}&part=2`,'PUT',mp4())).status,400);
    assert.equal((await h.send(`/videos/manage?id=${id}&part=1`,'PUT',new Uint8Array(16))).status,415);
    assert.equal((await h.send(`/videos/manage?id=${id}&part=1`,'PUT',new Uint8Array(17))).status,413);
    assert.equal((await h.send('/videos/manage','POST',{action:'complete',id,parts:[]})).status,400);
    assert.equal((await h.send(viewerURL(id))).status,404);
    const key='uploads/'+id+'.json',pending=await(await h.bucket.get(key)).json();pending.expiresAt=0;await h.bucket.put(key,JSON.stringify(pending));
    assert.equal((await h.send(`/videos/manage?id=${id}&part=1`,'PUT',mp4())).status,410);
    assert.equal((await h.send('/videos/manage','POST',{action:'abort',id})).status,200);assert.equal(h.bucket.objects.size,0);assert.equal(h.bucket.uploads.size,0);
});
test('Multiple parts retry without duplication and complete to original length',async()=>{
    const h=await harness(),chunk=new Uint8Array(8*1024*1024);chunk.set(mp4());
    const {id}=await(await h.send('/videos/manage','POST',{action:'start',title:'Large video',size:chunk.length+16})).json();
    const first=await(await h.send(`/videos/manage?id=${id}&part=1`,'PUT',chunk)).json();
    const repeated=await(await h.send(`/videos/manage?id=${id}&part=1`,'PUT',chunk)).json();assert.deepEqual(first,repeated);
    const second=await(await h.send(`/videos/manage?id=${id}&part=2`,'PUT',mp4())).json();
    assert.equal((await h.send('/videos/manage','POST',{action:'complete',id,parts:[first,second]})).status,201);
    assert.equal((await h.bucket.head('videos/'+id+'.mp4')).size,chunk.length+16);
});
test('Wrong host, missing files, and storage/auth outages fail closed',async()=>{
    const h=await harness();
    assert.equal((await h.handle(new Request('https://other.example/videos/manage'),{VIDEOS:h.bucket},h.auth)).status,404);
    assert.equal((await h.send(viewerURL(ID))).status,404);
    const request=new Request(ORIGIN+'/videos/manage',{headers:{Cookie:COOKIE}});
    assert.equal((await h.handle(request,{VIDEOS:h.bucket},async()=>{throw Error('private-secret');})).status,503);
    assert.equal((await h.handle(request,{},h.auth)).status,503);
});

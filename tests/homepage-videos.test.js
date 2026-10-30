const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../homepage-videos.js'),'utf8');
const owner={userId:1,email:'disrael@saracademy.org'};
function page(fetchOverride) {
    const elements=new Map(),calls=[];
    const make=()=>({hidden:true,disabled:false,value:'',files:[],items:[],textContent:'',append(...items){this.items.push(...items);},replaceChildren(...items){this.items=items;},setAttribute(k,v){this[k]=v;},reset(){},select(){this.selected=true;},focus(){}});
    const element=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
    const document={getElementById:element,createElement:make,createElementNS:make},window={confirm:()=>true};
    const videos=[{id:'a'.repeat(32),title:'Lesson <one>',size:300e6,url:'https://video.penina-hebrew.org/watch/lesson-token'}];
    const fetch=async(url,options)=>{calls.push({url,options});if(fetchOverride)return fetchOverride(url,options);return Response.json({videos,totalBytes:300e6,maxFileBytes:1024**3});};
    const copied=[];
    vm.runInNewContext(source,{document,window,fetch,URL,location:{origin:'https://www.penina-hebrew.org'},navigator:{clipboard:{writeText:async value=>copied.push(value)}},AbortController,console});
    return {elements,element,window,calls,copied};
}
test('Only the owner sees the video manager, and hide clears private listings',async()=>{
    for(const user of [null,{userId:2,email:'teacher@example.org'},{userId:1,email:'other@example.org'}]){
        const p=page();await p.window.PeninaVideos.show(user);assert.equal(p.element('video-manager').hidden,true);assert.equal(p.calls.length,0);
    }
    const p=page();await p.window.PeninaVideos.show(owner);assert.equal(p.element('video-manager').hidden,false);assert.equal(p.element('video-list').items.length,1);
    const item=p.element('video-list').items[0];assert.equal(item.items[0].textContent,'Lesson <one>');const urlRow=item.items[2];assert.equal(urlRow.items[0].value,'https://video.penina-hebrew.org/watch/lesson-token');await urlRow.items[1].onclick();assert.equal(p.copied[0],'https://video.penina-hebrew.org/watch/lesson-token');assert.equal(item.items[3].href,p.copied[0]);
    p.window.PeninaVideos.hide();assert.equal(p.element('video-manager').hidden,true);assert.equal(p.element('video-list').items.length,0);
});
test('Directory failure shows honest status and leaves the picker usable; denied owner hides panel',async()=>{
    const unavailable=page(async()=>new Response('Not found',{status:404}));await unavailable.window.PeninaVideos.show(owner);
    assert.match(unavailable.element('video-status').textContent,/awaiting connection/);assert.equal(unavailable.element('video-upload-fields').disabled,false);
    const denied=page(async()=>Response.json({error:'Denied'},{status:403}));await denied.window.PeninaVideos.show(owner);assert.equal(denied.element('video-manager').hidden,true);
});
test('A late directory response cannot repopulate the manager after logout',async()=>{
    let resolve;const p=page(()=>new Promise(done=>resolve=done));const showing=p.window.PeninaVideos.show(owner);p.window.PeninaVideos.hide();
    resolve(Response.json({videos:[{title:'Secret'}],totalBytes:0,maxFileBytes:100}));await showing;
    assert.equal(p.element('video-manager').hidden,true);assert.equal(p.element('video-list').items.length,0);
});
test('Upload sends same-origin chunks, then completes and refreshes the list',async()=>{
    const p=page(async(url,options)=>{
        if(options.method==='PUT')return Response.json({partNumber:Number(new URL(url,'https://www.penina-hebrew.org').searchParams.get('part')),etag:'part'});
        if(options.method==='POST'){
            const body=JSON.parse(options.body);
            if(body.action==='start')return Response.json({id:'b'.repeat(32),chunkSize:8});
            if(body.action==='complete'){assert.equal(body.parts.length,2);return Response.json({path:'/videos/'+'b'.repeat(32)});}
        }
        return Response.json({videos:[],totalBytes:0,maxFileBytes:1024**3});
    });
    await p.window.PeninaVideos.show(owner);p.element('video-title').value='Lesson';
    p.element('video-file').files=[{name:'lesson.mp4',size:16,slice:(start,end)=>new Uint8Array(end-start)}];
    await p.element('video-upload-form').onsubmit({preventDefault(){}});
    assert.equal(p.calls.filter(c=>c.options.method==='PUT').length,2);assert(p.calls.every(c=>c.url.startsWith('/videos/manage')));
    assert.match(p.element('video-status').textContent,/uploaded/);assert.equal(p.element('video-upload-fields').disabled,false);assert.equal(p.element('video-progress').hidden,true);
});
test('Upload failure aborts incomplete parts and presents error',async()=>{
    const actions=[];const p=page(async(url,options)=>{
        if(options.method==='PUT')return Response.json({error:'Not an MP4 file'},{status:415});
        if(options.method==='POST'){const body=JSON.parse(options.body);actions.push(body.action);return Response.json(body.action==='start'?{id:'b'.repeat(32),chunkSize:8}:{aborted:true});}
        return Response.json({videos:[],totalBytes:0,maxFileBytes:1024**3});
    });
    await p.window.PeninaVideos.show(owner);p.element('video-title').value='Lesson';p.element('video-file').files=[{name:'lesson.mp4',size:16,slice:()=>new Uint8Array(8)}];
    await p.element('video-upload-form').onsubmit({preventDefault(){}});
    assert.deepEqual(actions,['start','abort']);assert.match(p.element('video-status').textContent,/Not an MP4/);assert.equal(p.element('video-upload-fields').disabled,false);
});

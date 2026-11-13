'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../session-idle.js'),'utf8');
const hour=60*60*1000;
function harness({age=0,localAge=age,search='',pathname='/',hostname='www.penina-hebrew.org',signedIn=true,fetchResponse=async()=>({ok:true,status:204})}={}) {
    let now=1800000000000;
    const cookies=new Map([['penina_activity',String(now-age)]]),storage=new Map([['penina_activity',String(now-localAge)]]),events={},requests=[],redirects=[],intervals=[];
    const account={hidden:!signedIn};
    const document={addEventListener(){},getElementById:id=>id==='signed-in-account'?account:null};
    Object.defineProperty(document,'cookie',{
        get:()=>[...cookies].map(([k,v])=>k+'='+v).join('; '),
        set:value=>{const [key,content]=value.split(';')[0].split('=');if(content)cookies.set(key,content);else cookies.delete(key);}
    });
    vm.runInNewContext(source,{
        Date:{now:()=>now},URLSearchParams,document,HTMLMediaElement:class {},
        location:{hostname,pathname,search,replace:url=>redirects.push(url)},
        localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        addEventListener:(event,fn)=>events[event]=fn,setInterval:fn=>intervals.push(fn),
        fetch:async(url,options)=>{requests.push({url,options});return fetchResponse(url,options);}
    });
    return {account,cookies,storage,events,requests,redirects,intervals,advance:ms=>now+=ms,
        signIn:()=>cookies.set('penina_activity',String(now)),
        flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('Restoring an old tab reads the fresh sign-in cookie before expiring the session',async()=>{
    const h=harness();h.advance(hour+1000);h.signIn();h.events.pageshow();await h.flush();
    assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.ok(h.cookies.has('penina_activity'));
});
test('A delayed expired-session redirect cannot log out a fresh sign-in',async()=>{
    const h=harness({search:'?session=expired'});await h.flush();
    assert.equal(h.requests.length,0);assert.deepEqual(h.redirects,['/']);assert.ok(h.cookies.has('penina_activity'));
});
test('A slightly slow device clock does not discard the server cookie from a fresh sign-in',async()=>{
    const h=harness({age:-30000,localAge:hour+1000});await h.flush();
    assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);
});
test('Idle students return to their exact quiz and class instead of teacher sign-in',async()=>{
    for(const quiz of ['custom','gemara-6-wl-2','gemara-6-intro-retake','gemara-8-intro-retake']) {
        const pathname='/Penina-Quizzes/'+quiz+'/',search='?quiz=custom-'+'a'.repeat(32)+'&class='+'c'.repeat(32);
        const h=harness({age:hour+1000,pathname,search});await h.flush();
        assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/action=logout$/);
        assert.deepEqual(h.redirects,[pathname+search]);assert.equal(h.storage.has('penina_activity'),false);
    }
});
test('An actually idle teacher session still signs out once and returns home',async()=>{
    const h=harness();h.advance(hour+1000);h.events.pageshow();h.intervals[0]();await h.flush();
    assert.equal(h.requests.length,1);assert.deepEqual(h.redirects,['/']);
});
test('Activity in another tab keeps an older tab active during its periodic check',async()=>{
    const h=harness();h.advance(hour+1000);h.signIn();h.intervals[0]();await h.flush();
    assert.equal(h.requests.filter(r=>r.url.includes('action=logout')).length,0);assert.equal(h.redirects.length,0);
});
test('Anonymous homepage visitors do not send background sign-in checks even with activity cookies',async()=>{
    for(const pathname of ['/','/index.html']) {
        const h=harness({signedIn:false,pathname});
        for(let minute=0;minute<10;minute++){h.advance(60000);h.events.click();h.intervals[0]();await h.flush();}
        assert.equal(h.requests.length,0);
        h.account.hidden=false;h.intervals[0]();await h.flush();
        assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/action=activity$/);
        h.account.hidden=true;h.advance(60000);h.intervals[0]();await h.flush();assert.equal(h.requests.length,1);
    }
});
test('A rejected session stops heartbeats and ordinary activity does not restart them',async()=>{
    for(const pathname of ['/','/Penina-Quizzes/custom/']) {
        const h=harness({pathname,fetchResponse:async()=>({ok:false,status:401})});
        h.intervals[0]();await h.flush();
        for(let minute=0;minute<5;minute++){h.advance(60000);h.events.click();h.events.pageshow();h.intervals[0]();await h.flush();}
        assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);
    }
});
test('Active sessions keep their heartbeat cadence through temporary failures',async()=>{
    let count=0;
    const h=harness({fetchResponse:async()=>{if(++count===1)throw Error('Network unavailable');return {ok:count>2,status:count===2?503:204};}});
    h.intervals[0]();await h.flush();h.advance(5000);h.intervals[0]();await h.flush();assert.equal(h.requests.length,1);
    for(let minute=0;minute<3;minute++){h.advance(60000);h.events.click();h.intervals[0]();await h.flush();}
    assert.equal(h.requests.length,4);
});
test('Slow heartbeat requests cannot overlap',async()=>{
    let resolve;
    const h=harness({fetchResponse:()=>new Promise(done=>resolve=done)});
    h.intervals[0]();h.advance(120000);h.intervals[0]();assert.equal(h.requests.length,1);
    resolve({ok:true,status:204});await h.flush();h.intervals[0]();await h.flush();assert.equal(h.requests.length,2);
});

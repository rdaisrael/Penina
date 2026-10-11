const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const questions = require('../Penina-Quizzes/gemara-6-wl-2/questions.json');
function harness() {
    const blobs = new Map(); let writes = 0, now = Date.now();
    class TestDate extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}}
    const ctx = {Date:TestDate,module:{exports:{}},Buffer,console:{error(){}},process:{env:{BLOB_READ_WRITE_TOKEN:'test-server-secret'}},fetch:async url=>({ok:true,text:async()=>blobs.get(url)}),require:n=>{
        if(n==='./quiz-grading') return require('../lib/quiz-grading');
        if(n==='crypto') return require('crypto');
        if(n.endsWith('questions.json')) return questions;
        if(n==='./vocabulary-pages') return {getPage:async()=>({id:'sixth'}),authenticatePage:(_,p)=>p==='teacher-secret'?null:{status:401,error:'Incorrect password.'}};
        if(n==='@vercel/blob') return {list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p})),hasMore:false}),put:async(p,data)=>{if(blobs.has(p))throw Error('Already exists');writes++;blobs.set(p,data);}};
        throw Error(n);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/quiz-submissions.js'),'utf8'),ctx);
    const run = async body=>{const res={setHeader(){},status(s){this.code=s;return this;},json(d){this.data=d;return this;}};await ctx.module.exports({method:'POST',body},res);return res;};
    const autoRun=async body=>{
        if(body.action==='submit' && !body.token && ctx.module.exports.validate(body)) {
            const started=await run({action:'start',id:body.id,email:body.email});
            if(started.code===200) body={...body,id:started.data.id,token:started.data.token};
            else if(started.code===409) {
                const attempts=[...blobs.entries()].filter(([p])=>p.startsWith('quiz-attempts/')).map(([,raw])=>({raw,record:ctx.module.exports.decrypt(raw)}));
                const attempt=attempts.find(a=>a.record.email===body.email);
                if(attempt)body={...body,token:attempt.raw};
            }
        }
        return run(body);
    };
    return {run:autoRun,rawRun:run,advance:ms=>now+=ms,blobs,writes:()=>writes,handler:ctx.module.exports};
}
function submission() {return {action:'submit',id:'a'.repeat(32),name:'Student <one>',email:'student@school.org',answers:questions.map((q,i)=>Array(q.fields?.length||1).fill(q.choices?.[0] || (i<12?'answer':'')))};}
test('Students can submit but cannot retrieve reports; stored names and answers are encrypted',async()=>{
    const h = harness(); assert.equal((await h.run(submission())).code,200);
    const raw = [...h.blobs.values()][0]; assert(!raw.includes('Student')); assert(!raw.includes('school.org')); assert(!raw.includes('answers'));
    assert.equal((await h.run({action:'report',password:'wrong'})).code,401);
    const report = await h.run({action:'report',password:'teacher-secret'}); assert.equal(report.code,200); assert.equal(report.data.submissions[0].name,'Student <one>');
});
test('Retrying the same receipt does not overwrite or duplicate the submission',async()=>{
    const h=harness(); await h.run(submission()); const changed=submission();changed.name='Changed';assert.equal((await h.run(changed)).code,200);assert.equal(h.writes(),2);
    assert.equal((await h.run({action:'report',password:'teacher-secret'})).data.submissions[0].name,'Student <one>');
});
test('Invalid choices, missing required answers, and oversized input are rejected',async()=>{
    for(const mutate of [b=>b.answers[0]=['made up'],b=>b.answers[2]=[''],b=>b.answers.pop(),b=>b.name='x'.repeat(121),b=>b.id='../record',b=>b.email='invalid',b=>b.answers[13]=['x'.repeat(2001),'']]){
        const h=harness(),body=submission();mutate(body);assert.equal((await h.run(body)).code,400);assert.equal(h.writes(),0);
    }
});
test('Encrypted records detect tampering',()=>{
    const h=harness(),raw=JSON.parse(h.handler.encrypt({name:'Private'}));raw.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>h.handler.decrypt(JSON.stringify(raw)));
});

test('Report automatically grades the original multiple-choice key and leaves four questions pending',async()=>{
    const h=harness(),body=submission();
    const key={0:'Rabbi from the time of the Mishnah',1:'Here',3:'Sunrise',4:'Mid-day',6:'Until',7:'Sunset',8:'First part',9:'הַתָּם',10:'סֵיפָא',11:'קְבַע'};
    for(const [i,answer] of Object.entries(key))body.answers[i]=[answer];
    await h.run(body);
    const g=(await h.run({action:'report',password:'teacher-secret'})).data.submissions[0].grading;
    assert.equal(g.automaticScore,10);assert.equal(g.pending,4);assert.equal(g.total,null);
    assert.deepEqual(Array.from(g.manual,q=>q.index),[2,5,12,13]);
});
test('Teacher corrections persist with half points, extra credit, and feedback; students cannot write grades',async()=>{
    const h=harness();await h.run(submission());
    const body={action:'correct',id:'a'.repeat(32),password:'wrong',scores:[1,0.5,2,1],feedback:'Good work'};
    assert.equal((await h.run(body)).code,401);body.password='teacher-secret';
    const saved=await h.run(body);assert.equal(saved.code,200);assert.equal(saved.data.grading.pending,0);
    const report=await h.run({action:'report',password:'teacher-secret'}),g=report.data.submissions[0].grading;
    assert.equal(g.total,g.automaticScore+4.5);assert.equal(g.baseMax,12);assert.equal(g.feedback,'Good work');
    const raw=[...h.blobs.entries()].find(([p])=>p.startsWith('quiz-corrections/'))[1];assert(!raw.includes('Good work'));assert(!raw.includes('scores'));
});
test('Invalid correction scores and nonexistent submissions are rejected',async()=>{
    const h=harness();await h.run(submission());
    for(const scores of [[2,1,2,2],[1,-1,2,2],[1,1,3,2],[1,1,2],[1,'1',2,2],[1,0.3,2,2]]) {
        assert.equal((await h.run({action:'correct',id:'a'.repeat(32),password:'teacher-secret',scores,feedback:''})).code,400);
    }
    assert.equal((await h.run({action:'correct',id:'b'.repeat(32),password:'teacher-secret',scores:[1,1,2,2],feedback:''})).code,404);
});
test('Partially reviewed work keeps the final score pending rather than treating unmarked answers as zero',async()=>{
    const h=harness();await h.run(submission());
    const r=await h.run({action:'correct',id:'a'.repeat(32),password:'teacher-secret',scores:[0,null,0,null],feedback:''});
    assert.equal(r.data.grading.pending,2);assert.equal(r.data.grading.total,null);
});

test('Email attempt deadline survives a new device and concurrent starts; only one immutable submission is accepted',async()=>{
    const h=harness(),body=submission();
    const first=await h.rawRun({action:'start',id:body.id,email:body.email});
    h.advance(60000);
    const second=await h.rawRun({action:'start',id:'b'.repeat(32),email:body.email.toUpperCase()});
    assert.equal(second.data.id,first.data.id);assert.equal(second.data.deadline,first.data.deadline);
    body.token=first.data.token;
    const accepted=await h.rawRun(body);assert.equal(accepted.code,200);assert.equal(accepted.data.automatic.length,10);
    const retry=await h.rawRun({...body,answers:questions.map(q=>Array(q.fields?.length||1).fill(''))});
    assert.equal(retry.code,400);
    assert.equal((await h.rawRun({action:'start',id:'c'.repeat(32),email:body.email})).code,409);
});
test('Expired attempts accept unanswered questions for automatic submission and cannot acquire a fresh deadline',async()=>{
    const h=harness(),body=submission();
    const first=await h.rawRun({action:'start',id:body.id,email:body.email});
    body.token=first.data.token;body.answers=questions.map(q=>Array(q.fields?.length||1).fill(''));
    assert.equal((await h.rawRun(body)).code,400);
    h.advance(1000*60*1000);
    const restored=await h.rawRun({action:'start',id:'b'.repeat(32),email:body.email});
    assert.equal(restored.data.deadline,first.data.deadline);
    const result=await h.rawRun(body);assert.equal(result.code,200);assert(result.data.automatic.every(q=>q.score===0));
    const report=await h.rawRun({action:'report',password:'teacher-secret'});assert.equal(report.data.submissions[0].expired,true);
});
test('Unsigned, tampered and mismatched-email attempt tokens are rejected',async()=>{
    const h=harness(),body=submission();assert.equal((await h.rawRun(body)).code,400);
    const first=await h.rawRun({action:'start',id:body.id,email:body.email});
    body.token=first.data.token;body.email='another@school.org';assert.equal((await h.rawRun(body)).code,400);
    body.email='student@school.org';body.token=body.token.replace('data','broken');assert.equal((await h.rawRun(body)).code,400);
});

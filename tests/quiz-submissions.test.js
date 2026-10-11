const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const questions = require('../Penina-Quizzes/gemara-6-wl-2/questions.json');
function harness() {
    const blobs = new Map(); let writes = 0;
    const ctx = {module:{exports:{}},Buffer,console:{error(){}},process:{env:{BLOB_READ_WRITE_TOKEN:'test-server-secret'}},fetch:async url=>({ok:true,text:async()=>blobs.get(url)}),require:n=>{
        if(n==='crypto') return require('crypto');
        if(n.endsWith('questions.json')) return questions;
        if(n==='./vocabulary-pages') return {getPage:async()=>({id:'sixth'}),authenticatePage:(_,p)=>p==='teacher-secret'?null:{status:401,error:'Incorrect password.'}};
        if(n==='@vercel/blob') return {list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p})),hasMore:false}),put:async(p,data)=>{if(blobs.has(p))throw Error('Already exists');writes++;blobs.set(p,data);}};
        throw Error(n);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/quiz-submissions.js'),'utf8'),ctx);
    const run = async body=>{const res={setHeader(){},status(s){this.code=s;return this;},json(d){this.data=d;return this;}};await ctx.module.exports({method:'POST',body},res);return res;};
    return {run,blobs,writes:()=>writes,handler:ctx.module.exports};
}
function submission() {return {action:'submit',id:'a'.repeat(32),name:'Student <one>',email:'student@school.org',answers:questions.map((q,i)=>Array(q.fields?.length||1).fill(q.choices?.[0] || (i<12?'answer':'')))};}
test('Students can submit but cannot retrieve reports; stored names and answers are encrypted',async()=>{
    const h = harness(); assert.equal((await h.run(submission())).code,200);
    const raw = [...h.blobs.values()][0]; assert(!raw.includes('Student')); assert(!raw.includes('school.org')); assert(!raw.includes('answers'));
    assert.equal((await h.run({action:'report',password:'wrong'})).code,401);
    const report = await h.run({action:'report',password:'teacher-secret'}); assert.equal(report.code,200); assert.equal(report.data.submissions[0].name,'Student <one>');
});
test('Retrying the same receipt does not overwrite or duplicate the submission',async()=>{
    const h=harness(); await h.run(submission()); const changed=submission();changed.name='Changed';assert.equal((await h.run(changed)).code,200);assert.equal(h.writes(),1);
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

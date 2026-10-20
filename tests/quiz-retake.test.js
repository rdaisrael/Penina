const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const questions = require('../Penina-Quizzes/gemara-6-intro-retake/questions.json');
function harness() {
    const blobs = new Map(); let writes = 0, now = Date.now();
    let gradeError=false;const sentGrades=[];
    let identity={sub:'student-id',classId:'c'.repeat(32),className:'Test class',name:'Student <one>',email:'student@school.org'};
    class TestDate extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}}
    const ctx = {Date:TestDate,module:{exports:{}},Buffer,console:{error(){}},process:{env:{BLOB_READ_WRITE_TOKEN:'test-server-secret'}},fetch:async url=>({ok:true,text:async()=>blobs.get(url)}),require:n=>{
        if(n==='./quiz-account') return {requireStudent:async(req,classId,quiz)=>{assert.equal(quiz,'gemara-6-intro-retake');if(!identity)throw Object.assign(new Error('Not enrolled'),{status:403});return identity;},sendGrade:async(req,record,grading,quiz)=>{assert.equal(quiz,'gemara-6-intro-retake');if(gradeError)throw Object.assign(Error('Google unavailable'),{status:503});sentGrades.push({record,grading});return {score:grading.total};}};
        if(n==='./quiz-retake-grading') return require('../lib/quiz-retake-grading');
        if(n==='crypto') return require('crypto');
        if(n.endsWith('questions.json')) return questions;
        if(n==='./vocabulary-pages') return {getPage:async()=>({id:'sixth'}),authenticatePage:(_,p)=>p==='teacher-secret'?null:{status:401,error:'Incorrect password.'}};
        if(n==='@vercel/blob') return {list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p})),hasMore:false}),put:async(p,data)=>{if(blobs.has(p))throw Error('Already exists');writes++;blobs.set(p,data);}};
        throw Error(n);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/quiz-retake-submissions.js'),'utf8'),ctx);
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
    return {sentGrades,setGradeError:value=>gradeError=value,setUser:user=>identity=user,run:autoRun,rawRun:run,advance:ms=>now+=ms,blobs,writes:()=>writes,handler:ctx.module.exports};
}
const correct=[['תורה שבעל פה — Oral Torah'],['בָּרָיְתָא','מִשְׁנָה','גְּמָרָא'],['דְּרַבָּנַן','דְּאוֹרָיְתָא'],['מֹשֶׁה','יְהוֹשֻׁעַ','זְקֵנִים','נְבִיאִים','אַנְשֵׁי כְּנֶסֶת הַגְּדוֹלָה'],['זְרָעִים','מוֹעֵד','נָשִׁים','נְזִיקִין','קַדְּשִׁים','טְהֹרוֹת'],['תנא']];
function submission() {return {action:'submit',id:'a'.repeat(32),name:'Student',email:'student@school.org',answers:structuredClone(correct)};}
const {grade,validCorrections}=require('../lib/quiz-retake-grading');
test('Retake key totals eight points with two manual answers and partial credit for gaps',()=>{
    assert.equal(grade(correct).automaticScore,5);assert.equal(grade(correct).pending,2);
    assert.equal(grade(correct,{scores:[2,1]}).total,8);
    const partial=structuredClone(correct);partial[2][0]='דְמִצְוָה';assert.equal(grade(partial).automaticScore,4);
    partial[1].push('חֻמַּשׁ');assert.equal(grade(partial).automatic[0].score,0);
    partial[3].reverse();assert.equal(grade(partial).automatic.find(q=>q.index===3).score,0);
    partial[4].reverse();assert.equal(grade(partial).automatic.find(q=>q.index===4).score,0);
    assert(validCorrections([1.5,0.5]));assert(validCorrections([2,2]));assert(!validCorrections([1,0.3]));
});
test('Retake rejects duplicate ordering, invalid word choices, missing blanks and oversized answers',()=>{
    const h=harness();assert(h.handler.validate(submission()));
    for(const change of [b=>b.answers[1].push(b.answers[1][0]),b=>b.answers[2][0]='wrong',b=>b.answers[3][0]=b.answers[3][1],b=>b.answers[2].pop(),b=>b.answers[0][0]='x'.repeat(2001)]) {
        const body=submission();change(body);assert(!h.handler.validate(body));
    }
    const blank=submission();blank.answers=[[''],[],['',''],Array(5).fill(''),Array(6).fill(''),['']];
    assert(!h.handler.validate(blank));assert(h.handler.validate(blank,true));
});
test('Student receipt hides answer key and score, teacher report grades it, and corrections persist',async()=>{
    const h=harness(),result=await h.run(submission());assert.equal(result.code,200);
    for(const item of result.data.automatic){assert.equal(item.correct,true);assert.equal(item.correctAnswer,undefined);assert.equal(item.score,undefined);}
    assert.equal((await h.run({action:'report',password:'wrong'})).code,401);
    const report=await h.run({action:'report',password:'teacher-secret'});assert.equal(report.data.submissions[0].grading.automaticScore,5);
    const corrected=await h.run({action:'correct',id:'a'.repeat(32),password:'teacher-secret',scores:[2,0.5],feedback:'Good',sendToClassroom:true});
    assert.equal(corrected.data.grading.total,7.5);assert.equal(h.sentGrades[0].grading.total,7.5);
    assert([...h.blobs.keys()].every(p=>p.includes('/gemara-6-intro-retake/')));
    assert([...h.blobs.values()].every(v=>!v.includes('student@school.org')));
});
test('Retake maintains one immutable attempt, preserves deadline, and accepts expiry with blanks',async()=>{
    const h=harness(),first=await h.rawRun({action:'start',id:'a'.repeat(32)});
    const next=await h.rawRun({action:'start',id:'b'.repeat(32)});assert.equal(next.data.id,first.data.id);assert.equal(next.data.deadline,first.data.deadline);
    h.advance(1000*60*1000+1);const body=submission();body.token=first.data.token;body.answers=[[''],[],['',''],Array(5).fill(''),Array(6).fill(''),['']];
    assert.equal((await h.rawRun(body)).code,200);
    assert.equal((await h.rawRun({action:'start',id:'b'.repeat(32)})).code,409);
});

test('Automatic score overrides persist, validate, restore, and reach Classroom',async()=>{
 const h=harness(),submitted=submission();assert.equal((await h.run(submitted)).code,200);
 const before=(await h.run({action:'report',password:'teacher-secret'})).data.submissions[0];
 const index=1,original=before.grading.automatic.find(q=>q.index===index).score,changed=original===0?1:0;
 const body={action:'correct',id:submitted.id,password:'teacher-secret',scores:[2,1],overrides:{[index]:changed},feedback:'Answer key correction',sendToClassroom:true};
 assert.equal((await h.run({...body,password:'wrong'})).code,401);
 for(const overrides of [{[index]:-1},{[index]:0.25},{[index]:'1'},{999:1},[],null])assert.equal((await h.run({...body,overrides})).code,400);
 const saved=await h.run(body);assert.equal(saved.code,200);assert.equal(saved.data.grading.automatic.find(q=>q.index===index).score,changed);
 assert.equal(h.sentGrades.at(-1).grading.total,saved.data.grading.total);
 const after=(await h.run({action:'report',password:'teacher-secret'})).data.submissions[0];
 const item=after.grading.automatic.find(q=>q.index===index);assert.equal(item.originalScore,original);assert.equal(item.overridden,true);assert.equal(item.score,changed);
 assert.deepEqual(after.answers,before.answers);
 h.advance(1000);const restored=await h.run({...body,overrides:{}});assert.equal(restored.code,200);assert.equal(restored.data.grading.automatic.find(q=>q.index===index).score,original);
});

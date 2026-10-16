const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {correctedTest}=require('../lib/quiz-correction-email');
const fixture=()=>({title:'Hebrew quiz',record:{id:'abc',name:'Student',email:'student@school.org',answers:[['<script>student</script>']]},questions:[{prompt:'Explain the rule'}],grading:{pending:0,total:1,baseMax:1,manual:[],automatic:[{index:0,score:1,max:1,originalScore:0,overridden:true,correctAnswer:'SECRET KEY',explanation:'The key was wrong. <b>You earned credit.</b>'}],feedback:'Well done'}});
test('Student email includes override, original and final points, explanation and feedback without answer key',()=>{
 const result=correctedTest(fixture());assert.equal(result.subject,'Corrected Assessment: Hebrew quiz');assert.match(result.text,/Teacher override: 0\/1 → 1\/1/);assert.match(result.text,/The key was wrong/);assert.match(result.text,/Well done/);assert(!result.html.includes('SECRET KEY'));assert(!result.html.includes('<script>'));assert(result.html.includes('&lt;script&gt;'));assert(!result.html.includes('<b>You'));
 assert.throws(()=>correctedTest({...fixture(),grading:{pending:1}}));
});
function harness(ok=true,configured=true){const calls=[],context={module:{exports:{}},require,AbortSignal,process:{env:configured?{RESEND_API_KEY:'test',LIVE_SCORE_EMAIL_FROM:'quiz@school.org'}:{}},fetch:async(url,options)=>{calls.push({url,options});return {ok};}};vm.runInNewContext(fs.readFileSync(require.resolve('../lib/quiz-correction-email'),'utf8'),context);return {send:context.module.exports.sendCorrectedTest,calls};}
test('Emails use saved student recipient and stable retry key; changed explanations produce a new email',async()=>{
 const h=harness(),data=fixture();assert.equal((await h.send(data)).status,'accepted');await h.send(data);assert.deepEqual(JSON.parse(h.calls[0].options.body).to,['student@school.org']);assert.equal(h.calls[0].options.headers['Idempotency-Key'],h.calls[1].options.headers['Idempotency-Key']);data.grading.automatic[0].explanation='Updated explanation';await h.send(data);assert.notEqual(h.calls[0].options.headers['Idempotency-Key'],h.calls[2].options.headers['Idempotency-Key']);
});
test('Missing configuration and provider rejection do not claim email was sent',async()=>{
 await assert.rejects(harness(true,false).send(fixture()),/not configured/);await assert.rejects(harness(false).send(fixture()),/did not accept/);
});

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/teacher.js'),'utf8');
const correctionContext={window:{},document:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/correction.js'),'utf8'),correctionContext);
const QuizCorrection=correctionContext.window.QuizCorrection;
const initializer=source.slice(source.indexOf('(async()=>{'),source.indexOf('})();')+5);
async function initialize({search,failCourses=false,configured=true,assignments=[]}) {
 const elements=new Map(),requests=[],loaded=[];
 function element(id){if(!elements.has(id))elements.set(id,{options:[{value:''}],value:'',add(option){this.options.push(option);}});return elements.get(id);}
 const context={URLSearchParams,quizId:'custom-test',location:{search},Option:class{constructor(label,value){this.label=label;this.value=value;}},document:{getElementById:element,querySelector:()=>({})},connectionStatus:element('connectionStatus'),esc:s=>s,
  accountRequest:async action=>{requests.push(action);if(action==='config')return {configured};if(action==='assignments')return {assignments};if(failCourses)throw Error('Classroom unavailable');return {email:'teacher@school.org',courses:[{id:'active',name:'Active class'}]};},
  loadReport:async()=>loaded.push(element('reportClass').value)};
 await vm.runInNewContext(initializer,context);
 return {elements,requests,loaded};
}
test('Unavailable class links keep the requested class instead of loading all submissions',async()=>{
 const result=await initialize({search:'?mode=review&course=archived'});
 assert.deepEqual(result.loaded,['archived']);assert.equal(result.elements.get('reportClass').options.at(-1).value,'archived');
});
test('Class list failures still load reports and preserve a selected class',async()=>{
 const selected=await initialize({search:'?mode=review&course=class-1',failCourses:true});assert.deepEqual(selected.loaded,['class-1']);
 const all=await initialize({search:'?mode=review',failCourses:true});assert.deepEqual(all.loaded,['']);
});
test('Assigning never auto-loads correction reports',async()=>{
 const result=await initialize({search:'?mode=assign',failCourses:true});assert.deepEqual(result.loaded,[]);
});

function rosterView(records) {
 const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{replaceChildren(){this.innerHTML='';}});return elements.get(id);}};
 const context={document,records,QuizCorrection,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),formatResultTime:s=>s};
 vm.runInNewContext(source.slice(source.indexOf('function renderRoster('),source.indexOf('async function loadReport(')),context);
 return {render:context.renderRoster,elements};
}
test('Roster includes non-submitters, sorts names, and links only available submissions',()=>{
 const view=rosterView([{id:'receipt-z',grading:{pending:1,savedAt:null}}]);
 view.render({className:'Class',assigned:true,students:[
  {id:'z',name:'Zoe',status:'submitted',submissionId:'receipt-z'},
  {id:'b',name:'ben',status:'in-progress'},
  {id:'a',name:'Alice',status:'not-started'}
 ]});
 const html=view.elements.get('rosterRows').innerHTML;
 assert.ok(html.indexOf('Alice')<html.indexOf('ben'));
 assert.ok(html.indexOf('ben')<html.indexOf('Zoe'));
 assert.match(html,/href="#submission-receipt-z" data-submission="receipt-z">Zoe/);
 assert.equal((html.match(/<a /g)||[]).length,1);
 assert.doesNotMatch(html,/class="graded-check"/);
});
test('Graded check requires saved, complete corrections and updates after saving',()=>{
 const record={id:'receipt',grading:{pending:0,savedAt:null}},view=rosterView([record]);
 const roster={className:'Class',assigned:true,students:[{id:'a',name:'Alice',status:'submitted',submissionId:'receipt'}]};
 view.render(roster);assert.doesNotMatch(view.elements.get('rosterRows').innerHTML,/class="graded-check"/);
 record.grading={pending:1,savedAt:'2026-10-19'};
 view.render(roster);assert.doesNotMatch(view.elements.get('rosterRows').innerHTML,/class="graded-check"/);
 record.grading.pending=0;
 view.render(roster);assert.match(view.elements.get('rosterRows').innerHTML,/aria-label="Graded"/);
 const reloaded=rosterView([JSON.parse(JSON.stringify(record))]);reloaded.render(roster);
 assert.match(reloaded.elements.get('rosterRows').innerHTML,/aria-label="Graded"/);
});
test('Answer cards are alphabetical and provide roster link targets',()=>{
 const records=['Amy Zimmer','Zoe Adams','ben Adams'].map((name,i)=>({id:String(i),name,email:'student@example.org',answers:[],grading:{automatic:[],manual:[],feedback:'',baseMax:0,pending:0}}));
 const reports={};
 vm.runInNewContext(source.slice(source.indexOf('function render()'),source.indexOf('function renderSummary()'))+'\nrender();',{
  records,QuizCorrection,questions:[],document:{getElementById:()=>reports},esc:String,scoreText:()=>'',formatResultTime:()=>''
 });
 assert.deepEqual(records.map(r=>r.name),['ben Adams','Zoe Adams','Amy Zimmer']);
 assert.match(reports.innerHTML,/id="submission-2"/);
});
for(const tableId of ['rosterRows','resultsRows'])test('Clicking a name in '+tableId+' opens and focuses the submitted answers',()=>{
 let handler,scrolled=false,focused=false;
 const card={open:false,scrollIntoView(){scrolled=true;},querySelector(){return {focus(){focused=true;}};}};
 vm.runInNewContext(source.slice(source.indexOf("for(const tableId of ['rosterRows','resultsRows'])")),{
  document:{getElementById:id=>['rosterRows','resultsRows'].includes(id)?{addEventListener(type,fn){if(id===tableId)handler=fn;}}:id==='submission-receipt'?card:null}
 });
 let prevented=false;
 handler({target:{closest:()=>({dataset:{submission:'receipt'}})},preventDefault(){prevented=true;}});
 assert.ok(card.open && scrolled && focused && prevented);
});

for(const folder of ['custom','gemara-6-wl-2','gemara-6-intro-retake','gemara-8-intro-retake']) {
 test(`${folder}: email waits for a saved Classroom draft, retries failures, opens the next response, and closes the last`,async()=>{
  const script=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes',folder,'teacher.js'),'utf8');
  let handler,result,requests=0,focused=false,nextFocused=false,scrolled=false;
  const email={name:'emailStudent',disabled:true},buttons=[{name:'sendToClassroom'},email],field={disabled:false},message={};
  const next={open:false,matches:s=>s==='details',scrollIntoView(){scrolled=true;},querySelector:()=>({focus(){nextFocused=true;}})};
  const card={open:true,nextElementSibling:next,querySelector:()=>({focus(){focused=true;}})};
  const form={dataset:{id:'receipt',classroomDraft:'false'},matches:()=>true,reportValidity:()=>true,querySelector:()=>message,querySelectorAll:s=>s==='button'?buttons:[field],elements:{feedback:{value:''}},closest:()=>card};
  const record={id:'receipt',grading:{manual:[]}};
  vm.runInNewContext(script.slice(script.indexOf("document.getElementById('reports').addEventListener('submit'"),script.indexOf("document.getElementById('export').addEventListener")),{
   document:{getElementById:()=>({addEventListener:(type,fn)=>handler=fn})},records:[record],form:{elements:{password:{value:''}}},SUBMISSIONS_API:'/test',QuizCorrection:{overrides:()=>({}),explanations:()=>({})},renderRoster(){},renderSummary(){},currentRoster:{},scoreText:()=>'',
   fetch:async()=>{requests++;assert.equal(field.disabled,true);assert.equal(email.disabled,true);return {ok:true,json:async()=>result};}
  });
  const submit=name=>handler({preventDefault(){},target:form,submitter:{name}});
  await submit('emailStudent');assert.equal(requests,0);
  result={grading:{manual:[],pending:0,classroomDraft:false},classroomError:'Google unavailable'};
  await submit('sendToClassroom');assert.equal(email.disabled,true);assert.equal(card.open,true);assert.equal(field.disabled,false);
  result={grading:{manual:[],pending:0,classroomDraft:true},classroom:{score:8,maxPoints:11}};
  await submit('sendToClassroom');assert.equal(email.disabled,false);assert.equal(card.open,true);assert.match(message.textContent,/Draft grade saved/);assert.doesNotMatch(message.textContent,/mark.*done/);
  result={grading:{manual:[],pending:0,classroomDraft:true},emailError:'Email unavailable'};
  await submit('emailStudent');assert.equal(email.disabled,false);assert.equal(card.open,true);assert.equal(next.open,false);
  result={grading:{manual:[],pending:0,classroomDraft:true},email:{to:'student@school.org'}};
  await submit('emailStudent');assert.equal(card.open,false);assert.equal(next.open,true);assert.equal(nextFocused,true);assert.equal(scrolled,true);assert.equal(focused,false);assert.equal(field.disabled,false);
  card.open=true;card.nextElementSibling=null;
  await submit('emailStudent');assert.equal(card.open,false);assert.equal(focused,true);
 });
}
test('Editing feedback disables email until the updated grading is saved to Classroom',()=>{
 let handler;
 const button={disabled:false},message={},form={dataset:{classroomDraft:'true'},querySelector:s=>s==='[name="emailStudent"]'?button:message};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/correction.js'),'utf8'),{window:{},document:{addEventListener:(type,fn)=>handler=fn}});
 handler({target:{closest:()=>form,matches:selector=>selector==='.correction textarea'}});
 assert.equal(button.disabled,true);assert.equal(form.dataset.classroomDraft,'false');
});

test('Last-name ordering handles ties, comma names, single names, and whitespace',()=>{
 const names=['Amy Zimmer','Zoe Adams','ben Adams','  Ada   Brown  ','Brown, Aaron','Cher'];
 const students=names.map((name,id)=>({name,id:String(id)})).sort(QuizCorrection.compareStudents);
 assert.deepEqual(students.map(s=>s.name),['ben Adams','Zoe Adams','Brown, Aaron','  Ada   Brown  ','Cher','Amy Zimmer']);
 const view=rosterView([]);
 view.render({className:'Class',assigned:true,students:names.map((name,id)=>({name,id:String(id),status:'not-started'}))});
 const html=view.elements.get('rosterRows').innerHTML;
 assert.ok(html.indexOf('ben Adams')<html.indexOf('Zoe Adams'));
 assert.ok(html.indexOf('Zoe Adams')<html.indexOf('Amy Zimmer'));
});

test('Results dropdown includes only classes assigned this quiz, even if the active course list fails',async()=>{
 const assignments=[{quiz:'custom-test',courseId:'6b',className:'Gemara 6B'},{quiz:'other-quiz',courseId:'8a',className:'Gemara 8A'},{quiz:'custom-test',courseId:'6a',className:'Gemara 6A'}];
 for(const failCourses of [false,true]) {
  const result=await initialize({search:'?mode=review',assignments,failCourses});
  assert.deepEqual(result.elements.get('reportClass').options.map(o=>o.value),['','6a','6b']);
 }
 const assigning=await initialize({search:'?mode=assign',assignments});
 assert.ok(!assigning.requests.includes('assignments'));
});


test('Opening student responses scrolls to their beginning after the panels change',()=>{
 const handlers={},frames=[],scrolls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/correction.js'),'utf8'),{
  window:{},document:{addEventListener(type,fn,capture){handlers[type]={fn,capture};}},requestAnimationFrame:fn=>frames.push(fn)
 });
 const card={open:true,isConnected:true,matches:s=>s==='#reports > details.card',scrollIntoView:options=>scrolls.push(options)};
 assert.equal(handlers.toggle.capture,true);
 handlers.toggle.fn({target:card});
 assert.equal(scrolls.length,0);
 frames.shift()();
 assert.equal(scrolls[0].block,'start');assert.equal(scrolls[0].behavior,'instant');
 handlers.toggle.fn({target:card});card.open=false;frames.shift()();
 handlers.toggle.fn({target:card});
 handlers.toggle.fn({target:{...card,open:true,matches:()=>false}});
 assert.equal(scrolls.length,1);assert.equal(frames.length,0);
 card.open=true;handlers.toggle.fn({target:card});card.isConnected=false;frames.shift()();
 assert.equal(scrolls.length,1);
});


for(const fieldName of ['manual9','auto9'])test(`${fieldName}: above-assigned scores require confirmation before saving or sending`,()=>{
 const handlers={},prompts=[];let accept=false,focused=false,stopped=false,prevented=false;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/correction.js'),'utf8'),{
  window:{confirm:message=>{prompts.push(message);return accept;}},document:{addEventListener(type,fn,capture){handlers[type]={fn,capture};}}
 });
 const input={name:fieldName,value:'2',dataset:{max:'1'},validity:{valid:true},focus(){focused=true;}};
 const form={matches:()=>true,querySelectorAll:()=>[input]};
 const event={target:form,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}};
 assert.equal(handlers.submit.capture,true);
 handlers.submit.fn(event);assert.ok(prevented && stopped && focused);assert.match(prompts[0],/Question 10: 2 points awarded; 1 assigned/);
 accept=true;prevented=stopped=false;handlers.submit.fn(event);assert.equal(prevented,false);assert.equal(stopped,false);
 handlers.submit.fn(event);assert.equal(prompts.length,2);
 input.value='3';handlers.submit.fn(event);assert.equal(prompts.length,3);
 input.value='1';handlers.submit.fn(event);assert.equal(prompts.length,3);
 input.value='';handlers.submit.fn(event);assert.equal(prompts.length,3);
});

function resultsView() {
 const elements=new Map();
 const context={questions:[{prompt:'What is <one>?'},{prompt:'שאלה',extraCredit:true},{prompt:'Third'},{prompt:'Fourth'},{prompt:'Fifth'}],records:[{id:'r',name:'Alice Adams',grading:{total:3.5,baseMax:5,pending:1,automatic:[{index:0,score:1,max:1},{index:1,score:0,max:1},{index:2,score:0.5,max:1},{index:4,score:2,max:1}],manual:[{index:3,score:null,max:1}]}}],currentRoster:{students:[{name:'Bob Brown'},{name:'Alice Adams',submissionId:'r'}]},QuizCorrection,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);}}};
 vm.runInNewContext(source.slice(source.indexOf('function resultState('),source.indexOf('function renderRoster(')),context);
 context.renderResultsGrid();return {context,elements};
}
test('Results grid includes roster non-submitters and all grading states, including above-full credit',()=>{
 const {context,elements}=resultsView(),html=elements.get('resultsRows').innerHTML;
 assert.equal((html.match(/<tr>/g)||[]).length,2);
 assert.ok(html.indexOf('Alice Adams')<html.indexOf('Bob Brown'));
 assert.equal((html.match(/data-submission=/g)||[]).length,1);
 assert.match(html,/<a href="#submission-[^"]+" data-submission="[^"]+">Alice Adams<\/a>/);
 assert.match(html,/<th scope="row">Bob Brown<\/th>/);
 for(const state of ['correct','incorrect','partial','pending','missing'])assert.match(html,new RegExp(`data-result="${state}"`));
 assert.equal((html.match(/data-result="correct"/g)||[]).length,2);
 assert.match(html,/0.5 \/ 1/);assert.match(html,/Not submitted/);
 context.records[0].grading.manual[0].score=1;context.renderResultsGrid();
 assert.doesNotMatch(elements.get('resultsRows').innerHTML,/data-result="pending"/);
 context.currentRoster=null;context.renderResultsGrid();
 assert.equal((elements.get('resultsRows').innerHTML.match(/<tr>/g)||[]).length,1);
 context.records=[];context.renderResultsGrid();assert.match(elements.get('resultsRows').innerHTML,/No students or submissions/);
});
test('Question headings expose escaped prompts and show full text on hover, focus, and tap',()=>{
 const {elements}=resultsView(),head=elements.get('resultsHead');
 assert.match(head.innerHTML,/What is &lt;one>/);assert.match(head.innerHTML,/results-bonus/);
 for(const event of ['onmouseover','onfocusin','onclick']) {
  head[event]({target:{closest:()=>({dataset:{question:'1'}})}});
  assert.equal(elements.get('resultsQuestion').textContent,'Question 2 · Extra credit: שאלה');
 }
});

test('Student receipt always shows typed responses as needs correction, even with cached automatic results',()=>{
 const student=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/quiz.js'),'utf8');
 const elements=new Map(),context={previewQuiz:null,clock:null,clearInterval(){},form:{},status:{},isClassTeacher:false,submission:{id:'receipt',answers:[['a'],['b'],['c'],['d'],['e']],automatic:[{index:0,correct:true},{index:1,correct:false},{index:2,correct:true},{index:3,correct:false},{index:4,partial:true}]},questions:[{type:'text',prompt:'Written'},{type:'gaps',wordBank:false,prompt:'Typed ___'},{type:'choice',prompt:'Correct'},{type:'choice',prompt:'Incorrect'},{type:'multi',prompt:'Partial'}],esc:s=>s,document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);}}};
 vm.runInNewContext(student.slice(student.indexOf('function showReceipt()'),student.indexOf('function tick()')),context);context.showReceipt();
 const html=elements.get('answerFeedback').innerHTML;
 assert.equal((html.match(/class="needs-correction">Teacher will correct/g)||[]).length,2);
 for(const kind of ['correct','incorrect','partial'])assert.match(html,new RegExp('class="'+kind+'"'));
 const manual=QuizCorrection.question({prompt:'Typed blank'},0,['wrong'],undefined,{max:1,score:null,modelAnswer:'right'},1);
 assert.match(manual,/data-grade="pending"/);assert.match(manual,/Teacher will correct/);assert.doesNotMatch(manual,/✓ Correct|✕ Incorrect/);
});

test('Student feedback distinguishes correct matches and supplies corrections for wrong matches',()=>{
 const student=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/quiz.js'),'utf8');
 const elements=new Map(),context={previewQuiz:null,clock:null,clearInterval(){},form:{},status:{},isClassTeacher:false,submission:{id:'receipt',answers:[['animal','vehicle']],automatic:[{index:0,correct:false,partial:true,correctAnswers:['animal','building']}]},questions:[{type:'match',prompt:'Match',direction:'ltr',items:['cat','house']}],esc:s=>s,document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);}}};
 vm.runInNewContext(student.slice(student.indexOf('function showReceipt()'),student.indexOf('function tick()')),context);context.showReceipt();
 const html=elements.get('answerFeedback').innerHTML;
 assert.match(html,/cat<\/bdi><\/strong>: ✓ Correct/);assert.match(html,/house<\/bdi><\/strong>: ✕ Incorrect/);
 assert.match(html,/Correct answer: <bdi dir="auto">building/);assert.match(html,/Partial credit/);
});

test('Builder duplicate action converts revised points and clears source identity',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/builder/builder.js'),'utf8');
 const scoring=require('../Penina-Quizzes/custom/scoring'),buttons=new Map();
 const context={structuredClone,QuizScoring:scoring,$:id=>{if(!buttons.has(id))buttons.set(id,{});return buttons.get(id);},render(){},status(){}};
 vm.runInNewContext("let busy=false,dirty=false,quiz={id:'source',owner:'owner',pointsRevision:4,published:true,title:'Test',questions:[{type:'choice',points:4,potentialPoints:5,choices:['A','B'],answer:['B']}]};"+script.slice(script.indexOf("$('duplicate').onclick="),script.indexOf("$('title').oninput=")),context);
 buttons.get('duplicate').onclick();
 const q=vm.runInNewContext('quiz',context);assert.equal(q.id,undefined);assert.equal(q.pointsRevision,undefined);assert.equal(q.published,false);assert.equal(q.questions[0].points,5);assert.equal(q.questions[0].potentialPoints,undefined);
});

test('Question cards and result grid use answer correctness independently of adjusted denominators',()=>{
 const model=require('../lib/quiz-builder-model');
 const q={type:'choice',prompt:'Pick B',points:4,potentialPoints:5,choices:['A','B'],answer:['B']};
 const g=model.grade({questions:[q]},[['B']]),auto=g.automatic[0];
 const html=QuizCorrection.question(q,0,['B'],auto,null,1);
 assert.match(html,/data-grade="correct"/);assert.match(html,/4 \/ 5 points/);assert.match(html,/data-answer-max="4"/);
 const context={};vm.runInNewContext(source.slice(source.indexOf('function resultState('),source.indexOf('function renderResultsGrid(')),context);
 assert.equal(context.resultState(auto),'correct');assert.equal(context.resultState({...auto,score:2,overridden:true,correctnessMax:5}),'partial');
});

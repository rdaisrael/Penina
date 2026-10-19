const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/teacher.js'),'utf8');
const initializer=source.slice(source.indexOf('(async()=>{'),source.indexOf('})();')+5);
async function initialize({search,failCourses=false,configured=true}) {
 const elements=new Map(),requests=[],loaded=[];
 function element(id){if(!elements.has(id))elements.set(id,{options:[{value:''}],value:'',add(option){this.options.push(option);}});return elements.get(id);}
 const context={URLSearchParams,location:{search},Option:class{constructor(label,value){this.label=label;this.value=value;}},document:{getElementById:element,querySelector:()=>({})},connectionStatus:element('connectionStatus'),esc:s=>s,
  accountRequest:async action=>{requests.push(action);if(action==='config')return {configured};if(failCourses)throw Error('Classroom unavailable');return {email:'teacher@school.org',courses:[{id:'active',name:'Active class'}]};},
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
 const context={document,records,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),formatResultTime:s=>s};
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
 const records=['Zoe','Alice','ben'].map((name,i)=>({id:String(i),name,email:'student@example.org',answers:[],grading:{automatic:[],manual:[],feedback:'',baseMax:0,pending:0}}));
 const reports={};
 vm.runInNewContext(source.slice(source.indexOf('function render()'),source.indexOf('function renderSummary()'))+'\nrender();',{
  records,questions:[],document:{getElementById:()=>reports},esc:String,scoreText:()=>'',formatResultTime:()=>''
 });
 assert.deepEqual(records.map(r=>r.name),['Alice','ben','Zoe']);
 assert.match(reports.innerHTML,/id="submission-1"/);
});
test('Clicking a roster name opens and focuses the submitted answers',()=>{
 let handler,scrolled=false,focused=false;
 const card={open:false,scrollIntoView(){scrolled=true;},querySelector(){return {focus(){focused=true;}};}};
 vm.runInNewContext(source.slice(source.indexOf("document.getElementById('rosterRows').addEventListener")),{
  document:{getElementById:id=>id==='rosterRows'?{addEventListener(type,fn){handler=fn;}}:id==='submission-receipt'?card:null}
 });
 let prevented=false;
 handler({target:{closest:()=>({dataset:{submission:'receipt'}})},preventDefault(){prevented=true;}});
 assert.ok(card.open && scrolled && focused && prevented);
});

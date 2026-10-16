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

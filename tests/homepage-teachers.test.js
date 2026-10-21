const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../homepage-teachers.js'),'utf8');
async function view(user,denied=false) {
 const elements=new Map(),events={},calls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,replaceChildren(){this.items=[];},append(item){this.items.push(item);},reset(){},textContent:''});return elements.get(id);};
 vm.runInNewContext(source,{document:{getElementById:element,createElement:()=>({})},window:{addEventListener:(name,fn)=>events[name]=fn},fetch:async url=>{calls.push(url);return url.includes('quiz-account')?{ok:!!user,json:async()=>user}:{ok:!denied,json:async()=>denied?{error:'Denied'}:{teachers:[{userId:1,name:'David',email:user.email}]}};}});
 await events.pageshow();return {elements,events,calls};
}
test('Homepage hides user management for visitors and all other accounts',async()=>{
 for(const user of [null,{userId:2,email:'teacher@example.org'},{userId:1,email:'other@example.org'}]) {
  const v=await view(user);assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.calls.length,1);
 }
});
test('Homepage shows owner management only after the protected directory authorizes access',async()=>{
 const owner={userId:1,email:'disrael@saracademy.org'};
 const denied=await view(owner,true);assert.equal(denied.elements.get('teacher-numbers').hidden,true);
 const v=await view(owner);assert.equal(v.elements.get('teacher-numbers').hidden,false);assert.equal(v.elements.get('teacher-list').items.length,1);
 v.events.pagehide();assert.equal(v.elements.get('teacher-numbers').hidden,true);assert.equal(v.elements.get('teacher-list').items.length,0);
});

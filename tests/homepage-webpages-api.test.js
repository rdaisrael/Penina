const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(user={role:'teacher',userId:2,email:'teacher@example.org'},registered=user,blocked=false){
 const owners=[];const context={module:{exports:{}},require:name=>{
  if(name==='../lib/vocabulary-pages')return {listPages:async id=>{owners.push(id);return [{id:'class',name:'My class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=class'}];}};
  if(name==='../lib/quiz-teachers')return {rejectDeletedSession:async()=>{if(blocked)throw Object.assign(Error('Account blocked'),{status:403});},registered:async()=>registered};
  if(name==='../lib/quiz-account')return {session:()=>{if(!user)throw Object.assign(Error('Sign in'),{status:401});return user;}};
  if(name==='../lib/teacher-apps')return {requireApps:async()=>{throw Object.assign(Error('App not assigned'),{status:403});}};
  throw Error(name);
 }};vm.runInNewContext(fs.readFileSync(require.resolve('../api/vocabulary-pages'),'utf8'),context);
 return {owners,async run(query={action:'my-pages'},method='GET'){
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await context.module.exports({method,query,headers:{},body:{}},res);return res;
 }};
}
test('Own webpage list uses the authenticated owner, ignoring supplied user numbers, without app grants',async()=>{
 const h=harness(),res=await h.run({action:'my-pages',userId:'99',ownerNumber:'99'});
 assert.equal(res.code,200);assert.deepEqual(h.owners,[2]);assert.equal(res.data.pages[0].name,'My class');assert.equal(res.headers['Cache-Control'],'no-store');
});
test('Own webpage list rejects visitors, students, removed registrations and blocked accounts',async()=>{
 for(const h of [harness(null),harness({role:'student',userId:2,email:'student@example.org'}),harness({role:'teacher',userId:2,email:'teacher@example.org'},null),harness({role:'teacher',userId:2,email:'teacher@example.org'},{userId:3}),harness(undefined,undefined,true)]){
  assert([401,403].includes((await h.run()).code));assert.equal(h.owners.length,0);
 }
});
test('Read-only webpage listing does not bypass app permissions for edits or the builder list',async()=>{
 const h=harness();assert.equal((await h.run({},'GET')).code,403);assert.equal((await h.run({action:'my-pages'},'POST')).code,403);assert.equal(h.owners.length,0);
});

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function harness(){
 const data=new Map();let fail=false;
 const add=(path,value)=>data.set(path,JSON.stringify(value));
 const context={module:{exports:{}},Response,require:n=>n==='crypto'?crypto:n==='./quiz-account'?{unseal:JSON.parse}:{
 list:async({prefix,cursor})=>{const all=[...data.keys()].filter(p=>p.startsWith(prefix)),offset=Number(cursor||0);return {blobs:all.slice(offset,offset+1).map(p=>({url:p,pathname:p})),hasMore:offset+1<all.length,cursor:String(offset+1)};},
 get:async url=>({statusCode:200,stream:new Response(data.get(url)).body}),
 del:async urls=>{if(fail && urls.some(u=>u.startsWith('quiz-submissions/')))throw Error('Interrupted');for(const u of urls)data.delete(u);}
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../lib/teacher-content'),'utf8'),context);
 return {data,add,run:()=>context.module.exports.deleteOwnedQuizzes({userId:2,email:'teacher@example.org'}),setFail:v=>fail=v};
}
test('Cleanup discovers Google quizzes, isolates other owners, and remains retryable',async()=>{
 const h=harness(),id='custom-'+'a'.repeat(32),other='custom-'+'b'.repeat(32);
 h.add('quiz-google/teachers/google-id.txt',{email:'teacher@example.org'});
 h.add('quiz-google/teachers/other-id.txt',{email:'other@example.org'});
 const draft='quiz-builder/teachers/'+crypto.createHash('sha256').update('google-id').digest('hex')+'/'+id+'.txt';
 h.add(draft,{id,owner:'google-id'});h.add('quiz-builder/published/'+id+'.txt',{id,owner:'google-id'});
 h.add('quiz-builder/published/'+other+'.txt',{id:other,owner:'other-id'});
 for(const prefix of ['quiz-builder/points/','quiz-submissions/','quiz-corrections/','quiz-attempts/','quiz-practice/','quiz-progress/']){
 h.add(prefix+id+'/entry.txt',{});h.add(prefix+other+'/entry.txt',{});
 }
 h.add('quiz-google/classes/class.txt',{owner:'google-id',quiz:id});h.add('quiz-google/assignment-claims/class.txt',{});
 h.add('quiz-google/classes/other.txt',{owner:'other-id',quiz:other});
 h.setFail(true);await assert.rejects(h.run());assert(h.data.has(draft));assert(h.data.has('quiz-google/teachers/google-id.txt'));
 h.setFail(false);await h.run();
 assert(!h.data.has(draft));assert(!h.data.has('quiz-builder/published/'+id+'.txt'));assert(!h.data.has('quiz-google/classes/class.txt'));
 assert(h.data.has('quiz-google/classes/other.txt'));assert(h.data.has('quiz-builder/published/'+other+'.txt'));
 for(const path of h.data.keys())assert(!path.includes(id));
 await h.run();
});

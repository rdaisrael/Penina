const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function harness(){
 const blobs=new Map();const account={isAccountOwner:req=>req.headers?.cookie==='david',verifyTeacher:()=>false,seal:value=>Buffer.from(JSON.stringify(value)).toString('base64'),unseal:raw=>JSON.parse(Buffer.from(raw,'base64').toString())};
 const ctx={module:{exports:{}},Buffer,fetch:async url=>({ok:blobs.has(url),text:async()=>blobs.get(url)}),require:n=>n==='crypto'?crypto:n==='./quiz-account'?account:{list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p}))}),put:async(p,value,options)=>{if(blobs.has(p)&&!options.allowOverwrite)throw Error('exists');blobs.set(p,value);}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../lib/quiz-teachers'),'utf8'),ctx);
 return {api:ctx.module.exports,blobs,req:(body={},cookie='david')=>({method:'POST',headers:{cookie,origin:'https://www.penina-hebrew.org'},body})};
}
const teacher={userId:2,name:'Second Teacher',email:'second@example.org',password:'2-private',assignmentPassword:'1-AU'};
test('Only David with the assignment code can allocate a number; records persist without exposing verifiers',async()=>{
 const h=harness();
 await assert.rejects(h.api.manage(h.req(teacher,'other')),e=>e.status===403);
 await assert.rejects(h.api.manage(h.req({...teacher,assignmentPassword:'wrong'})),e=>e.status===401);
 const cross=h.req(teacher);cross.headers.origin='https://other.example';await assert.rejects(h.api.manage(cross),e=>e.status===403);
 assert.equal(h.blobs.size,0);
 const result=await h.api.manage(h.req(teacher));assert.equal(result.teachers.length,2);assert.equal(result.teachers[0].name,'David Israel');
 assert(!JSON.stringify(result).includes('hash'));assert(!JSON.stringify(result).includes('private'));
 assert(![...h.blobs.values()][0].includes('second@example.org'));
 assert.equal((await h.api.verify(teacher.email,teacher.password)).userId,2);
 assert.equal(await h.api.verify('wrong@example.org',teacher.password),null);assert.equal(await h.api.verify(teacher.email,'2-wrong'),null);
 await assert.rejects(h.api.manage(h.req({...teacher,email:'new@example.org'})),e=>e.status===409);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:3,password:'3-new'})),e=>e.status===409);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:1,password:'1-no'})),e=>e.status===400);
 await assert.rejects(h.api.manage(h.req({...teacher,userId:3,password:'2-no'})),e=>e.status===400);
 const list=await h.api.manage({method:'GET',headers:{cookie:'david'}});assert.equal(list.teachers.length,2);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function access(user,teacher) {
 const context={module:{exports:{}},require:name=>name==='./quiz-account'?{session:()=>{if(!user)throw Object.assign(Error('Sign in'),{status:401});return user;}}:{registered:async()=>teacher}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'lib/teacher-apps.js'),'utf8'),context);return context.module.exports;
}
const user={role:'teacher',userId:2,email:'teacher@example.org'};
test('New users get exactly the selected apps; owner and legacy accounts keep access',async()=>{
 const api=access(user,{...user,apps:['reader']});
 assert.deepEqual(Array.from(api.appsFor({userId:2,apps:[]})),[]);
 assert.equal(api.appsFor({userId:1,apps:[]}).length,4);assert.equal(api.appsFor({userId:2}).length,4);
 assert.deepEqual(Array.from(api.validateApps(['reader','reader'])),['reader']);
 assert.throws(()=>api.validateApps(['admin']),e=>e.status===400);assert.throws(()=>api.validateApps('reader'),e=>e.status===400);
 await api.requireApps({},['reader']);
 await assert.rejects(api.requireApps({},['quizzes']),e=>e.status===403);
 for(const [session,record] of [[null,user],[{...user,role:'student'},user],[user,null],[user,{...user,userId:3}],[user,{...user,apps:[]}]]) {
  await assert.rejects(access(session,record).requireApps({},['reader']),e=>[401,403].includes(e.status));
 }
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}};}
function gateway(allowed,errorStatus=403) {
 const calls=[],context={module:{exports:{}},process:{cwd:()=>root},require:name=>{
  if(name==='./teacher-apps')return {requireApps:async(req,apps)=>{calls.push(apps);if(!apps.some(id=>allowed.includes(id)))throw Object.assign(Error('Denied'),{status:errorStatus});}};
  if(name==='fs'||name==='path')return require(name);
  if(name.startsWith('../api/'))return (req,res)=>res.status(200).json({handled:name});
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(root,'lib/webapp-gateway.js'),'utf8'),context);return {...context.module.exports,calls};
}
test('Every direct app page checks its app before serving HTML; unauthorized requests cannot read it',async()=>{
 const g=gateway([]);
 for(const [page,[app]] of Object.entries(g.pages)) {
  const denied=response();await g.handle({method:'GET',query:{game:'app-page',page}},denied);
  assert.equal(denied.code,403);assert(!denied.body.includes('id="publish-study-cards-btn"'));
  const accepted=response();await gateway([app]).handle({method:'GET',query:{game:'app-page',page}},accepted);
  assert.equal(accepted.code,200);assert.match(accepted.headers['Cache-Control'],/no-store/);assert(accepted.body.length>100);
 }
 const redirect=response();await gateway([],401).handle({method:'GET',query:{game:'app-page',page:'reader'}},redirect);assert.equal(redirect.code,303);
 const traversal=response();await g.handle({method:'GET',query:{game:'app-page',page:'../../lib/quiz-account.js'}},traversal);assert.equal(traversal.code,404);
});
test('API gateway checks grants before calling generation or vocabulary endpoints',async()=>{
 for(const endpoint of ['generate','translate','vocabulary-workbook','vocabulary-alternatives','sefaria-search','dicta-search']) {
  const result=response();await gateway([]).handle({method:'POST',query:{game:'app-api',endpoint},body:{}},result);assert.equal(result.code,403);
 }
 const denied=response();await gateway(['reader']).handle({query:{game:'app-api',endpoint:'generate'},body:{action:'binyan-worksheet'}},denied);assert.equal(denied.code,403);
 const accepted=response();await gateway(['binyan']).handle({query:{game:'app-api',endpoint:'generate'},body:{action:'binyan-worksheet'}},accepted);assert.equal(accepted.code,200);
});
test('Deployment routes protect app HTML and API aliases before static file handling',()=>{
 const config=require('../vercel.json'),routes=config.routes.slice(0,config.routes.findIndex(r=>r.handle==='filesystem'));
 const first=url=>routes.find(route=>route.src && new RegExp(route.src).test(url));
 for(const url of ['/PeninaPlus-Reader/','/PeninaPlus-Reader/index.html','/PeninaPlus-Reader/bold.html','/PeninaPlus-vocab-builder/','/PeninaPlus-Binyan-Builder/index','/Penina-Quizzes/builder/','/Penina-Quizzes/custom/teacher.html'])assert.match(first(url).dest,/game=app-page/);
 for(const url of ['/api/generate','/api/generate.js','/api/translate/','/api/vocabulary-workbook'])assert.match(first(url).dest,/game=app-api/);
 assert.equal(first('/PeninaPlus-Reader/archive/aoldindex.html').status,404);
 assert.equal(first('/api/Archive/oldgenerate.js').status,404);
 assert.equal(first('/PeninaPlus-vocab-builder/flash-cards/'),undefined);
});
function mailHarness(ok=true,configured=true){
 const calls=[],context={module:{exports:{}},AbortSignal,process:{env:configured?{RESEND_API_KEY:'test',QUIZ_EMAIL_FROM:'penina@example.org'}:{}},require:name=>name==='crypto'?require('node:crypto'):require('../lib/teacher-apps'),fetch:async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return {ok};}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'lib/teacher-welcome-email.js'),'utf8'),context);return {...context.module.exports,calls};
}
test('Welcome email explains the temporary password and required first-login change',async()=>{
 const h=mailHarness(),teacher={userId:2,name:'Teacher',email:'school@example.org',apps:['reader'],mustChangePassword:true,temporaryPassword:'random-temporary-password'};
 await h.sendWelcome(teacher);await h.sendWelcome(teacher);
 assert.deepEqual(Array.from(h.calls[0].body.to),['school@example.org']);
 assert.match(h.calls[0].body.text,/Penina Hebrew Reader/);assert(!h.calls[0].body.text.includes('Vocabulary Builder'));
 assert.match(h.calls[0].body.text,/contact David Israel/);assert.match(h.calls[0].body.text,/Temporary password: random-temporary-password/);assert.match(h.calls[0].body.text,/land directly on the Penina home page/);assert.equal(h.calls[0].headers['Idempotency-Key'],h.calls[1].headers['Idempotency-Key']);
 await assert.rejects(mailHarness(false).sendWelcome(teacher));await assert.rejects(mailHarness(true,false).sendWelcome(teacher));
});


test('An existing signed-in session uses current grants after access is changed',async()=>{
 const teacher={...user,apps:['reader']},api=access(user,teacher),req={};
 await api.requireApps(req,['reader']);teacher.apps=['quizzes'];
 await assert.rejects(api.requireApps(req,['reader']),e=>e.status===403);
 await api.requireApps(req,['quizzes']);teacher.apps=[];
 await assert.rejects(api.requireApps(req,['quizzes']),e=>e.status===403);
});


test('Welcome email has actual line breaks and explicit resend produces a new delivery',async()=>{
 const h=mailHarness(),teacher={userId:2,name:'Teacher',email:'school@example.org',apps:['reader'],mustChangePassword:true,temporaryPassword:'random-temporary-password'};
 await h.sendWelcome(teacher);await h.sendWelcome(teacher,{resend:true});await h.sendWelcome(teacher,{resend:true});
 assert(h.calls[0].body.text.split('\n').length>8);assert(!h.calls[0].body.text.includes('\\n'));
 assert.equal(new Set(h.calls.map(call=>call.headers['Idempotency-Key'])).size,3);
});

test('Welcome resend after password setup does not promise a new temporary password',async()=>{
 const h=mailHarness();await h.sendWelcome({userId:2,name:'Teacher',email:'school@example.org',apps:[],mustChangePassword:false},{resend:true});
 assert.match(h.calls[0].body.text,/existing password has not changed/);assert(!h.calls[0].body.text.includes('Temporary password:'));
});

test('Google sessions bypass Penina password setup but still require assigned app access',async()=>{
 const teacher={...user,apps:['reader'],mustChangePassword:true};
 await access({...user,authMethod:'google'},teacher).requireApps({},['reader']);
 await assert.rejects(access({...user,authMethod:'google'},teacher).requireApps({},['quizzes']),e=>e.status===403);
 for(const authMethod of [undefined,'email','password'])await assert.rejects(access({...user,authMethod},teacher).requireApps({},['reader']),e=>e.status===403);
});
test('Welcome email offers Google Workspace and Penina password choices with separate passwords',async()=>{
 const h=mailHarness();await h.sendWelcome({userId:2,name:'Teacher',email:'teacher@saracademy.org',apps:['reader'],mustChangePassword:true,temporaryPassword:'temporary-example'});
 const text=h.calls[0].body.text;assert.match(text,/school Google Workspace account/);assert.match(text,/do not need to use or change a Penina password/);assert.match(text,/first time you use this method/);assert.match(text,/does not change your Google password/);assert.match(text,/Temporary password: temporary-example/);
});

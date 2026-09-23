const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const app=require('../../PeninaPlus-vocab-builder/offline-study-cards');
module.exports=function liveHarness(){
 const storage=new Map();let now=Date.now();
 const sample=[['סוס','horse',['donkey','camel','goat','sheep']],['בית','house',['garden','street','bridge','store']],['מים','water',['bread','milk','wine','salt']],['ספר','book',['table','chair','door','window']],['אור','light',['darkness','sound','wind','rain']],['דרך','path',['wall','roof','floor','field']],['זמן','time',['place','reason','number','name']],['קול','voice',['color','shape','taste','smell']],['גדול','large',['small','short','narrow','thin']],['חדש','new',['old','broken','empty','heavy']]];
 const cards=sample.map(([term,english,answers])=>({term,english,alternativeAnswers:{english:{term,definition:english,answers}}}));
 const setPath='vocabulary-cards/sixth/demo--'+Buffer.from('Class vocabulary').toString('base64url')+'.html';
 storage.set(setPath,{body:'<script id="peninaCardData" type="application/json">'+JSON.stringify(cards)+'</script>',uploadedAt:new Date(now).toISOString()});
 const blob=p=>({pathname:p,url:'https://blob.test/'+p,uploadedAt:storage.get(p).uploadedAt});
 const blobApi={list:async({prefix,cursor,limit=1000})=>{const matches=[...storage.keys()].filter(k=>k.startsWith(prefix));const start=Number(cursor)||0;return{blobs:matches.slice(start,start+limit).map(blob),hasMore:start+limit<matches.length,cursor:String(start+limit)};},put:async(p,body)=>{if(storage.has(p))throw new Error('Exists');storage.set(p,{body,uploadedAt:new Date(now).toISOString()});return blob(p);}};
 const page={id:'sixth',name:'Demo Class Vocabulary',url:'/PeninaPlus-vocab-builder/flash-cards/?page=sixth'};
 const ctx={module:{exports:{}},Buffer,console,process:{env:{VOCABULARY_PAGE_SECRET:'test-only-secret-not-for-production'}},Date:class extends Date{static now(){return now;}},require:name=>name==='node:crypto'?crypto:name==='@vercel/blob'?blobApi:name==='./vocabulary-pages'?{getPage:async id=>id==='sixth'?page:null,authenticatePage:(_p,p)=>p==='demo'?null:{status:401,error:'Incorrect class editing code.'}}:app,fetch:async url=>{const p=url.replace('https://blob.test/',''),entry=storage.get(p);return{ok:!!entry,text:async()=>entry.body,json:async()=>JSON.parse(entry.body)};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../lib/live-game.js'),'utf8'),ctx);
 async function request(action,body={},auth=''){
  const req={method:action?'POST':'GET',query:{code:body.code},headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:{...body,...(action?{action}:{})}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.body=JSON.parse(JSON.stringify(data));return this;}};
  await ctx.module.exports(req,res);return res;
 }
 const create=()=>request('create',{grade:'sixth',password:'demo',pathnames:[setPath],language:'english',count:5});
 const join=(code,name='AB',joinKey=crypto.randomUUID())=>request('join',{code,name,joinKey});
 return {request,create,join,storage,setPath,page,cards,handler:ctx.module.exports,advance:ms=>{now+=ms;}};
};

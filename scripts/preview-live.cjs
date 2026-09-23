const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
// Local-only preview using sample cards and in-memory storage. Never connects to production.
const root=path.resolve(__dirname,'..');
const game=require(path.join(root,'tests/helpers/live-harness'))();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost:4318');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000){res.writeHead(413);res.end();return;}}
 let body={};try{body=raw?JSON.parse(raw):{};}catch(_){res.writeHead(400);res.end();return;}
 if(url.pathname==='/api/game-scores'){
  const reply={status(n){res.statusCode=n;return this;},setHeader:(k,v)=>res.setHeader(k,v),json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}};
  return game.handler({method:req.method,headers:req.headers,body,query:Object.fromEntries(url.searchParams)},reply);
 }
 if(url.pathname==='/api/flashcard-sets'){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method==='POST'){res.statusCode=body.password==='demo'?200:401;res.end(JSON.stringify(body.password==='demo'?{authenticated:true}:{error:'Use demo as the editing code in this preview.'}));return;}
  if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Set removal is disabled in this preview.'}));return;}
  res.end(JSON.stringify({grade:'sixth',page:game.page,sets:[{title:'Class vocabulary — Demo',pathname:game.setPath,hasGames:true,publishedAt:new Date().toISOString(),url:'#',downloadUrl:'#',printUrl:'#'}]}));return;
 }
 if(url.pathname==='/'){res.writeHead(302,{Location:'/PeninaPlus-vocab-builder/flash-cards/?page=sixth'});res.end();return;}
 let pathname=decodeURIComponent(url.pathname);if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{let data=fs.readFileSync(file);const ext=path.extname(file);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[ext]||'application/octet-stream');if(ext==='.html')data=data.toString().replace('<body>','<body><div style="padding:8px 16px;background:#fff0c9;color:#674912;text-align:center;font:14px system-ui">LOCAL DEMO · Use both tabs on this computer · Teacher editing code: <b>demo</b></div>');res.end(data);}catch(_){res.writeHead(404);res.end('Not found');}
});
server.listen(4318,'127.0.0.1',()=>console.log('Penina Live demo: http://localhost:4318 — teacher code demo. No production data.'));

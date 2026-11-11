/* Local-only demo: storage, account access and AI are mocked; no production requests. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {createHandler}=require('../lib/knowledge-sets');
const {generate}=require('../lib/knowledge-distractors');
const {choiceKey}=require('../PeninaPlus-knowledge-builder/cards');
const pages=[{id:'knowledge-preview',name:'Knowledge Preview Class',url:'/PeninaPlus-vocab-builder/flash-cards/?page=knowledge-preview'}];
const records=new Map();
const vocabularySets=['Plant Vocabulary','Nature Vocabulary'].map((title,i)=>{const pathname=`flash-cards/knowledge-preview/local-${i}.html`,url=`/api/flashcard-sets?grade=knowledge-preview&view=${encodeURIComponent(pathname)}`;return {title,pathname,publishedAt:'2026-11-11T12:00:00Z',url,downloadUrl:url+'&download=1',printUrl:url+'#print',sheetUrl:url+'#sheet',sheetDownloadUrl:url+'#sheet',sheetPrintUrl:url+'#sheet',hasGames:false};});
const knowledge=createHandler({
    requireApps:async()=>({userId:1}),
    pageStore:{getPage:async id=>pages.find(page=>page.id===id),publicPage:page=>page,authorizePage:()=>null},
    storage:{list:async({prefix})=>({blobs:[...records.values()].filter(blob=>blob.pathname.startsWith(prefix)),hasMore:false}),put:async(pathname,content)=>{const blob={pathname,content,url:'mock:'+pathname,uploadedAt:new Date().toISOString()};records.set(blob.url,blob);return blob;},del:async urls=>urls.forEach(url=>records.delete(url))},
    fetch:async url=>({ok:records.has(url),json:async()=>JSON.parse(records.get(url).content)}),
    generate:body=>generate(body,async()=>JSON.stringify({rows:body.rows.map(row=>{
        const pool=body.language==='hebrew'?['יצירת זרעים','שמירה על הגזע','נשיאת מים','משיכת חרקים','קליטת אור','הגנה מפני רוח','יצירת פרחים','ייצור פירות','אחסון מינרלים']:['Producing seeds','Protecting the trunk','Carrying water','Attracting insects','Capturing light','Shielding from wind','Growing flowers','Producing fruit','Storing minerals'];
        const available=pool.filter(value=>![row.definition,row.term,...row.answers].some(answer=>choiceKey(answer)===choiceKey(value)));
        return {id:row.id,cells:row.slots.map((slot,i)=>({slot,answer:available[i]}))};
    })}))
});
http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:4321');
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4000000){res.writeHead(413);res.end();return;}}
    let body={};try{body=raw?JSON.parse(raw):{};}catch(_){res.writeHead(400);res.end();return;}
    const reply={setHeader:(key,value)=>res.setHeader(key,value),status(code){res.statusCode=code;return this;},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));},send(value){res.end(value);}};
    const request={method:req.method,headers:{...req.headers,origin:'https://www.penina-hebrew.org'},query:Object.fromEntries(url.searchParams),body};
    if(url.pathname==='/api/flashcard-sets') {
        if((body.kind || url.searchParams.get('kind'))==='knowledge')return knowledge(request,reply);
        return reply.status(200).json({page:pages.find(page=>page.id===url.searchParams.get('grade')),sets:url.searchParams.get('grade')==='knowledge-preview'?vocabularySets:[],disabledGames:[],excludedWordlists:[],hiddenWordlists:[],wordlistEmphasis:{}});
    }
    if(url.pathname==='/api/vocabulary-pages') {
        if(req.method==='POST') {const name=String(body.name || '').trim();if(!name)return reply.status(400).json({error:'Enter a name.'});const page={id:'preview-'+(pages.length+1),name,url:'/PeninaPlus-vocab-builder/flash-cards/?page=preview-'+(pages.length+1)};pages.push(page);return reply.status(201).json({page});}
        return reply.status(200).json({pages});
    }
    if(url.pathname.startsWith('/api/'))return reply.status(200).json({role:'teacher',userId:1,name:'Local Preview',teachers:[],pages:[]});
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch(_){res.writeHead(400);res.end();return;}
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||!/^\.(?:html|js|css|png|jpg|jpeg|svg|ttf|otf|ico|woff2?)$/.test(path.extname(file))){res.writeHead(404);res.end();return;}
    try{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end('Not found');}
}).listen(4321,'127.0.0.1',()=>console.log('Local Knowledge Builder demo: http://127.0.0.1:4321/PeninaPlus-knowledge-builder/ — all publishing and AI use in-memory mocks.'));

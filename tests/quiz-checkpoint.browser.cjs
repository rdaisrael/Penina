// Local-only integration: real student UI and submission handler, in-memory storage and identity.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const model=require('../lib/quiz-builder-model'),root=path.resolve(__dirname,'..');
const quiz={...model.validateQuiz({title:'Checkpoint regression',durationMinutes:null,forwardOnlyFrom:6,questions:[
    {type:'text',prompt:'Write a word',answer:'hello',points:1},
    {type:'choice',prompt:'Choose a letter',choices:['A','B'],answer:['B'],points:1},
    {type:'multi',prompt:'Choose letters',choices:['A','B','C'],answer:['A','C'],points:1},
    {type:'gaps',prompt:'___ and ___',choices:['one','two'],answer:['one','two'],points:1},
    {type:'order',prompt:'Put in order',choices:['one','two'],answer:['two','one'],points:1},
    {type:'match',prompt:'Match the pair',items:['cat','distractor','extra','unused'],choices:['animal','other'],answer:['animal','','',''],points:1},
    {type:'text',prompt:'Final answer',answer:'done',points:1}
]},true),id:'custom-'+'a'.repeat(32)};
const classId='c'.repeat(32),blobs=new Map(),responses=[],errors=[];
let failCheckpointResponse=false;
const identity={sub:'student',email:'student@example.test',name:'Student',classId,className:'Local class',isClassTeacher:false};
const ctx={module:{exports:{}},Buffer,URL,Date,console,process:{env:{BLOB_READ_WRITE_TOKEN:'local-test-only'}},
    fetch:async url=>({ok:blobs.has(url),text:async()=>blobs.get(url)}),require:name=>{
        if(name==='@vercel/blob')return {
            list:async({prefix})=>({blobs:[...blobs.keys()].filter(p=>p.startsWith(prefix)).map(p=>({pathname:p,url:p}))}),
            put:async(p,value,options)=>{if(!options.allowOverwrite && blobs.has(p))throw Error('exists');blobs.set(p,value);}
        };
        if(name==='./quiz-account')return {requireStudent:async()=>identity,turnInSubmission:async()=>({turnedIn:true})};
        if(name==='./quiz-builder-model')return model;
        if(name==='./quiz-builder')return {published:async()=>quiz};
        if(name.startsWith('../'))return require(path.join(root,'lib',name));
        return require(name);
    }};
vm.runInNewContext(fs.readFileSync(path.join(root,'lib/quiz-custom-submissions.js'),'utf8'),ctx);
const server=http.createServer(async(req,res)=>{
    try {
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname.startsWith('/api/')) {
            let raw='';for await(const chunk of req)raw+=chunk;
            const body=raw?JSON.parse(raw):{};
            res.setHeader('Content-Type','application/json');
            if(url.searchParams.get('game')==='quiz-account')return res.end(JSON.stringify({...identity,...quiz,questions:model.publicQuestions(quiz)}));
            await ctx.module.exports({method:req.method,query:{quiz:quiz.id},body,headers:req.headers},{
                setHeader:(...args)=>res.setHeader(...args),status(code){res.statusCode=code;return this;},
                json(value){
                    responses.push({action:body.action,status:res.statusCode,value:JSON.parse(JSON.stringify(value))});
                    if(body.action==='advance' && failCheckpointResponse){failCheckpointResponse=false;res.statusCode=503;return res.end(JSON.stringify({error:'Temporary connection failure.'}));}
                    res.end(JSON.stringify(value));
                }
            });return;
        }
        let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
        if(!file.startsWith(root+path.sep) || !fs.existsSync(file)){res.statusCode=404;return res.end();}
        res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
        res.end(fs.readFileSync(file));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
    let browser;
    try {
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const origin='http://127.0.0.1:'+server.address().port;
        browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context=await browser.newContext();
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin+'/Penina-Quizzes/custom/?quiz='+quiz.id+'&class='+classId);
        await page.locator('#start').click();await page.locator('[name="q0-0"]').fill('hello');await page.locator('#next').click();
        await page.locator('[name="q1-0"][value="B"]').check();await page.locator('#next').click();
        await page.locator('[data-question="2"] [value="A"]').check();await page.locator('[data-question="2"] [value="C"]').check();await page.locator('#next').click();
        for(const [i,answers] of [[3,['one','two']],[4,['two','one']]]) {
            for(const [j,value] of answers.entries()) {
                await page.locator(`[data-question="${i}"] .drag-word[data-value="${value}"]`).click();
                await page.locator(`[data-question="${i}"] [data-slot="${j}"]`).click();
            }
            await page.locator('#next').click();
        }
        await page.locator('[data-question="5"] [data-term="0"]').click();await page.locator('[data-question="5"] [data-value="animal"]').click();await page.locator('#next').click();
        await page.locator('#checkpointPage').waitFor({state:'visible'});
        // A save can succeed while its response is lost. Retry must restore, not overwrite.
        failCheckpointResponse=true;
        await page.locator('#confirmCheckpoint').click();
        await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Temporary connection failure.'));
        assert.equal(await page.locator('#checkpointPage').isVisible(),true);
        assert.equal(await page.locator('[name="q0-0"]').inputValue(),'hello');
        await page.locator('#confirmCheckpoint').click();
        try {await page.locator('[data-question="6"]').waitFor({state:'visible'});}
        catch(error){console.error('Checkpoint status:',await page.locator('#status').textContent(),'API:',responses,'Errors:',errors);throw error;}
        assert.equal(await page.locator('#previous').isDisabled(),true);
        await page.reload();await page.locator('[data-question="6"]').waitFor({state:'visible'});
        assert.equal(await page.locator('[name="q0-0"]').inputValue(),'hello');
        await page.locator('[name="q6-0"]').fill('done');await page.locator('#next').click();
        await page.locator('#reviewed').check();await page.locator('#submit').click();await page.locator('#receipt').waitFor({state:'visible'});
        const submission=responses.find(r=>r.action==='submit');assert.equal(submission.status,200);
        submission.value.answers[2].sort(); // Checkbox display order is randomized.
        assert.deepEqual(submission.value.answers,[['hello'],['B'],['A','C'],['one','two'],['two','one'],['animal','','',''],['done']]);
        assert.deepEqual(errors,[]);
        console.log('Passed: real checkpoint save, lost-response recovery, all question types, locked navigation, reload, final question and submission.');
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

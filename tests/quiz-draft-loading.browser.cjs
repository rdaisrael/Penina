// Local-only saved-draft workflow. API data stays in memory; external requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const root=path.resolve(__dirname,'..'),model=require('../lib/quiz-builder-model'),vocabulary=require('../lib/quiz-vocabulary');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-draft-loading-'));
const draft={id:'custom-existing',title:'Existing <draft>',published:false,durationMinutes:null,questions:[{type:'text',prompt:'Translate בית.',answer:'house',points:1,direction:'ltr'}],vocabulary:{rows:[{word:'בית',definition:'house',definitionDistractors:['river']}],types:['text'],count:1,autoCount:true,wordBank:true,direction:'ltr'}};
const saved=new Map([[draft.id,draft],['custom-published',{...structuredClone(draft),id:'custom-published',title:'Published quiz',published:true}]]);
let listError=false,loadError=false,loads=0;
const server=http.createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname.startsWith('/api/')){
            let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
            let data={role:'teacher',userId:7,name:'Local Teacher'};
            if(url.searchParams.get('game')==='quiz-builder'){
                if(body.action==='list'){
                    if(listError)throw Error('Library temporarily unavailable. Try again.');
                    data={email:'local@example.test',quizzes:[...saved.values()].map(q=>({id:q.id,title:q.title,published:q.published,count:q.questions.length}))};
                }else if(body.action==='save'){
                    const quiz={...model.validateQuiz(body.quiz),...(body.quiz.vocabulary?{vocabulary:vocabulary.source(body.quiz.vocabulary)}:{}),id:body.id || 'custom-saved',published:false};
                    saved.set(quiz.id,quiz);data={quiz};
                }else if(body.action==='load'){
                    loads++;if(loadError)throw Error('Draft could not be loaded. Try again.');data={quiz:saved.get(body.id)};
                }else throw Error('Unexpected API action: '+body.action);
            }
            res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
        }
        let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
        res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
    }catch(error){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
    let browser;
    try{
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
        browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context=await browser.newContext({viewport:{width:1200,height:900}}),errors=[];
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        const current=()=>page.evaluate(()=>JSON.stringify(quiz));
        const pick=id=>page.locator('[data-draft-id="'+id+'"]');
        await page.goto(origin+'/Penina-Quizzes/builder/');await page.getByText('Connected as local@example.test').waitFor();
        await page.locator('#title').fill('My saved lesson');await page.locator('#add').click();
        await page.locator('[data-field="prompt"]').fill('Explain the lesson.');await page.locator('[data-field="answer"]').fill('My model answer');
        await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();
        const before=await current();await page.reload();await page.getByText('Connected as local@example.test').waitFor();
        await page.locator('#loadDraft').click();await pick('custom-saved').waitFor();
        assert.equal(await page.locator('#draftLibrary button').count(),2,'picker shows drafts only');
        assert.equal(await page.locator('#draftLibrary img').count(),0,'titles are escaped');
        for(const width of [1200,820,390,320]){
            await page.setViewportSize({width,height:900});
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits '+width);
            assert(await page.locator('#draftDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'picker fits '+width);
            await page.screenshot({path:path.join(output,'drafts-'+width+'.png')});
        }
        await pick('custom-saved').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
        assert.equal(await current(),before,'saved content survives reload and picker load');
        assert.equal(await page.locator('#draftDialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'title');
        await page.locator('#title').fill('Keep my unsaved edits');const unsaved=await current(),previousLoads=loads;
        await page.locator('#loadDraftBottom').click();await pick('custom-existing').waitFor();
        page.once('dialog',dialog=>dialog.dismiss());await pick('custom-existing').click();
        assert.equal(await current(),unsaved,'cancelling preserves edits');assert.equal(loads,previousLoads,'cancel never requests another draft');
        loadError=true;page.once('dialog',dialog=>dialog.accept());await pick('custom-existing').click();
        await page.locator('#draftLibraryStatus').filter({hasText:'Draft could not be loaded'}).waitFor();
        assert.equal(await current(),unsaved,'failed load preserves edits');assert.equal(await page.locator('#draftDialog').isVisible(),true);
        loadError=false;page.once('dialog',dialog=>dialog.accept());await pick('custom-existing').click();
        await page.getByText('Draft loaded.',{exact:true}).waitFor();
        assert.equal(await page.locator('#title').inputValue(),draft.title);
        assert.deepEqual(await page.evaluate(()=>quiz.vocabulary),draft.vocabulary,'source table and settings restore');
        listError=true;await page.locator('#loadDraft').click();
        await page.locator('#draftLibraryStatus').filter({hasText:'Library temporarily unavailable'}).waitFor();
        assert.equal(await page.locator('#draftLibrary button').count(),0,'failed refresh leaves no stale selectable drafts');
        listError=false;await page.locator('#refreshDrafts').click();await pick('custom-saved').waitFor();
        await page.keyboard.press('Escape');assert.equal(await page.locator('#draftDialog').isVisible(),false);
        await page.locator('#library [data-id="custom-published"]').click();await page.getByText('Published quiz. Duplicate it to create a revised version.',{exact:true}).waitFor();
        assert.equal(await page.locator('#save').isDisabled(),true,'published quizzes remain locked');
        await page.locator('#loadDraft').click();await pick('custom-saved').click();await page.getByText('Draft loaded.',{exact:true}).waitFor();
        assert.equal(await page.locator('#save').isDisabled(),false,'loading a draft restores editing');
        assert.deepEqual(errors,[]);
        console.log('Passed saved-draft roundtrip, both load buttons, draft filtering, source settings, unsaved-change cancellation, failed loads, refresh retry, published lock, keyboard close/focus, and desktop/mobile layout.');
        console.log('Screenshots: '+output);
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

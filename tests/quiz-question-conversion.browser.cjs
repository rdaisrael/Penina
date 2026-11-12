// Local-only browser regression: all API data is held in memory, and external requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const model=require('../lib/quiz-builder-model'),vocabulary=require('../lib/quiz-vocabulary'),picture=require('../Penina-Quizzes/picture');
const root=path.resolve(__dirname,'..'),output=fs.mkdtempSync(path.join(os.tmpdir(),'penina-question-conversion-'));
const image={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=',alt:'Picture fixture',marker:{x:.3,y:.7}};
const rows=[{word:'בית',definition:'house',definitionDistractors:['river','garden','mountain']},{word:'ספר',definition:'book',definitionDistractors:['chair','door','desk']}];
const choice={type:'choice',prompt:'Which definition best matches “בית”?',answer:['house'],choices:['river','house','garden','mountain'],points:2,scoringMode:'response',direction:'ltr',vocabularyGenerated:true,vocabularyTerms:[{word:'בית',definition:'house'}]};
const written={type:'text',prompt:'Translate “ספר” into English.',answer:'book',points:1,direction:'ltr',vocabularyGenerated:true,vocabularyTerms:[{word:'ספר',definition:'book'}]};
const group=[{type:'text',pictureQuestion:true,prompt:'Name the marked object.',answer:'house',points:1,image:structuredClone(image)}];
picture.addMarker(group,group[0]);group[1].prompt='Name the other marked object.';group[1].answer='book';
let saved={id:'custom-conversion',title:'Conversion regression',published:false,durationMinutes:null,vocabulary:{rows,types:['choice'],count:2,autoCount:true,wordBank:true,direction:'ltr'},questions:[choice,written,{type:'gaps',prompt:'בית means ___.',answer:['house'],choices:['house','river'],points:1},{type:'text',pictureQuestion:true,prompt:'What is marked?',answer:'house',points:3,image:structuredClone(image)},{type:'multi',prompt:'Pick both.',answer:['A','B'],choices:['A','B','C'],points:1},{type:'gaps',prompt:'___ and ___',answer:['house','book'],choices:['house','book'],points:2},...group]};
saved={...saved,...model.validateQuiz(saved),vocabulary:saved.vocabulary};
const server=http.createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname.startsWith('/api/')){
            let raw='';for await(const chunk of req)raw+=chunk;
            const body=raw?JSON.parse(raw):{};let value={role:'teacher',userId:7,email:'local@example.test'};
            if(url.searchParams.get('game')==='quiz-builder'){
                if(body.action==='list')value={email:'local@example.test',quizzes:[{id:saved.id,title:saved.title,count:saved.questions.length,published:saved.published}]};
                else if(body.action==='load')value={quiz:saved};
                else if(body.action==='save'){
                    assert.equal(saved.published,false);
                    saved={...model.validateQuiz(body.quiz),vocabulary:vocabulary.source(body.quiz.vocabulary),id:saved.id,published:false};value={quiz:saved};
                }else throw Error('Unexpected API action: '+body.action);
            }
            res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(value));
        }
        let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
        res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
        res.end(fs.readFileSync(file));
    }catch(error){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
    let browser;
    try{
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const origin='http://127.0.0.1:'+server.address().port;
        assert.equal((await fetch(origin+'/Penina-Quizzes/builder/')).status,200);
        browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context=await browser.newContext({viewport:{width:1200,height:1000}}),errors=[];
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
        page.on('dialog',dialog=>dialog.accept());
        await page.goto(origin+'/Penina-Quizzes/builder/');
        await page.locator('[data-id="custom-conversion"]').click();
        const question=i=>page.locator('#questions [data-index="'+i+'"]');
        const current=i=>page.evaluate(i=>structuredClone(quiz.questions[i]),i);
        async function open(i,type){await question(i).locator('[data-action="change-type"]').click();if(type)await page.locator('#conversionType').selectOption(type);}
        async function apply(){await page.locator('#replaceQuestionType').click();await page.waitForFunction(()=>!document.getElementById('conversionDialog').open);}
        async function saveAndReload(){await page.locator('#save').click();await page.getByText('Draft saved.',{exact:true}).waitFor();await page.reload();await page.locator('[data-id="custom-conversion"]').click();await question(0).waitFor();}
        const original=await current(0);
        assert.equal(await question(4).locator('[data-action="change-type"]').count(),0,'multiple answers cannot convert');
        await open(0,'gaps');
        assert.deepEqual(await page.locator('#conversionType option').evaluateAll(options=>options.map(o=>o.value)),['text','gaps','picture']);
        assert.equal(await page.locator('#conversionPrompt').inputValue(),'The English meaning of “בית” is <<house>>.');
        assert.deepEqual(await current(0),original,'opening a preview is not a mutation');
        await page.locator('#cancelQuestionType').click();assert.deepEqual(await current(0),original,'cancel keeps the original');
        await open(0,'text');await page.locator('#conversionPrompt').fill('Explain <img src=x onerror=alert(1)> in this passage.');
        assert.equal(await page.locator('#conversionPreview img').count(),0,'preview escapes teacher text');
        await apply();assert.equal((await current(0)).type,'text');
        assert.equal((await current(0)).points,original.points);
        await question(0).locator('[data-action="undo-type"]').click();assert.deepEqual(await current(0),original,'undo beside the question restores exact original');
        await open(0,'text');await apply();await saveAndReload();
        assert.deepEqual((await current(0)).conversionDistractors,['river','garden','mountain']);
        assert.equal(await page.locator('#conversionUndo').isVisible(),false,'save clears undo');
        await open(0,'choice');assert.equal(await page.locator('#conversionDistractors').inputValue(),'river\ngarden\nmountain');
        await page.locator('#conversionDistractors').fill('house');assert.equal(await page.locator('#replaceQuestionType').isDisabled(),true);
        await page.locator('#conversionDistractors').fill('river\ncustom wrong answer');await apply();
        assert.deepEqual((await current(0)).choices,['house','river','custom wrong answer']);
        await open(1,'choice');assert.equal(await page.locator('#conversionDistractors').inputValue(),'chair\ndoor\ndesk');await apply();
        assert.deepEqual((await current(1)).answer,['book']);
        await open(2,'text');await apply();assert.equal((await current(2)).answer,'house');
        await open(2,'gaps');await page.locator('#conversionPrompt').fill('<<house>> and <<book>>');
        assert.equal(await page.locator('#replaceQuestionType').isDisabled(),true);
        await page.locator('#conversionPrompt').fill('The English meaning of בית is <<home>>.');await apply();
        assert.deepEqual((await current(2)).answer,['home']);assert.equal((await current(2)).prompt,'The English meaning of בית is ___.');
        await open(0,'picture');
        await page.locator('#conversionPicture').setInputFiles({name:'house.png',mimeType:'image/png',buffer:Buffer.from(image.src.split(',')[1],'base64')});
        await page.locator('#conversionPreview img').waitFor();await page.waitForFunction(()=>!document.getElementById('replaceQuestionType').disabled);
        await page.locator('#conversionPictureAlt').fill('A house');
        for(const width of [1200,390,320]){
            await page.setViewportSize({width,height:1000});
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits at '+width);
            assert(await page.locator('#conversionDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog fits at '+width);
            await page.screenshot({path:path.join(output,'conversion-'+width+'.png')});
        }
        await apply();assert.equal((await current(0)).pictureQuestion,true);assert.equal((await current(0)).image.alt,'A house');
        assert.equal(await question(0).locator('[data-picture-file]').count(),1);
        await page.setViewportSize({width:1200,height:1000});
        await question(0).locator('[data-picture-target]').click();const uploaded=(await current(0)).image;
        assert(uploaded.marker);assert.equal(await page.locator('#conversionUndo').isVisible(),false,'later edit clears undo');
        await open(0,'choice');await apply();assert.deepEqual((await current(0)).image,uploaded,'converting from picture keeps the picture and marker');
        await saveAndReload();assert.deepEqual((await current(0)).image,uploaded);
        await open(5,'text');assert.match(await page.locator('#conversionError').textContent(),/one completed blank/);assert.equal(await page.locator('#replaceQuestionType').isDisabled(),true);
        await page.keyboard.press('Escape');assert.equal(await page.locator('#conversionDialog').isVisible(),false);
        await open(6,'choice');assert.match(await page.locator('#conversionError').textContent(),/Duplicate this question first/);assert.equal(await page.locator('#replaceQuestionType').isDisabled(),true);await page.locator('#cancelQuestionType').click();
        await question(6).locator('[data-action="copy"]').click();await open(7,'choice');await page.locator('#conversionDistractors').fill('river');await apply();
        assert.equal((await current(7)).image.markers,undefined);assert.deepEqual((await current(7)).image.marker,image.marker);
        await saveAndReload();model.validateQuiz(saved,true);
        saved.published=true;await page.reload();await page.locator('[data-id="custom-conversion"]').click();await question(0).waitFor();
        assert.equal(await question(0).locator('[data-action="change-type"]').isDisabled(),true,'published quiz stays locked');
        await page.evaluate(()=>openQuestionConversion(0));assert.equal(await page.locator('#conversionDialog').isVisible(),false);
        assert.deepEqual(errors,[]);
        console.log('Passed: four formats, preview/cancel/apply/undo, edited answers, saved choices, source rows, picture upload/markers, save/reload, unsupported formats, multi-blank and marker-group protection, published lock, and desktop/mobile layout.');
        console.log('Screenshots: '+output);
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

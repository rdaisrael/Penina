// Local-only print QA. No cloud calls; every non-local request is blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),output=process.env.QUIZ_PRINT_OUTPUT || '/tmp/penina-print-qa';
const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')){
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify(url.searchParams.get('game')==='quiz-builder'?{email:'local@example.test',quizzes:[]}:{role:'teacher',name:'Local Teacher',userId:7}));
    }
    let file=path.resolve(root,'.'+url.pathname);if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
    let browser;
    try{
        fs.mkdirSync(output,{recursive:true});
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
        browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context=await browser.newContext({viewport:{width:1200,height:1000}}),errors=[];
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'/Penina-Quizzes/builder/');await page.getByText('Connected as local@example.test').waitFor();
        assert.equal(await page.locator('#printQuiz').isDisabled(),true);
        await page.evaluate(()=>{
            const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;const c=canvas.getContext('2d');
            c.fillStyle='#f5f5ed';c.fillRect(0,0,800,400);c.strokeStyle='#374e41';c.lineWidth=4;
            c.strokeRect(35,35,730,330);c.strokeRect(60,65,190,265);c.strokeRect(280,65,245,265);c.strokeRect(555,65,180,265);
            c.fillStyle='#526b5b';for(let col=0;col<3;col++)for(let row=0;row<9;row++)c.fillRect(80+col*245,88+row*26,140,4);
            const base={points:2,direction:'ltr',scoringMode:'total'};
            quiz={title:'Gemara 6 · Chapter review',durationMinutes:40,questions:[
                {...base,type:'text',prompt:'Why is it helpful to study with a partner? Give one example.',answer:'PRIVATE MODEL ANSWER'},
                {...base,type:'choice',prompt:'Which word means “peace”?',choices:['שלום','אור','ספר','בית'],answer:['שלום']},
                {...base,type:'multi',prompt:'Which habits help us learn together?',choices:['Listen carefully','Explain your thinking','Interrupt your partner','Ask thoughtful questions'],answer:['Listen carefully','Explain your thinking','Ask thoughtful questions']},
                {...base,type:'gaps',prompt:'A good partner will ___ carefully and ask a ___ when something is unclear.',choices:['listen','question','book'],answer:['listen','question']},
                {...base,type:'match',prompt:'Match each Hebrew word to its meaning.',direction:'rtl',items:['ספר','אור','בית','שלום'],choices:['book','light','house','peace','water'],answer:['book','light','house','peace'],scoringMode:'response'},
                {...base,type:'order',prompt:'Put these steps in the order you would use to learn a new passage.',choices:['Read the passage','Discuss its meaning','Summarize what you learned'],answer:['Read the passage','Discuss its meaning','Summarize what you learned']},
                {...base,type:'gaps',prompt:'השלימו את המשפט: אני לומד עם ___ וקורא מתוך ___.',direction:'rtl',wordBank:false,choices:[],answer:['PRIVATE BLANK','PRIVATE BLANK']},
                {...base,type:'text',pictureQuestion:true,pictureResponseMode:'markers',prompt:'Look at the page diagram. Describe the section at each numbered marker.',image:{src:canvas.toDataURL(),alt:'A page with three columns',markers:[{x:.2,y:.4},{x:.5,y:.4},{x:.8,y:.4}]},pictureAnswers:['PRIVATE ONE','PRIVATE TWO','PRIVATE THREE'],answer:'',scoringMode:'response'},
                {...base,type:'text',extraCredit:true,prompt:'מה למדת מהחברותא שלך היום?',direction:'rtl',answer:'PRIVATE HEBREW'}
            ]};dirty=true;render();window.print=()=>{window.printCalls=(window.printCalls||0)+1;};
        });
        const original=await page.evaluate(()=>JSON.stringify(quiz));
        await page.locator('#printQuiz').click();
        assert.equal(await page.locator('#quizPrint .qp-question').count(),9);
        assert.equal(await page.locator('#title').isVisible(),false);
        assert.doesNotMatch(await page.locator('#quizPrint').innerHTML(),/PRIVATE/);
        await page.locator('#printQuizPaper').click();await page.waitForFunction(()=>window.printCalls===1);
        assert.equal(await page.locator('#quizPrint .picture-marker').count(),3);
        const frame=await page.locator('#quizPrint .picture-frame').boundingBox(),img=await page.locator('#quizPrint img').boundingBox();
        assert(Math.abs(frame.width-img.width)<1 && Math.abs(frame.height-img.height)<1,'markers follow the displayed image bounds');
        for(const width of [1200,390,320]){
            await page.setViewportSize({width,height:1000});
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at '+width);
            await page.screenshot({path:path.join(output,'preview-'+width+'.png'),fullPage:width===1200});
        }
        await page.setViewportSize({width:1200,height:1000});
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('.qp-toolbar').isVisible(),false);
        await page.pdf({path:path.join(output,'student-letter.pdf'),format:'Letter',printBackground:false});
        await page.pdf({path:path.join(output,'student-a4.pdf'),format:'A4',printBackground:false});
        await page.emulateMedia({media:'screen'});
        await page.keyboard.press('Escape');assert.equal(await page.locator('#quizPrint').isVisible(),false);
        assert.equal(await page.locator('#printQuiz').evaluate(el=>el===document.activeElement),true);
        assert.equal(await page.evaluate(()=>JSON.stringify(quiz)),original);assert.equal(await page.evaluate(()=>dirty),true);
        assert.equal(await page.title(),'Build a quiz · PP Quiz');
        await page.locator('#title').fill('Updated unsaved title');await page.locator('#printQuiz').click();
        assert.equal(await page.locator('#quizPrint h1').textContent(),'Updated unsaved title');
        await page.locator('#closeQuizPrint').click();await page.evaluate(()=>{quiz.published=true;render();});
        assert.equal(await page.locator('#printQuiz').isEnabled(),true);await page.locator('#printQuiz').click();
        assert.equal(await page.locator('#quizPrint .qp-question').count(),9);
        await page.locator('#closeQuizPrint').click();
        // A question longer than one sheet must flow to subsequent pages without clipping.
        await page.evaluate(()=>{quiz.questions=[{type:'choice',points:1,prompt:'Read every option before answering.',direction:'ltr',choices:Array.from({length:50},(_,i)=>'Long option '+(i+1)+': '+('Read the statement carefully. '.repeat(6))),answer:['Unused key']}];render();});
        await page.locator('#printQuiz').click();await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('.qp-toolbar').isVisible(),false);
        await page.pdf({path:path.join(output,'long-question.pdf'),format:'Letter'});
        assert.deepEqual(errors,[]);
        console.log('Passed: all formats, draft/published printing, unsaved edits, no leaked keys, native print action, image markers, desktop/mobile, Letter/A4, long question, Escape and editor-state recovery. Artifacts: '+output);
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

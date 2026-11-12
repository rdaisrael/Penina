// Local-only popup regression. No requests are allowed outside this fixture server.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {makeStudentApp} = require('../lib/knowledge-publication');
const root = path.resolve(__dirname, '..'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'penina-picture-popup-'));
let studentHtml = '';
const server = http.createServer((req,res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/student.html' || url.pathname === '/fixture.html') {
        res.setHeader('Content-Type','text/html');return res.end(url.pathname === '/student.html' ? studentHtml : '<!doctype html><title>Local image fixtures</title>');
    }
    if (url.pathname.startsWith('/api/')) {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pages:[],role:'teacher',userId:1}));}
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
});
(async () => {
    let browser;
    try {
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const origin='http://127.0.0.1:'+server.address().port;
        browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const context=await browser.newContext({viewport:{width:1200,height:950},hasTouch:true});
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin+'/fixture.html');
        const images=await page.evaluate(()=>[[640,360],[180,900],[1200,180]].map(([width,height])=>{
            const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
            const ctx=canvas.getContext('2d');ctx.fillStyle='#edf3f6';ctx.fillRect(0,0,width,height);
            ctx.fillStyle='#49787c';ctx.fillRect(width*.08,height*.12,width*.32,height*.7);
            ctx.fillStyle='#cdac6d';ctx.beginPath();ctx.ellipse(width*.7,height*.5,width*.2,height*.32,0,0,Math.PI*2);ctx.fill();
            return canvas.toDataURL('image/png');
        }));
        const targets=[{x:.2,y:.3},{x:.2,y:.7},{x:.5,y:.5},{x:.75,y:.3},{x:.75,y:.7}];
        const deck={format:'penina-knowledge-cards',version:1,title:'Picture study',cards:images.map((src,i)=>({id:String(i),question:'Identify the marked parts of the diagram.',answer:'Diagram parts',picture:{src,alt:'Two shapes in a diagram',target:targets[0],...(i<2?{targets}:{})}}))};
        studentHtml=makeStudentApp(deck);
        await page.goto(origin+'/student.html');
        const dialog=page.locator('#picture-dialog'),enlarged=page.locator('#enlarged-picture'),trigger=page.locator('#card-content .picture-button');
        async function checkPopup(expectedCount) {
            const before=await trigger.locator('img').boundingBox();
            await trigger.click();await dialog.waitFor({state:'visible'});
            await enlarged.locator('img').evaluate(img=>img.decode());
            await dialog.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
            const bounds=await enlarged.locator('img').boundingBox();
            const viewport=page.viewportSize(),ratio=before.width/before.height;
            const mobile=await page.evaluate(()=>matchMedia('(max-width: 620px), (max-height: 620px) and (pointer: coarse)').matches);
            const expected=Math.min(mobile?viewport.width-32:before.width*2,viewport.width-32,(viewport.height-80)*ratio);
            assert(Math.abs(bounds.width-expected)<1.5,`expected ${expected}px, got ${bounds.width}px`);
            const popup=await dialog.boundingBox();
            assert(Math.abs(popup.height-bounds.height-44)<1.5,'popup wraps the picture and close button');
            assert(Math.abs(popup.y+popup.height/2-viewport.height/2)<1.5,'popup is centered vertically');
            assert(popup.x>=0 && popup.y>=0 && popup.x+popup.width<=viewport.width+1 && popup.y+popup.height<=viewport.height+1,'popup fits on screen');
            assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1),'popup has no scrolling');
            assert.equal(await dialog.locator('input[type=range], #zoom-fit, #zoom-original').count(),0);
            const labels=await enlarged.locator('.target-marker').allTextContents();
            assert.deepEqual(labels,expectedCount===5?['A','B','C','D','E']:['']);
            for(let i=0;i<expectedCount;i++) {
                const marker=await enlarged.locator('.target-marker').nth(i).boundingBox();
                assert(Math.abs(marker.x+marker.width/2-bounds.x-targets[i].x*bounds.width)<1);
                assert(Math.abs(marker.y+marker.height/2-bounds.y-targets[i].y*bounds.height)<1);
            }
        }
        async function closed() {
            await dialog.waitFor({state:'hidden'});
            await page.waitForFunction(()=>document.activeElement===document.querySelector('#card-content .picture-button'));
            assert.equal(await page.locator('#side-number').textContent(),'1 / 2');
        }
        for(const viewport of [{width:1200,height:950},{width:390,height:844},{width:844,height:390}]) {
            await page.setViewportSize(viewport);
            for(let i=0;i<3;i++) {
                await checkPopup(i<2?5:1);
                if(i===0)await page.screenshot({path:path.join(output,`popup-${viewport.width}.png`)});
                if(viewport.width===390) {
                    const box=await enlarged.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
                }else await enlarged.click();
                await closed();
                await trigger.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'visible'});
                await page.keyboard.press('Escape');await closed();
                await trigger.click();await dialog.waitFor({state:'visible'});
                await page.mouse.click(3,3);await closed();
                await trigger.click();await page.locator('#close-picture').click();await closed();
                await page.locator('#next').click();
            }
        }
        await page.setViewportSize({width:1200,height:950});await checkPopup(5);
        await page.setViewportSize({width:390,height:600});
        await page.waitForFunction(()=>{
            const box=document.querySelector('#picture-dialog').getBoundingClientRect();
            return box.x>=0 && box.y>=0 && box.right<=innerWidth+1 && box.bottom<=innerHeight+1;
        });
        await enlarged.click();await closed();
        await page.emulateMedia({reducedMotion:'reduce'});await trigger.click();
        assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'none');
        await page.keyboard.press('Escape');await closed();
        await page.goto(origin+'/PeninaPlus-knowledge-builder/');
        await page.waitForFunction(()=>!document.querySelector('.app').inert);
        await page.locator('#draft-file').setInputFiles({name:'pictures.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(deck))});
        await page.waitForFunction(()=>document.querySelector('#editor-message').textContent==='Opened 3 cards.');
        await page.locator('nav [data-stage="study"]').click();
        await page.setViewportSize({width:1200,height:950});await checkPopup(5);await enlarged.click();await closed();
        assert.deepEqual(errors,[]);
        console.log('Passed: 2× desktop sizing, screen-fit portrait/landscape phones, tall/wide pictures, all targets, click/tap/outside/Escape/close-button dismissal, focus return, no card flipping, resize, reduced motion, and author/student views.');
        console.log('Screenshots: '+output);
    } finally {
        if(browser)await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});

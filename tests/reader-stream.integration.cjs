// Real loopback HTTP connections and a proxy idle timeout. Provider outputs are
// simulated, so this verifies delivery/recovery, not AI latency or Hebrew quality.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {setTimeout: wait} = require('node:timers/promises');
const {createReaderResponse} = require('../lib/reader-stream');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'api/generate.js'), 'utf8');
const profile = {mode:'complete',words:['ספר'],verbs:[],nouns:[],adjs:[],forms:[]};
const text = 'כותרת\nספר';
const analysis = {text,words:['כותרת','ספר'].map(word => ({word,mastered:false,translation:'book',match:'',form:''})),phrases:[]};
const completed = [], diagnostics = [];
let scenario = 'repair';
function handler() {
    let calls = 0;
    const mode = scenario;
    const context = vm.createContext({module:{exports:{}},process:{env:{DICTA_API_KEY:'local-only'}},AbortSignal,
        console:{info:(...args)=>diagnostics.push(args),error:(...args)=>diagnostics.push(args)},
        require(name) {
            if (name === '../lib/reader-stream') return {createReaderResponse:(req,res)=>createReaderResponse(req,res,{heartbeatMs:100})};
            if (name === '../lib/reader-response') return require('../lib/reader-response');
            if (name === '../lib/dicta-nikkud') return require('../lib/dicta-nikkud');
            if (name === '../lib/openai-text') return {generateOpenAIText: async (_, options) => {
                await wait(900, undefined, {signal:options.signal});
                calls++;
                return JSON.stringify(calls === 1 || mode === 'invalid' ? {...analysis,words:[]} : analysis);
            }};
            throw new Error(name);
        },
        fetch:async()=>{
            if(mode === 'dicta-failure')return Response.json({error:'service unavailable'},{status:503});
            return Response.json({data:[{str:text,sep:true}]});
        }
    });
    vm.runInContext(source, context);
    return async (req,res) => {
        res.status = code => {res.statusCode = code; return res;};
        res.json = data => {res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data));};
        await context.module.exports(req,res);
        completed.push({calls,mode,status:res.statusCode});
    };
}
const origin = http.createServer(async (req,res) => {
    if(req.url === '/api/generate') {
        const body = [];
        for await(const chunk of req)body.push(chunk);
        req.body = JSON.parse(Buffer.concat(body).toString());
        await handler()(req,res); return;
    }
    const filename = path.resolve(repo,'.'+new URL(req.url,'http://local').pathname);
    if(!filename.startsWith(repo+path.sep)){res.writeHead(404);res.end();return;}
    try {
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'};
        res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
        res.end(fs.readFileSync(filename));
    } catch {res.writeHead(404);res.end();}
});
let originPort;
const proxy = http.createServer((req,res) => {
    let idle;
    const upstream = http.request({hostname:'127.0.0.1',port:originPort,path:req.url,method:req.method,headers:req.headers}, incoming => {
        res.writeHead(incoming.statusCode,incoming.headers);
        incoming.on('data',chunk => {resetIdle(); res.write(chunk);});
        incoming.on('end',()=>{clearTimeout(idle);res.end();});
    });
    function resetIdle() {
        clearTimeout(idle);
        idle = setTimeout(()=>{
            if(!res.headersSent){res.writeHead(524,{'Content-Type':'text/html'});res.end('<html>Proxy timed out waiting for origin</html>');}
            else res.destroy();
            upstream.destroy();
        },1250);
    }
    upstream.on('error',()=>{clearTimeout(idle);if(!res.headersSent){res.writeHead(502);res.end();}});
    res.on('close',()=>{clearTimeout(idle);upstream.destroy();});
    resetIdle();req.pipe(upstream);
});
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close = server => new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});

(async()=>{
    let browser;
    try {
        originPort = await listen(origin);
        const port = await listen(proxy), base = `http://127.0.0.1:${port}`;
        // Reproduce successful work lost behind a shorter proxy wait.
        const silent = await fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({prompt:'Analyze',readerVocabulary:profile})});
        assert.equal(silent.status,524);
        assert.match(await silent.text(),/Proxy timed out/);
        await wait(700);
        assert.deepEqual(completed[0],{calls:2,mode:'repair',status:200});

        browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
        const page = await browser.newPage({viewport:{width:1200,height:1000}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        await page.goto(base+'/PeninaPlus-Reader/index.html');
        await page.locator('#vocab-file-a').setInputFiles(path.join(repo,'PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx'));
        await page.waitForFunction(()=>uploadedVocabA!==null);
        await page.locator('#theme').fill('ספר');
        await page.locator('#length').selectOption('custom');
        await page.locator('#custom-length').fill('1');
        await page.locator('#include-worksheet').uncheck();
        const started = Date.now();
        await page.locator('#generate-btn').click();
        await page.waitForFunction(()=>document.getElementById('reader-status').textContent==='Correcting the reading analysis…');
        assert.equal(await page.evaluate(()=>currentRawStory),'','progress must not render an unchecked draft');
        assert.equal(await page.locator('#generate-btn').isDisabled(),true);
        await page.waitForFunction(()=>document.getElementById('reader-status').textContent.startsWith('Reading ready.'));
        assert.ok(Date.now()-started>1250,'successful delivery crosses the proxy idle cutoff');
        assert.equal(await page.evaluate(()=>currentRawStory),text);
        assert.equal(completed.at(-1).calls,2);

        for(const [mode,message] of [['invalid','Word analysis does not match'],['dicta-failure','Hebrew vowel service is temporarily unavailable']]) {
            scenario = mode;
            await page.locator('#include-worksheet').check();
            const previous = completed.length;
            await page.locator('#generate-btn').click();
            await page.waitForFunction(message=>document.getElementById('reader-status').textContent.includes(message),message);
            assert.equal(completed.length,previous+1,'a failed reading must not generate a worksheet');
            assert.equal(await page.evaluate(()=>currentRawStory),text,'previous reading remains available');
            assert.equal(await page.locator('#generate-btn').isEnabled(),true);
            assert.equal(await page.locator('#include-worksheet').isEnabled(),true);
            assert.equal(await page.evaluate(()=>uploadedVocabA!==null),true);
        }
        assert.deepEqual(errors,[]);
        assert.ok(diagnostics.some(entry=>entry[0]==='Reader generation'&&entry[1].stage==='analysis-repair'));
        console.log('Passed: silent request loses a successful result; progress delivers the same checked result through a real idle-timeout proxy, with repair/Dicta errors and previous reading retained.');
    } finally {
        await browser?.close();
        await close(proxy);await close(origin);
    }
})().catch(error=>{console.error(error);process.exitCode=1;});

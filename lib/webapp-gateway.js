const {requireApps}=require('./teacher-apps');
const pages={
    reader:['reader','PeninaPlus-Reader/index.html'],
    'reader-bold':['reader','PeninaPlus-Reader/bold.html'],
    'reader-original':['reader','Penina-Reader/index.html'],
    vocabulary:['vocabulary','PeninaPlus-vocab-builder/index.html'],
    binyan:['binyan','PeninaPlus-Binyan-Builder/index.html'],
    'quiz-builder':['quizzes','Penina-Quizzes/builder/index.html'],
    'quiz-custom':['quizzes','Penina-Quizzes/custom/teacher.html'],
    'quiz-sixth':['quizzes','Penina-Quizzes/gemara-6-wl-2/teacher.html'],
    'quiz-sixth-retake':['quizzes','Penina-Quizzes/gemara-6-intro-retake/teacher.html'],
    'quiz-eighth-retake':['quizzes','Penina-Quizzes/gemara-8-intro-retake/teacher.html']
};
const endpoints={
    generate:()=>require('../api/generate'),translate:()=>require('../api/translate'),
    'vocabulary-workbook':()=>require('../api/vocabulary-workbook'),
    'vocabulary-alternatives':()=>require('../api/vocabulary-alternatives'),
    'sefaria-search':()=>require('../api/sefaria-search'),'dicta-search':()=>require('../api/dicta-search')
};
function withAccountBar(html) {
    const accountBar=`<style>#penina-app-account{position:fixed;top:12px;right:16px;z-index:10000;display:grid;justify-items:end;gap:0;padding:10px 14px;background:rgba(255,255,255,.96);border:1px solid #d8c79d;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);font:14px/1.4 Arial,sans-serif;color:#302c25}#penina-app-account button{justify-self:end;padding:2px 0;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}#penina-app-account button:disabled{opacity:.6}#penina-app-account [role=status]{max-width:280px;color:#8a2d22}</style><aside id="penina-app-account" aria-label="Signed-in account"><span id="penina-app-greeting">Checking your account…</span><button id="penina-app-logout" type="button" hidden>Log Out</button><span id="penina-app-account-status" role="status"></span></aside><script>(()=>{const box=document.getElementById('penina-app-account'),greeting=document.getElementById('penina-app-greeting'),logout=document.getElementById('penina-app-logout'),status=document.getElementById('penina-app-account-status');const title=/^(mr|mrs|ms|miss|mx|dr|prof|professor|rabbi|rav|reb|rebbe|rebbetzin|rebbitzen|morah|mora|moreh|chazzan|cantor)\\.?$/i;function displayName(value){const parts=String(value||'').trim().split(/\\s+/).filter(Boolean);if(!parts.length)return '';return title.test(parts[0])&&parts.length>1?parts[0]+' '+parts[parts.length-1]:parts[0]}fetch('/api/game-scores?game=quiz-account&action=teacher',{cache:'no-store',credentials:'same-origin'}).then(async response=>{if(!response.ok)throw Error('Your sign-in could not be confirmed.');const user=await response.json();const name=displayName(user.name);greeting.textContent='Welcome'+(name?' '+name:'');logout.hidden=false;}).catch(()=>{greeting.textContent='';box.hidden=true;});logout.addEventListener('click',async()=>{logout.disabled=true;status.textContent='';try{const response=await fetch('/api/game-scores?game=quiz-account&action=logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});if(!response.ok)throw Error('Could not log out. Please try again.');location.assign('/');}catch(error){status.textContent=error.message;logout.disabled=false;}});})();</script><script src="/session-idle.js" defer></script>`;
    return html.replace(/<body(\s[^>]*)?>/i,match=>match+'<script defer src="/return-to-penina.js"></script>'+accountBar);
}
async function handle(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    try {
        if(req.query.game==='app-page') {
            const page=Object.hasOwn(pages,req.query.page)?pages[req.query.page]:null;
            if(!page)return res.status(404).end();
            if(!['GET','HEAD'].includes(req.method))return res.status(405).end();
            await requireApps(req,[page[0]]);
            res.setHeader('Content-Type','text/html; charset=utf-8');
            const html=require('fs').readFileSync(require('path').join(process.cwd(),page[1]),'utf8');
            return res.status(200).send(req.method==='HEAD'?'':withAccountBar(html));
        }
        const endpoint=req.query.endpoint;
        if(!Object.hasOwn(endpoints,endpoint))return res.status(404).json({error:'Unknown app endpoint.'});
        const allowed=endpoint==='generate'?(req.body?.action==='binyan-worksheet'?['binyan']:['reader','vocabulary']):endpoint==='translate'?['reader','vocabulary','binyan']:['vocabulary'];
        await requireApps(req,allowed);
        return endpoints[endpoint]()(req,res);
    } catch(error) {
        if(req.query.game==='app-page') {
            if(error.status===401){res.setHeader('Location','/');return res.status(303).end();}
            res.setHeader('Content-Type','text/html; charset=utf-8');
            return res.status(error.status || 503).send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Webapp access · Penina</title><main><h1>This webapp is not available to your account</h1><p>Contact David Israel to request access.</p><a href="/">Return to Penina Home</a></main></html>');
        }
        return res.status(error.status || 503).json({error:error.status?error.message:'App access could not be checked. Please try again.'});
    }
}
module.exports={handle,pages,withAccountBar};

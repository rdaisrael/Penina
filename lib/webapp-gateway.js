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
async function handle(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    try {
        if(req.query.game==='app-page') {
            const page=Object.hasOwn(pages,req.query.page)?pages[req.query.page]:null;
            if(!page)return res.status(404).end();
            if(!['GET','HEAD'].includes(req.method))return res.status(405).end();
            await requireApps(req,[page[0]]);
            res.setHeader('Content-Type','text/html; charset=utf-8');
            return res.status(200).send(req.method==='HEAD'?'':require('fs').readFileSync(require('path').join(process.cwd(),page[1]),'utf8'));
        }
        const endpoint=req.query.endpoint;
        if(!Object.hasOwn(endpoints,endpoint))return res.status(404).json({error:'Unknown app endpoint.'});
        const allowed=endpoint==='generate'?(req.body?.action==='binyan-worksheet'?['binyan']:['reader','vocabulary']):endpoint==='translate'?['reader','vocabulary','binyan']:['vocabulary'];
        await requireApps(req,allowed);
        return endpoints[endpoint]()(req,res);
    } catch(error) {
        if(req.query.game==='app-page') {
            if(error.status===401){res.setHeader('Location','/Penina-Quizzes/teacher/');return res.status(303).end();}
            res.setHeader('Content-Type','text/html; charset=utf-8');
            return res.status(error.status || 503).send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Webapp access · Penina</title><main><h1>This webapp is not available to your account</h1><p>Contact David Israel to request access.</p><a href="/">Return to Penina Home</a></main></html>');
        }
        return res.status(error.status || 503).json({error:error.status?error.message:'App access could not be checked. Please try again.'});
    }
}
module.exports={handle,pages};

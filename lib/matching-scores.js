const { list, put } = require('@vercel/blob');
const { getPage } = require('../lib/vocabulary-pages');
const { practiceRows } = require('../PeninaPlus-vocab-builder/offline-study-cards');
async function boards(grade) {
    const prefix=`matching-scores/${grade}/`, groups=new Map();
    let cursor;
    do {
        const result=await list({prefix,cursor,limit:1000});
        for(const blob of result.blobs){
            const match=blob.pathname.slice(prefix.length).match(/^([A-Za-z0-9_-]+)\/(english|hebrew)\/(\d{8})-([A-Z]{1,3})-([a-zA-Z0-9-]{10,80})\.json$/);
            if(!match)continue;
            const pathname=Buffer.from(match[1],'base64url').toString('utf8');
            if(!pathname.startsWith(`vocabulary-cards/${grade}/`))continue;
            const key=match[1]+'/'+match[2];
            if(!groups.has(key))groups.set(key,{pathname,language:match[2],scores:[]});
            groups.get(key).scores.push({milliseconds:Number(match[3]),initials:match[4],runId:match[5],date:blob.uploadedAt});
        }
        cursor=result.hasMore?result.cursor:undefined;
    }while(cursor);
    return [...groups.values()].map(group=>{
        const seen=new Set();
        group.scores.sort((a,b)=>a.milliseconds-b.milliseconds||String(a.date).localeCompare(String(b.date)));
        group.scores=group.scores.filter(score=>{if(seen.has(score.runId))return false;seen.add(score.runId);return true;}).slice(0,3).map(({initials,milliseconds})=>({initials,milliseconds}));
        return group;
    });
}
module.exports=async function(req,res){
    res.setHeader('Cache-Control','no-store');
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
    const grade=String(req.query?.grade||'');
    if(!/^[a-z0-9-]{1,80}$/.test(grade))return res.status(400).json({error:'Choose a class.'});
    try{
        if(!await getPage(grade))return res.status(404).json({error:'Class not found.'});
        if(req.method==='POST'){
            const {initials,milliseconds,language,matched,runId}=req.body||{},pathname=String(req.query?.set||'');
            if(typeof initials!=='string'||!/^[A-Z]{1,3}$/.test(initials)||!Number.isInteger(milliseconds)||milliseconds<1||milliseconds>86400000||!['english','hebrew'].includes(language)||!Number.isInteger(matched)||matched<1||typeof runId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(runId)||!pathname.startsWith(`vocabulary-cards/${grade}/`))return res.status(400).json({error:'Enter 1–3 initials and a valid completed-game time.'});
            const found=await list({prefix:pathname,limit:1});const blob=found.blobs.find(blob=>blob.pathname===pathname);
            if(!blob)return res.status(404).json({error:'This vocabulary set is no longer published.'});
            const response=await fetch(blob.url);if(!response.ok)throw new Error('Set unavailable');
            const html=await response.text();const data=html.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)||html.match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
            if(!data||practiceRows(JSON.parse(data[1]),language).length!==matched)return res.status(400).json({error:'Complete every term in the current vocabulary set before submitting.'});
            const target=`matching-scores/${grade}/${Buffer.from(pathname).toString('base64url')}/${language}/${String(milliseconds).padStart(8,'0')}-${initials}-${runId}.json`;
            try{await put(target,JSON.stringify({initials,milliseconds}),{access:'public',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}
            catch(error){const existing=await list({prefix:target,limit:1});if(!existing.blobs.some(blob=>blob.pathname===target))throw error;}
        }
        return res.status(200).json({boards:await boards(grade)});
    }catch(error){console.error('Matching leaderboard:',error);return res.status(503).json({error:'The class board is temporarily unavailable. Please try again.'});}
};

const {listPages, createPage, teacherNumber, getPage, authenticatePage, rememberOwner} = require('../lib/vocabulary-pages');
const teachers = require('../lib/quiz-teachers');
module.exports = async function(req,res) {
    res.setHeader('Cache-Control','no-store');
    try {
        if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method Not Allowed'});
        if ((req.query?.action || req.body?.action)==='teachers') return res.status(200).json(await teachers.manage(req));
        let user;
        if ((req.headers?.cookie || '').includes('__Host-penina-quiz-session=')) {
            user=require('../lib/quiz-account').session(req);
        }
        const ownerNumber=user?.role==='teacher' ? (user.userId || 0) : null;
        if(req.method==='GET') return res.status(200).json({pages:await listPages(ownerNumber)});
        if(req.body?.action==='claim') {
            if(!ownerNumber || teacherNumber(req.body.password)!==ownerNumber) return res.status(403).json({error:'Sign in and use a publishing password beginning with your teacher number.'});
            if(req.headers?.origin!=='https://www.penina-hebrew.org') return res.status(403).json({error:'Open the vocabulary builder on Penina.'});
            const page=await getPage(req.body.pageId);
            if(!page)return res.status(404).json({error:'That webpage was not found.'});
            const denied=authenticatePage(page,req.body.password);
            if(denied)return res.status(denied.status).json({error:denied.error});
            await rememberOwner(page,req.body.password);
            return res.status(200).json({ok:true});
        }
        if(!teachers.checkCode(req.body?.creationPassword,'create')) return res.status(401).json({error:'The webpage creation password is incorrect.'});
        if(ownerNumber!==null && teacherNumber(req.body?.password)!==ownerNumber) return res.status(403).json({error:'Use a publishing password beginning with your own teacher number.'});
        const result=await createPage(req.body?.name,req.body?.password);
        return res.status(result.status).json(result.error?{error:result.error}:{page:result.page});
    }catch(error){return res.status(error.status || 500).json({error:error.status?error.message:'The webpage could not be saved or loaded. Please try again.'});}
};

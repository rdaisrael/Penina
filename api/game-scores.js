const asteroids = require('../lib/asteroids-scores');
const flappy = require('../lib/flappy-scores');
const matching = require('../lib/matching-scores');

// Share one serverless function so both class boards fit within the hosting limit.
module.exports = async function (req, res) {
    const game = typeof req.query?.game==='string'?req.query.game:'';
    const accountAction=req.query?.action || req.body?.action;
    const changingIdentity=game==='quiz-account' && ['login','callback','logout','config','email-login','email-verify'].includes(accountAction);
    try { if((req.headers?.cookie || '').includes('__Host-penina-quiz-session=')){if(!changingIdentity)await require('../lib/quiz-teachers').rejectDeletedSession(req);require('../lib/quiz-account').touchSession(req,res);} }
    catch(error) { res.setHeader('Cache-Control','no-store'); return res.status(error.status || 503).json({error:error.status?error.message:'Teacher access could not be checked. Please try again.'}); }
    if(game==='app-page' || game==='app-api')return require('../lib/webapp-gateway').handle(req,res);
    // Match the action source used by each downstream handler; query strings must not mask body actions.
    const action=game==='quiz-account'?accountAction:req.body?.action;
    const quizAction=game==='quiz-builder' || (game.startsWith('assessment') && ['report','correct'].includes(action)) || (game==='quiz-account' && ['assignments','archive-assignment','publish-assignment','courses','assign'].includes(action));
    if(quizAction || (game==='live' && action==='create')) {
        try {await require('../lib/teacher-apps').requireApps(req,[quizAction?'quizzes':'vocabulary']);}
        catch(error){res.setHeader('Cache-Control','no-store');return res.status(error.status || 503).json({error:error.status?error.message:'App access could not be checked.'});}
    }

    if (game === 'quiz-builder') return require('../lib/quiz-builder').handle(req,res);
    if (game === 'assessment-custom') return require('../lib/quiz-custom-submissions')(req,res);
    if (game === 'quiz-account') return require('../lib/quiz-account').handle(req, res);
    if (game === 'assessment-retake-8') return require('../lib/quiz-retake-8-submissions')(req, res);
    if (game === 'assessment-retake') return require('../lib/quiz-retake-submissions')(req, res);
    if (game === 'assessment') return require('../lib/quiz-submissions')(req, res);
    if (game === 'live') return require('../lib/live-game')(req, res);
    if (game === 'asteroids') return asteroids(req, res);
    if (game === 'snowblaster') return require('../lib/snowblaster-scores')(req, res);
    if (game === 'flappy') return flappy(req, res);
    if (game === 'matching') return matching(req, res);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Choose an existing game leaderboard.' });
};

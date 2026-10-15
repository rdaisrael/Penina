const asteroids = require('../lib/asteroids-scores');
const flappy = require('../lib/flappy-scores');
const matching = require('../lib/matching-scores');

// Share one serverless function so both class boards fit within the hosting limit.
module.exports = function (req, res) {
    const game = req.query?.game;
    if (game === 'quiz-builder') return require('../lib/quiz-builder').handle(req,res);
    if (game === 'assessment-custom') return require('../lib/quiz-custom-submissions')(req,res);
    if (game === 'quiz-account') return require('../lib/quiz-account').handle(req, res);
    if (game === 'assessment-retake-8') return require('../lib/quiz-retake-8-submissions')(req, res);
    if (game === 'assessment-retake') return require('../lib/quiz-retake-submissions')(req, res);
    if (game === 'assessment') return require('../lib/quiz-submissions')(req, res);
    if (game === 'live') return require('../lib/live-game')(req, res);
    if (game === 'asteroids') return asteroids(req, res);
    if (game === 'flappy') return flappy(req, res);
    if (game === 'matching') return matching(req, res);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Choose an existing game leaderboard.' });
};

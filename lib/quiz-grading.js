const {validOverrides,applyOverrides}=require('./quiz-score-overrides');
// Copied from the checked correct options in the BookWidgets teacher editor.
// Keep the key server-side; the authenticated teacher report and accepted submission feedback receive it.
const ANSWERS = {
    0: 'Rabbi from the time of the Mishnah',
    1: 'Here',
    3: 'Sunrise',
    4: 'Mid-day',
    6: 'Until',
    7: 'Sunset',
    8: 'First part',
    9: 'הַתָּם',
    10: 'סֵיפָא',
    11: 'קְבַע'
};
const MANUAL = [{index:2,max:1},{index:5,max:1},{index:12,max:2},{index:13,max:2}];
function validCorrections(scores) {
    return Array.isArray(scores) && scores.length === MANUAL.length
        && scores.every((score,i)=>score === null || (typeof score === 'number' && Number.isFinite(score)
            && score >= 0 && Number.isInteger(score*2)));
}
function grade(answers, correction = {}) {
    const automatic = Object.entries(ANSWERS).map(([index,correctAnswer])=>({index:Number(index),correctAnswer,score:answers[Number(index)]?.[0] === correctAnswer ? 1 : 0,max:1}));
    applyOverrides(automatic,correction.overrides,correction.explanations);
    const scores = validCorrections(correction.scores) ? correction.scores : MANUAL.map(()=>null);
    const automaticScore = automatic.reduce((total,q)=>total+q.score,0);
    const pending = scores.filter(s=>s===null).length;
    const earnedSoFar = automaticScore + scores.reduce((total,s)=>total+(s??0),0);
    return {automatic,automaticScore,automaticMax:10,manual:MANUAL.map((q,i)=>({...q,score:scores[i],explanation:correction.explanations?.[q.index] || ''})),pending,
        earnedSoFar,total:pending ? null : earnedSoFar,baseMax:12,extraMax:4,feedback:correction.feedback || '',savedAt:correction.savedAt || null,classroomDraft:correction.classroomDraft===true,lmsSentAt:correction.lmsSentAt || null,studentSentAt:correction.studentSentAt || null};
}
module.exports = {grade,validCorrections,validOverrides};

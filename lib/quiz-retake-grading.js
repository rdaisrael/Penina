const {validOverrides,applyOverrides}=require('./quiz-score-overrides');
'use strict';
// Transcribed from the checked BookWidgets teacher answer key.
// Ordering arrays are in Hebrew reading order: the first item belongs on the right.
const KEY = {
    1:['בָּרָיְתָא','מִשְׁנָה','גְּמָרָא'],
    2:['דְּרַבָּנַן','דְּאוֹרָיְתָא'],
    3:['מֹשֶׁה','יְהוֹשֻׁעַ','זְקֵנִים','נְבִיאִים','אַנְשֵׁי כְּנֶסֶת הַגְּדוֹלָה'],
    4:['זְרָעִים','מוֹעֵד','נָשִׁים','נְזִיקִין','קַדְּשִׁים','טְהֹרוֹת']
};
const MANUAL=[{index:0,max:2},{index:5,max:1}];
function validCorrections(scores) {
    return Array.isArray(scores) && scores.length===2 && scores.every((score,i)=>score===null ||
        typeof score==='number' && Number.isFinite(score) && score>=0 && Number.isInteger(score*2));
}
function grade(answers,correction={}) {
    const automatic=Object.entries(KEY).map(([key,expected])=>{
        const index=Number(key),values=answers[index] || [],max=index===2?2:1;
        let score;
        if(index===1)score=values.length===expected.length && new Set(values).size===values.length && expected.every(v=>values.includes(v))?1:0;
        else if(index===2)score=expected.reduce((n,v,i)=>n+(values[i]===v?1:0),0);
        else score=values.length===expected.length && expected.every((v,i)=>values[i]===v)?1:0;
        return {index,score,max,correctAnswer:expected.join(index>=3?' ← ':'; ')};
    });
    applyOverrides(automatic,correction.overrides,correction.explanations);
    const scores=validCorrections(correction.scores)?correction.scores:MANUAL.map(()=>null);
    const automaticScore=automatic.reduce((n,q)=>n+q.score,0),pending=scores.filter(s=>s===null).length;
    const earnedSoFar=automaticScore+scores.reduce((n,s)=>n+(s??0),0);
    return {automatic,automaticScore,automaticMax:5,manual:MANUAL.map((q,i)=>({...q,score:scores[i],explanation:correction.explanations?.[q.index] || ''})),pending,
        earnedSoFar,total:pending?null:earnedSoFar,baseMax:8,extraMax:0,feedback:correction.feedback || '',savedAt:correction.savedAt || null,classroomDraft:correction.classroomDraft===true,lmsSentAt:correction.lmsSentAt || null,studentSentAt:correction.studentSentAt || null};
}
module.exports={grade,validCorrections,validOverrides};

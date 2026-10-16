const {validOverrides,applyOverrides}=require('./quiz-score-overrides');
'use strict';
function fail(message) { const error=new Error(message);error.status=400;throw error; }
const TYPES=['text','choice','multi','gaps','order'];
function validateQuiz(input,publish=false) {
    if(!input || typeof input.title!=='string' || !input.title.trim() || input.title.length>160)fail('Enter a quiz title (up to 160 characters).');
    if(!Array.isArray(input.questions) || input.questions.length>100 || (publish && !input.questions.length))fail('Add between 1 and 100 questions before publishing.');
    const durationMinutes=input.durationMinutes===null?null:Number(input.durationMinutes);
    if(durationMinutes!==null && (!Number.isInteger(durationMinutes) || durationMinutes<1 || durationMinutes>1000))fail('Choose no time limit or set 1–1,000 minutes.');
    const forwardOnlyFrom=input.forwardOnlyFrom ?? null;
    if(forwardOnlyFrom!==null && (!Number.isInteger(forwardOnlyFrom) || forwardOnlyFrom<1 || forwardOnlyFrom>=input.questions.length))fail('Place the review checkpoint before question 2 or a later question.');
    const checkpointMessage=input.checkpointMessage ?? 'Review your previous answers now. Beginning with the next question, you cannot return to previous questions. The rest of this quiz goes forward only.';
    if(typeof checkpointMessage!=='string' || checkpointMessage.length>2000 || (forwardOnlyFrom!==null && !checkpointMessage.trim()))fail('Enter a checkpoint message (up to 2,000 characters).');
    const questions=input.questions.map((q,i)=>{
        const prefix='Question '+(i+1)+': ';
        if(!q || !TYPES.includes(q.type))fail(prefix+'choose a question type.');
        if(typeof q.prompt!=='string' || q.prompt.length>5000 || (publish && !q.prompt.trim()))fail(prefix+'enter a question (up to 5,000 characters).');
        const scoringMode=q.scoringMode ?? 'total';
        if(!['total','response'].includes(scoringMode))fail(prefix+'choose points per total question or per correct response.');
        const allowHalfCredit=q.allowHalfCredit===true;
        if(q.allowHalfCredit!==undefined && typeof q.allowHalfCredit!=='boolean')fail(prefix+'choose whether half credit is allowed.');
        if(!allowHalfCredit && (!Number.isInteger(q.points) || q.points<1))fail(prefix+'use whole points, or check Allow half credit to use half points.');
        if(typeof q.points!=='number' || !Number.isFinite(q.points) || q.points<0.5 || q.points>100 || !Number.isInteger(q.points*2))fail(prefix+'points must be 0.5–100, in half-point steps.');
        const result={type:q.type,prompt:q.prompt,points:q.points,allowHalfCredit,scoringMode,direction:q.direction==='rtl'?'rtl':'ltr'};
        if(q.type==='text') {
            if(typeof q.answer!=='string' || q.answer.length>5000)fail(prefix+'the model answer is too long.');
            return {...result,answer:q.answer};
        }
        if(!Array.isArray(q.choices) || q.choices.length>50 || !q.choices.every(c=>typeof c==='string' && c.length<=500))fail(prefix+'use at most 50 choices, each up to 500 characters.');
        if(publish && (q.choices.length<2 || q.choices.some(c=>!c.trim()) || new Set(q.choices).size!==q.choices.length))fail(prefix+'enter at least two distinct, nonempty choices.');
        if(!Array.isArray(q.answer) || q.answer.length>50 || !q.answer.every(c=>typeof c==='string' && c.length<=500))fail(prefix+'enter an answer key.');
        result.choices=q.choices;result.answer=q.answer;
        if(publish) {
            if(!q.answer.length || !q.answer.every(a=>q.choices.includes(a)))fail(prefix+'select correct answers from the choices.');
            if(q.type==='choice' && q.answer.length!==1)fail(prefix+'choose one correct answer.');
            if(q.type==='multi' && new Set(q.answer).size!==q.answer.length)fail(prefix+'remove duplicate correct answers.');
            if(q.type==='order' && (q.answer.length!==q.choices.length || new Set(q.answer).size!==q.choices.length))fail(prefix+'put every choice in the correct order.');
            if(q.type==='gaps' && q.prompt.split('___').length-1!==q.answer.length)fail(prefix+'use ___ for each blank and choose one answer per blank.');
        }
        return result;
    });
    return {title:input.title.trim(),durationMinutes,forwardOnlyFrom,checkpointMessage,questions};
}
function responseCount(q) {
    if(q.type==='gaps')return q.prompt.split('___').length-1;
    if(q.type==='order')return q.choices.length;
    if(q.type==='multi')return q.answer.length;
    return 1;
}
function maxPoints(q){return q.points*(q.scoringMode==='response'?responseCount(q):1);}
function publicQuestions(quiz) {return quiz.questions.map(q=>{const {answer,...safe}=q;return {...safe,maxPoints:maxPoints(q),responseCount:responseCount(q)};});}
function validAnswers(quiz,answers,expired=false) {
    if(!Array.isArray(answers) || answers.length!==quiz.questions.length)return false;
    return quiz.questions.every((q,i)=>{
        const a=answers[i];if(!Array.isArray(a) || !a.every(v=>typeof v==='string' && v.length<=5000))return false;
        if(q.type==='text')return a.length===1 && (expired || !!a[0].trim());
        if(q.type==='multi')return (q.scoringMode!=='response' || (expired?a.length<=q.answer.length:a.length===q.answer.length)) && a.length<=q.choices.length && (expired || !!a.length) && new Set(a).size===a.length && a.every(v=>q.choices.includes(v));
        const count=q.type==='choice'?1:q.type==='gaps'?q.answer.length:q.choices.length;
        return a.length===count && a.every(v=>q.choices.includes(v) || (expired && v==='')) && (q.type!=='order' || new Set(a.filter(Boolean)).size===a.filter(Boolean).length);
    });
}
function validCorrections(quiz,scores) {
    const manual=quiz.questions.filter(q=>q.type==='text');
    return Array.isArray(scores) && scores.length===manual.length && scores.every((s,i)=>s===null || typeof s==='number' && Number.isFinite(s) && s>=0 && s<=maxPoints(manual[i]) && Number.isInteger(s*(manual[i].allowHalfCredit===true?2:1)));
}
function grade(quiz,answers,correction={}) {
    const scores=validCorrections(quiz,correction.scores)?correction.scores:quiz.questions.filter(q=>q.type==='text').map(()=>null);
    const automatic=[],manual=[];
    quiz.questions.forEach((q,index)=>{
        if(q.type==='text'){manual.push({index,max:maxPoints(q),score:scores[manual.length],modelAnswer:q.answer});return;}
        const a=answers[index] || [],expected=q.answer;
        const correct=a.length===expected.length && (q.type==='multi'?new Set(a).size===a.length && expected.every(v=>a.includes(v)):expected.every((v,i)=>a[i]===v));
        const count=q.type==='multi'?expected.filter(v=>a.includes(v)).length:expected.filter((v,i)=>a[i]===v).length;
        const earned=q.scoringMode==='response'?q.points*(q.type==='multi' && a.length>expected.length?0:count):(correct?q.points:0);
        automatic.push({index,step:q.allowHalfCredit===true?0.5:1,max:maxPoints(q),score:earned,correctAnswer:expected.join(q.type==='order'?(q.direction==='rtl'?' ← ':' → '):'; ')});
    });
    applyOverrides(automatic,correction.overrides,correction.explanations);
    const automaticScore=automatic.reduce((n,q)=>n+q.score,0),pending=manual.filter(q=>q.score===null).length;
    const earnedSoFar=automaticScore+manual.reduce((n,q)=>n+(q.score??0),0);
    return {automatic,manual,automaticScore,automaticMax:automatic.reduce((n,q)=>n+q.max,0),pending,earnedSoFar,total:pending?null:earnedSoFar,baseMax:quiz.questions.reduce((n,q)=>n+maxPoints(q),0),feedback:correction.feedback || '',savedAt:correction.savedAt || null};
}
function summarize(quiz,records) {
    return quiz.questions.map((q,index)=>{
        const counts={correct:0,incorrect:0,partial:0,pending:0};
        for(const record of records){const g=record.grading;const item=[...g.automatic,...g.manual].find(v=>v.index===index);
            if(!item || item.score===null)counts.pending++;
            else if(item.score===item.max)counts.correct++;
            else if(item.score===0)counts.incorrect++;
            else counts.partial++;
        }
        const total=records.length,graded=total-counts.pending;
        const percentages=Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,total?Math.round(value/total*1000)/10:null]));
        return {index,prompt:q.prompt,total,graded,...counts,percentages};
    });
}
function rosterStatuses(roster,records,attempts,now=Date.now()) {
    return roster.students.map(student=>{
        const submission=records.find(r=>r.sub===student.id && r.classId===roster.classId);
        const attempt=attempts.find(a=>a.sub===student.id && a.classId===roster.classId && !a.isClassTeacher);
        return {...student,status:submission?'submitted':!roster.assigned?'not-assigned':!attempt?'not-started':attempt.deadline!==null && attempt.deadline<=now?'expired':'in-progress',startedAt:attempt?new Date(attempt.startedAt).toISOString():null,submittedAt:submission?.submittedAt || null,submissionId:submission?.id || null};
    });
}
module.exports={validOverrides,responseCount,maxPoints,validateQuiz,publicQuestions,validAnswers,validCorrections,grade,summarize,rosterStatuses};

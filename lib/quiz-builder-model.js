const scoring=require('../Penina-Quizzes/custom/scoring');
const {validOverrides,applyOverrides}=require('./quiz-score-overrides');
'use strict';
function fail(message) { const error=new Error(message);error.status=400;throw error; }
const TYPES=['text','choice','multi','gaps','order','match'];
function validateQuiz(input,publish=false) {
    if(!input || typeof input.title!=='string' || !input.title.trim() || input.title.length>160)fail('Enter a quiz title (up to 160 characters).');
    if(!Array.isArray(input.questions) || input.questions.length>100 || (publish && !input.questions.length))fail('Add between 1 and 100 questions before publishing.');
    const durationMinutes=input.durationMinutes==null?null:Number(input.durationMinutes);
    if(durationMinutes!==null && (!Number.isInteger(durationMinutes) || durationMinutes<1 || durationMinutes>1000))fail('Choose no time limit or set 1–1,000 minutes.');
    const forwardOnlyFrom=input.forwardOnlyFrom ?? null;
    if(forwardOnlyFrom!==null && (!Number.isInteger(forwardOnlyFrom) || forwardOnlyFrom<1 || forwardOnlyFrom>=input.questions.length))fail('Place the review checkpoint before question 2 or a later question.');
    const checkpointMessage=input.checkpointMessage ?? 'Review your previous answers now. Beginning with the next question, you cannot return to previous questions. The rest of this quiz goes forward only.';
    if(typeof checkpointMessage!=='string' || checkpointMessage.length>2000 || (forwardOnlyFrom!==null && !checkpointMessage.trim()))fail('Enter a checkpoint message (up to 2,000 characters).');
    const questions=input.questions.map((q,i)=>{
        const prefix='Question '+(i+1)+': ';
        if(q?.type==='gaps' && (q.sentence!==undefined || typeof q.prompt==='string' && q.prompt.includes('<<') && !q.prompt.includes('___'))){
            const sentence=q.sentence ?? q.prompt;
            if(typeof sentence!=='string' || sentence.length>5000)fail(prefix+'enter a sentence up to 5,000 characters.');
            const distractors=q.distractors ?? (q.choices||[]).filter(v=>!(q.answer||[]).includes(v));
            if(!Array.isArray(distractors) || distractors.length>50 || !distractors.every(v=>typeof v==='string' && v.length<=500))fail(prefix+'use at most 50 distractor words, up to 500 characters each.');
            const answer=[];
            const prompt=sentence.replace(/<<([^<>]+)>>/g,(_,v)=>{answer.push(v.trim());return '___';});
            if(publish && (prompt.includes('<<') || prompt.includes('>>') || answer.some(v=>!v) || prompt.split('___').length-1!==answer.length))fail(prefix+'finish each blank with <<answer>> before publishing.');
            q={...q,sentence,distractors,prompt,answer,wordBank:true,choices:[...new Set([...answer,...distractors].filter(Boolean))]};
        }
        if(!q || !TYPES.includes(q.type))fail(prefix+'choose a question type.');
        if(typeof q.prompt!=='string' || q.prompt.length>5000 || (publish && !q.prompt.trim()))fail(prefix+'enter a question (up to 5,000 characters).');
        const scoringMode=q.scoringMode ?? 'total';
        if(!['total','response','proportional'].includes(scoringMode))fail(prefix+'choose points per total question or per correct response.');
        if(scoringMode==='proportional' && (!['match','gaps'].includes(q.type) || q.wordBank===false))fail(prefix+'distributed total points require matching or word-bank blanks.');
        if(q.extraCredit!==undefined && typeof q.extraCredit!=='boolean')fail(prefix+'choose whether this is extra credit.');
        const extraCredit=q.extraCredit===true;
        const allowHalfCredit=q.allowHalfCredit===true;
        if(q.allowHalfCredit!==undefined && typeof q.allowHalfCredit!=='boolean')fail(prefix+'choose whether half credit is allowed.');
        if(!allowHalfCredit && (!Number.isInteger(q.points) || q.points<1))fail(prefix+'use whole points, or check Allow half credit to use half points.');
        if(typeof q.points!=='number' || !Number.isFinite(q.points) || q.points<0.5 || q.points>5000 || !Number.isInteger(q.points*2))fail(prefix+'points must be 0.5–5,000, in half-point steps.');
        const result={type:q.type,prompt:q.prompt,points:q.points,extraCredit,allowHalfCredit,scoringMode,...(q.perResponseCredit===true?{perResponseCredit:true}:{}),direction:q.direction==='rtl'?'rtl':'ltr'};
        if(q.type==='text') {
            if(typeof q.answer!=='string' || q.answer.length>5000)fail(prefix+'the model answer is too long.');
            return {...result,answer:q.answer};
        }
        if(q.type==='match') {
            if(!Array.isArray(q.items) || q.items.length>50 || !q.items.every(v=>typeof v==='string' && v.length<=500) || (publish && (!q.items.length || q.items.some(v=>!v.trim()))))fail(prefix+'enter 1–50 words or definitions to match.');
            result.items=q.items;
        }
        if(q.type==='gaps') {
            if(q.sentence!==undefined){result.sentence=q.sentence;result.distractors=q.distractors;}
            if(q.wordBank!==undefined && typeof q.wordBank!=='boolean')fail(prefix+'choose whether to use a word bank.');
            result.wordBank=q.wordBank!==false;
            if(q.wordBank===false) {
                if(!Array.isArray(q.answer) || q.answer.length>50 || !q.answer.every(v=>typeof v==='string' && v.length<=500))fail(prefix+'enter an answer for each blank.');
                if(publish && (!q.answer.length || q.answer.some(v=>!v.trim()) || q.prompt.split('___').length-1!==q.answer.length))fail(prefix+'use ___ for each blank and enter one answer per blank.');
                return {...result,choices:[],answer:q.answer};
            }
        }
        if(!Array.isArray(q.choices) || q.choices.length>50 || !q.choices.every(c=>typeof c==='string' && c.length<=500))fail(prefix+'use at most 50 choices, each up to 500 characters.');
        if(publish && (q.choices.length<(['choice','multi','order'].includes(q.type)?2:1) || q.choices.some(c=>!c.trim()) || new Set(q.choices).size!==q.choices.length))fail(prefix+'enter at least two distinct, nonempty choices.');
        if(!Array.isArray(q.answer) || q.answer.length>50 || !q.answer.every(c=>typeof c==='string' && c.length<=500))fail(prefix+'enter an answer key.');
        result.choices=q.choices;result.answer=q.answer;
        if(publish) {
            if(!q.answer.length || !q.answer.every(a=>q.choices.includes(a) || q.type==='match' && a==='') || q.type==='match' && !q.answer.some(Boolean))fail(prefix+'select correct answers from the choices.');
            if(q.type==='match' && q.items.length!==q.answer.length)fail(prefix+'choose one answer for each matching item.');
            if(q.type==='choice' && q.answer.length!==1)fail(prefix+'choose one correct answer.');
            if(q.type==='multi' && new Set(q.answer).size!==q.answer.length)fail(prefix+'remove duplicate correct answers.');
            if(q.type==='order' && (q.answer.length!==q.choices.length || new Set(q.answer).size!==q.choices.length))fail(prefix+'put every choice in the correct order.');
            if(q.type==='gaps' && q.prompt.split('___').length-1!==q.answer.length)fail(prefix+'use ___ for each blank and choose one answer per blank.');
        }
        return result;
    });
    if(publish && questions.every(q=>q.extraCredit))fail('Include at least one regular question before publishing.');
    return {title:input.title.trim(),durationMinutes,forwardOnlyFrom,checkpointMessage,questions};
}
const {responseCount,maxPoints}=scoring;
function publicQuestions(quiz) {
    return quiz.questions.map(q=>{
        const safe={type:q.type,prompt:q.prompt,points:q.points,extraCredit:q.extraCredit,allowHalfCredit:q.allowHalfCredit,scoringMode:q.scoringMode,perResponseCredit:q.perResponseCredit,direction:q.direction,potentialPoints:q.potentialPoints,maxPoints:maxPoints(q),responseCount:responseCount(q)};
        // Sequence-based formats must not expose authoring order. Keep legacy checkbox indices stable; their order does not encode the selected answer set.
        if(q.choices)safe.choices=['gaps','order','match'].includes(q.type)?[...q.choices].sort():[...q.choices];
        if(q.items)safe.items=[...q.items];
        if(q.type==='gaps')safe.wordBank=q.wordBank!==false;
        return safe;
    });
}
function validAnswers(quiz,answers,expired=false) {
    if(!Array.isArray(answers) || answers.length!==quiz.questions.length)return false;
    return quiz.questions.every((q,i)=>{
        const a=answers[i];if(!Array.isArray(a) || !a.every(v=>typeof v==='string' && v.length<=5000))return false;
        const optional=expired || q.extraCredit===true;
        if(q.type==='text')return a.length===1 && (optional || !!a[0].trim());
        if(q.type==='multi')return a.length<=q.choices.length && (optional || !!a.length) && new Set(a).size===a.length && a.every(v=>q.choices.includes(v));
        if(q.type==='gaps' && q.wordBank===false)return a.length===q.answer.length && a.every(v=>v.length<=500 && (optional || !!v.trim()));
        if(q.type==='match' && !optional && a.filter(Boolean).length<responseCount(q))return false;
        const count=q.type==='choice'?1:['gaps','match'].includes(q.type)?q.answer.length:q.choices.length;
        return a.length===count && a.every(v=>q.choices.includes(v) || ((optional || q.type==='match') && v==='')) && (q.type!=='order' || new Set(a.filter(Boolean)).size===a.filter(Boolean).length);
    });
}
function needsCorrection(q){return q.type==='text' || q.type==='gaps' && q.wordBank===false;}
function validCorrections(quiz,scores) {
    const manual=quiz.questions.filter(needsCorrection);
    return Array.isArray(scores) && scores.length===manual.length && scores.every((s,i)=>s===null || typeof s==='number' && Number.isFinite(s) && s>=0 && Number.isInteger(s*(manual[i].allowHalfCredit===true?2:1)));
}
function grade(quiz,answers,correction={}) {
    let scores=validCorrections(quiz,correction.scores)?correction.scores:null;
    // Older saved corrections contain scores only for text questions. Preserve their positions.
    if(!scores){
        const legacy={questions:quiz.questions.filter(q=>q.type==='text')};
        let index=0;
        scores=quiz.questions.flatMap((q,questionIndex)=>{
            if(!needsCorrection(q))return [];
            if(q.type==='text')return [validCorrections(legacy,correction.scores)?correction.scores[index++]:null];
            const override=correction.overrides?.[questionIndex];
            return [typeof override==='number' && Number.isFinite(override) && override>=0 && Number.isInteger(override*(q.allowHalfCredit?2:1))?override:null];
        });
    }
    const automatic=[],manual=[];
    quiz.questions.forEach((q,index)=>{
        if(needsCorrection(q)){manual.push({index,max:maxPoints(q),score:scores[manual.length] ?? null,extraCredit:q.extraCredit===true,modelAnswer:Array.isArray(q.answer)?q.answer.join('; '):q.answer,explanation:correction.explanations?.[index] || ''});return;}
        const earned=scoring.score(q,answers[index] || []);
        automatic.push({index,extraCredit:q.extraCredit===true,step:q.scoringMode==='proportional'?0.01:q.allowHalfCredit===true?0.5:1,answerMax:scoring.originalMax(q),max:maxPoints(q),score:earned,correctAnswer:q.answer.map((v,i)=>q.type==='match'?q.items[i]+': '+v:v).join(q.type==='order'?(q.direction==='rtl'?' ← ':' → '):'; ')});
    });
    applyOverrides(automatic,correction.overrides,correction.explanations);
    for(const item of automatic)item.correctnessMax=item.overridden?item.max:item.answerMax;
    const automaticScore=Math.round(automatic.reduce((n,q)=>n+q.score,0)*100)/100,pending=manual.filter(q=>q.score===null).length;
    const earnedSoFar=Math.round((automaticScore+manual.reduce((n,q)=>n+(q.score??0),0))*100)/100;
    const pointsChanged=(correction.pointsRevision || 0)!==(quiz.pointsRevision || 0);
    return {pointsRevision:quiz.pointsRevision || 0,pointsChanged,automatic,manual,automaticScore,automaticMax:automatic.reduce((n,q)=>n+q.max,0),pending,earnedSoFar,total:pending?null:earnedSoFar,baseMax:quiz.questions.filter(q=>!q.extraCredit).reduce((n,q)=>n+maxPoints(q),0),extraMax:quiz.questions.filter(q=>q.extraCredit).reduce((n,q)=>n+maxPoints(q),0),feedback:correction.feedback || '',savedAt:correction.savedAt || null,classroomDraft:!pointsChanged && correction.classroomDraft===true,lmsSentAt:pointsChanged?null:correction.lmsSentAt || null,studentSentAt:pointsChanged?null:correction.studentSentAt || null};
}
function summarize(quiz,records) {
    return quiz.questions.map((q,index)=>{
        const counts={correct:0,incorrect:0,partial:0,pending:0};
        for(const record of records){const g=record.grading;const item=[...g.automatic,...g.manual].find(v=>v.index===index);
            if(!item || item.score===null)counts.pending++;
            else if(item.score>=(item.correctnessMax ?? item.max))counts.correct++;
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
module.exports={needsCorrection,validOverrides,responseCount,maxPoints,validateQuiz,publicQuestions,validAnswers,validCorrections,grade,summarize,rosterStatuses};

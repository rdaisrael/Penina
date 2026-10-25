'use strict';
// Shared by server grading and the isolated teacher preview.
(function(root,factory){if(typeof module==='object' && module.exports)module.exports=factory();else root.QuizScoring=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
    function responseCount(q){return q.type==='gaps'?q.prompt.split('___').length-1:q.type==='match'?q.answer.filter(Boolean).length:q.type==='order'?q.choices.length:q.type==='multi'?q.answer.length:1;}
    function originalMax(q){return q.points*(q.scoringMode==='response'?responseCount(q):1);}
    function maxPoints(q){return q.potentialPoints ?? originalMax(q);}
    function score(q,a){
        const expected=q.answer;
        const correct=a.length===expected.length && (q.type==='multi'?new Set(a).size===a.length && expected.every(v=>a.includes(v)):expected.every((v,i)=>a[i]===v));
        if(q.type==='multi' || q.type==='order')return correct?originalMax(q):0;
        if(q.scoringMode==='proportional')return Math.round(q.points*expected.filter((v,i)=>v!=='' && a[i]===v).length/responseCount(q)*100)/100;
        return q.scoringMode==='response'?q.points*expected.filter((v,i)=>v!=='' && a[i]===v).length:correct?q.points:0;
    }
    function duplicateQuestions(questions){return questions.map(question=>{
        const q={...question};
        if(q.potentialPoints!==undefined && q.potentialPoints!==originalMax(q)){
            q.points=q.potentialPoints;
            q.scoringMode=['response','proportional'].includes(q.scoringMode) && ['match','gaps'].includes(q.type) && q.wordBank!==false?'proportional':'total';
            if(!Number.isInteger(q.points))q.allowHalfCredit=true;
        }
        delete q.potentialPoints;
        return q;
    });}
    function feedback(questions,answers,detailed=false){return questions.flatMap((q,index)=>{
        if(q.type==='text' || q.type==='gaps' && q.wordBank===false)return [];
        const points=score(q,answers[index]||[]),max=originalMax(q);
        return [{index,correct:points===max,partial:points>0 && points<max,...(detailed?{correctAnswers:[...q.answer]}:{})}];
    });}
    return {responseCount,originalMax,maxPoints,score,feedback,duplicateQuestions};
});

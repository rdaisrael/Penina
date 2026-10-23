'use strict';
// Shared by server grading and the isolated teacher preview.
(function(root,factory){if(typeof module==='object' && module.exports)module.exports=factory();else root.QuizScoring=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
    function responseCount(q){return q.type==='gaps'?q.prompt.split('___').length-1:q.type==='match'?q.answer.filter(Boolean).length:q.type==='order'?q.choices.length:q.type==='multi'?q.answer.length:1;}
    function maxPoints(q){return q.points*(q.scoringMode==='response'?responseCount(q):1);}
    function score(q,a){
        const expected=q.answer;
        const correct=a.length===expected.length && (q.type==='multi'?new Set(a).size===a.length && expected.every(v=>a.includes(v)):expected.every((v,i)=>a[i]===v));
        if(q.type==='multi' || q.type==='order')return correct?maxPoints(q):0;
        return q.scoringMode==='response'?q.points*expected.filter((v,i)=>v!=='' && a[i]===v).length:correct?q.points:0;
    }
    function feedback(questions,answers){return questions.flatMap((q,index)=>{
        if(q.type==='text' || q.type==='gaps' && q.wordBank===false)return [];
        const points=score(q,answers[index]||[]),max=maxPoints(q);
        return [{index,correct:points===max,partial:points>0 && points<max}];
    });}
    return {responseCount,maxPoints,score,feedback};
});

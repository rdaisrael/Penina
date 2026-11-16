module.exports=function partJSON(prompt,result){
    const questions=JSON.parse(prompt.match(/^Question plan: (.*)$/m)[1]);
    const lessons=JSON.parse(prompt.match(/^Lesson person IDs: (.*)$/m)[1]);
    return JSON.stringify({...result,questions:result.questions.filter(q=>questions.some(target=>target.number===q.number)),
        lessons:result.lessons.filter(l=>lessons.some(target=>target.pair===l.pair))});
};

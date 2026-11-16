'use strict';
// Keep output-heavy sentence analyses and complete model tables small enough
// to generate independently, while retaining the worksheet's global order.
function partsFor(questions,lessonPairs){
    return Array.from({length:Math.max(Math.ceil(questions.length/4),Math.ceil(lessonPairs.length/2))},(_,i)=>{
        const part={questions:questions.slice(i*4,i*4+4),lessonPairs:lessonPairs.slice(i*2,i*2+2)};
        return {...part,pairs:[...new Set([...part.lessonPairs,...part.questions.map(q=>q.pair)])]};
    });
}
function readPart(raw,part){
    const fail=message=>{throw Object.assign(new Error(message),{status:422,worksheetStage:'structure'});};
    let result;try{result=JSON.parse(raw);}catch{fail('The worksheet service returned an unreadable result. Please try again.');}
    if(result&&Array.isArray(result.unavailablePairs)&&result.unavailablePairs.length){
        fail('No suitable verbs were found for a selected combination. Choose another binyan or root type, or add suitable mastered roots to the workbook.');
    }
    if(part.questions.length&&Array.isArray(result?.questions)&&!result.questions.length){
        fail('No suitable verbs were found for a selected combination. Choose another binyan or root type, or add suitable mastered roots to the workbook.');
    }
    if(!result||!Array.isArray(result.lessons)||!Array.isArray(result.questions)||
        result.lessons.length!==part.lessonPairs.length||result.questions.length!==part.questions.length||
        result.lessons.some((lesson,i)=>lesson?.pair!==part.lessonPairs[i])||
        result.questions.some((q,i)=>!q||q.number!==part.questions[i].number||q.pair!==part.questions[i].pair||q.person!==part.questions[i].person||(q.exercise||'conjugate')!==part.questions[i].exercise)){
        fail('The generated worksheet did not pass its checks. Please try again or choose another combination.');
    }
    return result;
}
async function generateParts(parts,generate){
    const controller=new AbortController(),results=new Array(parts.length);
    let next=0,firstError;
    const worker=async()=>{
        while(!firstError&&next<parts.length){
            const index=next++;
            try{results[index]=readPart(await generate(parts[index],controller.signal),parts[index]);}
            catch(error){if(!firstError){firstError=error;controller.abort();}return;}
        }
    };
    // Bound concurrent provider work; one failed part invalidates the whole result.
    await Promise.all(Array.from({length:Math.min(4,parts.length)},worker));
    if(firstError)throw firstError;
    return {unavailablePairs:[],lessons:results.flatMap(r=>r.lessons),questions:results.flatMap(r=>r.questions)};
}
module.exports={partsFor,readPart,generateParts};

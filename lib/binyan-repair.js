'use strict';
const core=require('../PeninaPlus-Binyan-Builder/core');
const key=(pair,root)=>JSON.stringify([pair,core.normalize(root)]);

function planRepair(result,eligibleRoots,rejectedForms){
    const rejected=new Set(rejectedForms.map(item=>key(item.pair,item.root)));
    const lessons=result.lessons.filter(item=>rejected.has(key(item.pair,item.root)));
    const questions=result.questions.filter(item=>rejected.has(key(item.pair,item.root))||
        (item.exercise==='choice'&&rejected.has(key(core.alternativeTarget(item).pair,item.root))));
    const rootsByPair={},preferredRootsByPair={};
    for(const item of [...lessons,...questions]){
        const pair=item.pair;
        if(rootsByPair[pair])continue;
        const failedRoots=new Set([...lessons,...questions].filter(x=>x.pair===pair).map(x=>core.normalize(x.root)));
        const alternatives=eligibleRoots[pair].filter(root=>!failedRoots.has(root));
        // A sole root may need a pointing correction, but must still pass Dicta.
        rootsByPair[pair]=alternatives.length?alternatives:eligibleRoots[pair];
        preferredRootsByPair[pair]=[...new Set([...result.lessons,...result.questions]
            .filter(x=>x.pair===pair&&!failedRoots.has(core.normalize(x.root)))
            .map(x=>core.normalize(x.root)))];
    }
    return {lessons,questions,rootsByPair,preferredRootsByPair};
}

function mergeRepair(result,repair,plan){
    const fail=()=>{throw new Error('The replacement forms did not pass worksheet checks. Please build again or choose another combination.');};
    if(!repair||!Array.isArray(repair.unavailablePairs)||repair.unavailablePairs.length||
        !Array.isArray(repair.lessons)||!Array.isArray(repair.questions)||
        repair.lessons.length!==plan.lessons.length||repair.questions.length!==plan.questions.length)fail();
    for(const [items,targets,id] of [[repair.lessons,plan.lessons,'pair'],[repair.questions,plan.questions,'number']]){
        items.forEach((item,i)=>{
            if(!item||item[id]!==targets[i][id]||item.pair!==targets[i].pair||
                typeof item.root!=='string'||!plan.rootsByPair[item.pair]?.includes(core.normalize(item.root)))fail();
        });
    }
    const lessons=new Map(repair.lessons.map(item=>[item.pair,item]));
    const questions=new Map(repair.questions.map(item=>[item.number,item]));
    return {...result,lessons:result.lessons.map(item=>lessons.get(item.pair)||item),
        questions:result.questions.map(item=>questions.get(item.number)||item)};
}
module.exports={planRepair,mergeRepair};

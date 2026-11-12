(function(root,factory){
    if(typeof module==='object' && module.exports)module.exports=factory();
    else root.QuizQuestionConversion=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const types=['text','choice','gaps','picture'];
    const kind=q=>q.pictureQuestion?'picture':q.type;
    const supported=q=>!!q && types.includes(kind(q));
    const key=value=>String(value).normalize('NFC').trim().toLowerCase().replace(/\s+/gu,' ');
    const unique=values=>values.filter((value,i)=>value.trim() && values.findIndex(other=>key(other)===key(value))===i).map(value=>value.trim());
    function read(q){
        q=structuredClone(q);
        if(q.type==='gaps' && q.sentence!==undefined){
            q.answer=[];
            q.prompt=q.sentence.replace(/<<([^<>]+)>>/g,(_,answer)=>{q.answer.push(answer.trim());return '___';});
        }
        return q;
    }
    function blocked(question){
        if(!supported(question))return 'Change type is available for written answer, multiple choice, fill in the blanks, and picture questions.';
        if(question.pictureResponseMode && question.image?.markers)return 'This picture has numbered markers. Keep it as a picture question so its markers and answers stay together.';
        if(question.pictureGroup || question.image?.markers)return 'This question shares numbered picture markers with other questions. Duplicate this question first, then change the independent copy’s type.';
        const q=read(question);
        if(q.vocabularyTerms?.length>1)return 'This question tests several source items. Keep its type so no source items are lost.';
        if(q.type==='gaps' && (q.prompt.split('___').length!==2 || q.answer.length!==1 || /<<|>>/.test(q.prompt)))return 'Only questions with one completed blank can change type. Keep this question’s blanks together, or create separate questions first.';
        if(q.type==='choice' && q.answer.length>1)return 'Choose one correct answer before changing this question’s type.';
        return '';
    }
    function sourceRow(q,rows,answer){
        const term=q.vocabularyTerms?.length===1?q.vocabularyTerms[0]:null;
        if(!term || key(term.definition)!==key(answer))return null;
        const matches=rows.filter(row=>row.word===term.word && key(row.definition)===key(answer) && (row.kind==='knowledge')===(term.kind==='knowledge') && (!term.sourceId || row.sourceId===term.sourceId));
        return matches.length===1?matches[0]:null;
    }
    function canonicalPrompt(q,target){
        const term=q.vocabularyTerms?.length===1?q.vocabularyTerms[0]:null;
        if(!term || term.kind==='knowledge')return null;
        const language=/[א-ת]/u.test(term.word)?'English':'Hebrew';
        const prompts={text:'Translate “'+term.word+'” into '+language+'.',choice:'Which definition best matches “'+term.word+'”?',gaps:'The '+language+' meaning of “'+term.word+'” is ___.'};
        // Only rewrite our exact generated wording. Teacher edits stay intact.
        return Object.values(prompts).includes(q.prompt)?prompts[target==='picture'?'text':target]:null;
    }
    function create(question,target,rows=[]){
        const reason=blocked(question);if(reason)throw Error(reason);
        if(!types.includes(target))throw Error('Choose a supported question type.');
        const q=read(question),answer=q.type==='text'?q.answer:q.answer[0] || '';
        const row=sourceRow(q,rows,answer);
        const bank=q.type==='choice' || q.type==='gaps'?q.distractors ?? q.choices ?? []:q.conversionDistractors ?? row?.definitionDistractors ?? [];
        const distractors=unique(bank.filter(value=>key(value)!==key(answer)));
        const next=structuredClone(q);
        for(const field of ['choices','items','pairs','sentence','distractors','wordBank','pictureQuestion','markerIndex','pictureGroup','pictureResponseMode','pictureAnswers','potentialPoints','perResponseCredit'])delete next[field];
        next.type=target==='picture'?'text':target;
        next.conversionDistractors=distractors;
        // All supported conversions have one response; proportional scoring is
        // only defined for a word-bank question and is unnecessary here.
        if(next.scoringMode==='proportional')next.scoringMode='total';
        next.prompt=canonicalPrompt(q,target) || q.prompt;
        next.answer=next.type==='text'?answer:[answer];
        if(target==='picture')next.pictureQuestion=true;
        if(target==='choice')next.choices=unique([answer,...distractors]);
        if(target==='gaps'){
            next.sentence=next.prompt.includes('___')?next.prompt.replace('___','<<'+answer+'>>'):next.prompt+'\nAnswer: <<'+answer+'>>';
            next.prompt=next.sentence.replace(/<<([^<>]+)>>/g,'___');
            next.distractors=distractors;next.wordBank=true;next.choices=unique([answer,...distractors]);
        }
        return next;
    }
    function finish(question){
        const q=read(question),answer=q.type==='text'?q.answer:q.answer[0] || '';
        if(q.type==='gaps'){
            const reason=blocked(q);if(reason)throw Error(reason);
        }
        if(!q.prompt.trim() || q.prompt.length>5000)throw Error('Enter a question up to 5,000 characters.');
        if(!answer.trim())throw Error('Enter the correct answer before replacing this question.');
        if(answer.length>(q.type==='text'?5000:500))throw Error('Shorten the correct answer to '+(q.type==='text'?'5,000':'500')+' characters for this format.');
        const distractors=q.conversionDistractors ?? [];
        if(distractors.length>49 || distractors.some(value=>!value.trim() || value.length>500))throw Error('Use up to 49 incorrect choices, each up to 500 characters.');
        if(distractors.some(value=>key(value)===key(answer)))throw Error('An incorrect choice cannot also be the correct answer.');
        if(unique(distractors).length!==distractors.length)throw Error('Remove duplicate incorrect choices.');
        if(q.type==='choice' && !distractors.length)throw Error('Add at least one incorrect choice for multiple choice.');
        if(q.type!=='text'){q.answer=[answer.trim()];q.choices=unique([answer,...distractors]);}
        if(q.type==='gaps')q.distractors=[...distractors];
        return q;
    }
    return {types,kind,supported,blocked,create,finish};
});

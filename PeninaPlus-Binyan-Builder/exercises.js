(function(root,factory){
    const api=factory(typeof module==='object'&&module.exports?require('./core'):root.BinyanBuilder);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.BinyanExercises=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const he=value=>`<bdi class="hebrew" lang="he" dir="rtl">${esc(value)}</bdi>`;
    const instructions={choice:'Circle the form that matches the subject and tense.',conjugate:'Write the correct form for the root and subject.',sentence:'Complete each sentence using the root in parentheses.',writing:'Write your own sentence using the given root, subject and tense.'};
    const tenseLabel=pair=>core.tenseNames[core.tenses.indexOf(pair.split('|')[1])];
    const target=q=>q.person==='form'?'Infinitive':core.subject(q.person);
    function sentence(q,answer=false,rootCue=false){
        const [before,after]=q.sentence.split('___');
        return `<div class="sentence-line" dir="rtl" lang="he">${esc(before)}${answer?`<strong>${esc(q.answer)}</strong>`:'<span class="sentence-blank" aria-label="Write the missing verb"></span>'}${esc(after)}${rootCue?` <span class="root-cue">(${esc(q.root)})</span>`:''}</div>`;
    }
    function question(q,learn,key,mixedTenses){
        const type=q.exercise||'conjugate';
        let body;
        if(key){
            body=['sentence','writing'].includes(type)?sentence(q,true):`<div class="question-prompt" dir="rtl">${he(target(q))}<span class="key-answer" dir="rtl">${esc(q.answer)}</span></div>`;
            if(type==='writing')body='<p class="sample-label">Example only — other correct sentences are welcome.</p>'+body;
        }else if(type==='choice'){
            // Alternate correct-answer position without changing the checked forms.
            const choices=q.number%2?[q.alternative,q.answer]:[q.answer,q.alternative];
            body=`<div class="choice-line" dir="rtl">${he(target(q))}<span class="choice-options">${choices.map(he).join('<span class="choice-divider"> / </span>')}</span></div>`;
        }else if(type==='sentence')body=sentence(q,false,type==='sentence');
        else if(type==='writing')body=`<p class="writing-prompt">${he(target(q))} · (${he(q.root)})</p><div class="writing-lines" aria-label="Space for your sentence"><span></span><span></span></div>`;
        else body=`<div class="question-prompt" dir="rtl">${he(target(q))}<span class="root-cue">(${he(q.root)})</span><span class="answer-line" aria-label="Write your answer"></span></div>`;
        const hint=learn&&!key&&type!=='writing'?`<p class="hint">Hint: ${esc(q.hint)}</p>`:'';
        const tense=mixedTenses?`<span class="question-tense">${esc(tenseLabel(q.pair))}</span>`:'';
        return `<div class="question" data-exercise="${esc(type)}"><span class="question-number">${q.number}.</span><div class="question-content">${tense}${body}${hint}</div></div>`;
    }
    function render(questions,{learn=false,key=false}={}){
        const types=[...new Set(questions.map(q=>q.exercise||'conjugate'))];
        return types.map(type=>{
            const qs=questions.filter(q=>(q.exercise||'conjugate')===type);
            const tenses=[...new Set(qs.map(q=>tenseLabel(q.pair)))];
            return `<section class="exercise-section" data-section="${esc(type)}"><h3>${esc(core.exerciseTypes[type])}${tenses.length===1?`<span class="section-tense"> · ${esc(tenses[0])}</span>`:''}</h3>${key?'':`<p class="exercise-instructions">${esc(instructions[type])}</p>`}${qs.map(q=>question(q,learn,key,tenses.length>1)).join('')}${type==='writing'&&!key?'<p class="self-check">Check: Does your verb match the subject, gender, number and tense?</p>':''}</section>`;
        }).join('');
    }
    return {render};
});

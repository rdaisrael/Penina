(function(root,factory){
    const api=factory(typeof module==='object'&&module.exports?require('./core'):root.BinyanBuilder);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.BinyanExercises=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const he=value=>`<bdi class="hebrew" lang="he" dir="rtl">${esc(value)}</bdi>`;
    const instructions={choice:'Circle the form that matches the subject and tense.',conjugate:'Write the correct form for the root and subject.',sentence:'Complete each sentence using the root in parentheses.',bank:'Choose from the word bank. A form may be used more than once; use the meaning and subject as clues.',writing:'Write your own sentence using the given root, subject and tense.'};
    const pairLabel=pair=>{const [group,tense]=pair.split('|');return `${core.groupLabel(group)} · ${core.tenseNames[core.tenses.indexOf(tense)]}`;};
    const target=q=>q.person==='form'?'Infinitive':core.subject(q.person);
    function sentence(q,answer=false){
        const [before,after]=q.sentence.split('___');
        return `<div class="sentence-line" dir="rtl" lang="he">${esc(before)}${answer?`<strong>${esc(q.answer)}</strong>`:'<span class="sentence-blank" aria-label="Write the missing verb"></span>'}${esc(after)}</div>`;
    }
    function question(q,learn,key){
        const type=q.exercise||'conjugate';
        let body;
        if(key){
            body=['sentence','bank','writing'].includes(type)?sentence(q,true):`<div class="question-prompt" dir="rtl">${he(target(q))}<span class="key-answer" dir="rtl">${esc(q.answer)}</span></div>`;
            if(type==='writing')body='<p class="sample-label">Example only — other correct sentences are welcome.</p>'+body;
        }else if(type==='choice'){
            // Alternate correct-answer position without changing the checked forms.
            const choices=q.number%2?[q.alternative,q.answer]:[q.answer,q.alternative];
            body=`<div class="choice-line" dir="rtl">${he(target(q))}<span class="choice-options">${choices.map(he).join('<span class="choice-divider"> / </span>')}</span></div>`;
        }else if(type==='sentence'||type==='bank')body=sentence(q);
        else if(type==='writing')body=`<p>Use ${he(target(q))}. Write a complete sentence.</p><div class="writing-lines" aria-label="Space for your sentence"><span></span><span></span></div>`;
        else body=`<div class="question-prompt" dir="rtl">${he(target(q))}<span class="answer-line" aria-label="Write your answer"></span></div>`;
        const hint=learn&&!key&&type!=='writing'?`<p class="hint">Hint: ${esc(q.hint)}</p>`:'';
        return `<div class="question" data-exercise="${esc(type)}"><div class="question-top"><span class="question-number">${q.number}.</span><bdi>${esc(pairLabel(q.pair))}</bdi><span>(${he(q.root)}) · ${esc(q.meaning)}</span></div>${body}${hint}</div>`;
    }
    function render(questions,{learn=false,key=false}={}){
        const types=[...new Set(questions.map(q=>q.exercise||'conjugate'))];
        return types.map(type=>{
            const qs=questions.filter(q=>(q.exercise||'conjugate')===type);
            // Hebrew alphabetical order avoids leaking question order in the bank.
            const forms=[...new Set(qs.map(q=>q.answer))].sort((a,b)=>a.localeCompare(b,'he'));
            const bank=type==='bank'&&!key?`<div class="word-bank"><strong>Word bank</strong><div dir="rtl">${forms.map(he).join('<span aria-hidden="true"> · </span>')}</div></div>`:'';
            return `<section class="exercise-section" data-section="${esc(type)}"><h3>${esc(core.exerciseTypes[type])}</h3>${key?'':`<p class="exercise-instructions">${esc(instructions[type])}</p>`}${bank}${qs.map(q=>question(q,learn,key)).join('')}${type==='writing'&&!key?'<p class="self-check">Check: Does your verb match the subject, gender, number and tense?</p>':''}</section>`;
        }).join('');
    }
    return {render};
});

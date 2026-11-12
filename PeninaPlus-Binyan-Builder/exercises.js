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
        let text='',offset=0;
        for(const word of q.sentenceWords||[]){
            if(!word.noteId)continue;
            const end=word.start+word.word.length;
            text+=esc(q.sentence.slice(offset,end))+`<sup class="vocabulary-marker" data-note-id="${word.noteId}" aria-label="Vocabulary note ${word.noteId}">${word.noteId}</sup>`;
            offset=end;
        }
        text+=esc(q.sentence.slice(offset));
        text=text.replace('___',answer?`<strong>${esc(q.answer)}</strong>`:'<span class="sentence-blank" aria-label="Write the missing verb"></span>');
        return `<div class="sentence-line" dir="rtl" lang="he">${text}${rootCue?` <span class="root-cue">(${esc(q.root)})</span>`:''}</div>`;
    }
    function question(q,key,mixedTenses){
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
        const tense=mixedTenses?`<span class="question-tense">${esc(tenseLabel(q.pair))}</span>`:'';
        return `<div class="question" data-exercise="${esc(type)}"><span class="question-number">${q.number}.</span><div class="question-content">${tense}${body}</div></div>`;
    }
    function render(questions,{key=false,footnotes='none'}={}){
        const notes=[],ids=new Map();
        questions=questions.map(q=>{
            const shown=footnotes!=='none'&&(q.exercise==='sentence'||(key&&q.exercise==='writing'));
            const localIds=new Map();
            if(shown)for(const note of q.notes||[]){
                const identity=note.word.normalize('NFD').replace(/[\u0591-\u05C7]/g,'')+'|'+note.translation.toLowerCase();
                if(!ids.has(identity)){ids.set(identity,notes.length+1);notes.push({...note,id:notes.length+1});}
                localIds.set(note.id,ids.get(identity));
            }
            return {...q,sentenceWords:(q.sentenceWords||[]).map(word=>({...word,noteId:localIds.get(word.noteId)||null}))};
        });
        const types=[...new Set(questions.map(q=>q.exercise||'conjugate'))];
        const sections=types.map(type=>{
            const qs=questions.filter(q=>(q.exercise||'conjugate')===type);
            const tenses=[...new Set(qs.map(q=>tenseLabel(q.pair)))];
            return `<section class="exercise-section" data-section="${esc(type)}"><h3>${esc(core.exerciseTypes[type])}${tenses.length===1?`<span class="section-tense"> · ${esc(tenses[0])}</span>`:''}</h3>${key?'':`<p class="exercise-instructions">${esc(instructions[type])}</p>`}${qs.map(q=>question(q,key,tenses.length>1)).join('')}${type==='writing'&&!key?'<p class="self-check">Check: Does your verb match the subject, gender, number and tense?</p>':''}</section>`;
        }).join('');
        return sections+(notes.length?`<aside class="vocabulary-notes" aria-label="Vocabulary notes"><h3>Vocabulary notes</h3><div class="vocabulary-note-list">${notes.map(note=>`<div class="vocabulary-note" data-note-id="${note.id}"><span>${note.id}.</span> ${he(note.word)} <span>— ${esc(note.translation)}</span></div>`).join('')}</div></aside>`:'');
    }
    return {render};
});

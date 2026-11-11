(function(root,factory){
    if(typeof module==='object' && module.exports)module.exports=factory();
    else root.QuizVocabularyPlan=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const key=value=>String(value ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/gu,' ');
    const category=row=>row.kind==='knowledge'?(row.picture||row.word.length>500?2:1):0;
    const identity=row=>row.kind==='knowledge'?'knowledge:'+(row.sourceId||JSON.stringify([row.word,row.definition,row.picture])):'vocabulary:'+key(row.word);
    const language=word=>/[א-ת]/u.test(word)?0:1;
    const minimum=type=>type==='match'?4:type==='order'?2:1;
    const maximum=type=>type==='match'?6:type==='order'?4:1;
    const answers=q=>(Array.isArray(q.answer)?q.answer:[q.answer]).filter(v=>typeof v==='string' && v.trim());
    function mentions(text,word){
        text=key(text);word=key(word);
        if(!word)return false;
        let at=text.indexOf(word);
        while(at!==-1){
            const before=Array.from(text.slice(0,at)).at(-1) || '',after=Array.from(text.slice(at+word.length))[0] || '';
            if(!/[\p{L}\p{M}\p{N}]/u.test(before) && !/[\p{L}\p{M}\p{N}]/u.test(after))return true;
            at=text.indexOf(word,at+1);
        }
        return false;
    }
    function usage(rows,questions){
        const definitions=new Map();
        rows.forEach((row,i)=>[row.definition,...(row.additionalAnswers || [])].forEach(value=>{
            const normalized=key(value);if(!normalized)return;
            if(!definitions.has(normalized))definitions.set(normalized,new Set());
            definitions.get(normalized).add(i);
        }));
        return rows.map((row,rowIndex)=>{
            const word=key(row.word),numbers=[];
            questions.forEach((q,i)=>{
                const correct=answers(q).map(key);
                if(row.kind==='knowledge'){
                    const saved=(q.vocabularyTerms||[]).some(term=>term.kind==='knowledge' && (row.sourceId?term.sourceId===row.sourceId:key(term.word)===word&&key(term.definition)===key(row.definition)));
                    const direct=!row.picture && (q.type==='match'?(q.items||[]).some((item,j)=>key(item)===word&&key(q.answer?.[j])===key(row.definition)):key(q.prompt)===word&&correct.includes(key(row.definition)));
                    if(saved||direct)numbers.push(i+1);return;
                }
                if((q.vocabularyTerms||[]).some(term=>term.kind==='knowledge') && !(q.vocabularyTerms||[]).some(term=>term.kind!=='knowledge'))return;
                // Answer choices alone are never evidence that a word was tested.
                const paired=q.type==='match' && (q.items || []).some((item,j)=>q.answer?.[j]?.trim() && (key(item)===word || key(q.answer[j])===word));
                const direct=q.type==='match'?paired:q.type==='order'?correct.includes(word):mentions(q.prompt,row.word) || correct.includes(word);
                // Retain identity after a teacher rephrases a generated prompt, but
                // release a target when both its term and its answer have been replaced.
                const saved=(q.vocabularyTerms || []).some(term=>key(term.word)===word && (mentions(q.prompt,term.word) || correct.includes(key(term.definition))));
                // An unambiguous approved answer also identifies a term in older
                // questions whose prompt no longer contains the literal word.
                const byAnswer=correct.some(value=>definitions.get(value)?.size===1 && definitions.get(value).has(rowIndex));
                if(direct || saved || byAnswer)numbers.push(i+1);
            });
            return numbers;
        });
    }
    function sequences(types,count){
        const rounds=Math.floor(count/types.length),extra=count%types.length,result=[];
        function choose(start,selected){
            if(selected.length===extra){
                const sequence=Array.from({length:rounds},()=>types).flat().concat(selected);
                result.push(sequence.map((type,position)=>({type,position})));return;
            }
            for(let i=start;i<types.length;i++)choose(i+1,[...selected,types[i]]);
        }
        choose(0,[]);return result;
    }
    function minimumUses(types,count){
        return Math.floor(count/types.length)*types.reduce((n,t)=>n+minimum(t),0)+types.map(minimum).sort((a,b)=>a-b).slice(0,count%types.length).reduce((n,v)=>n+v,0);
    }
    function allocate(rows,available,types,count){
        if(!types.length || count<types.length || count>100)return null;
        let best=null,total=0;
        for(const sequence of sequences(types,count)){
            const candidate=allocateSequence(rows,available,sequence),uses=candidate?.reduce((n,e)=>n+e.indices.length,0) || 0;
            if(uses>total){best=candidate;total=uses;}
            if(total===available.length)break;
        }
        return best;
    }
    // Allocate constrained groups first. Memoizing counts (rather than word
    // permutations) keeps mixed-language and multiple-answer planning bounded.
    function allocateSequence(rows,available,sequence){
        const slots=sequence.sort((a,b)=>minimum(b.type)-minimum(a.type) || (b.type==='multi')-(a.type==='multi') || a.position-b.position);
        const min=slots.reduce((n,s)=>n+minimum(s.type),0),max=Math.min(available.length,slots.reduce((n,s)=>n+maximum(s.type),0));
        if(min>max)return null;
        const pools=Array.from({length:12},()=>[]);
        for(const index of available)pools[category(rows[index])*4+language(rows[index].word)*2+(rows[index].additionalAnswers?.length?1:0)].push(index);
        const minSuffix=Array(slots.length+1).fill(0),maxSuffix=[...minSuffix],multiSuffix=[...minSuffix];
        for(let i=slots.length-1;i>=0;i--){minSuffix[i]=minSuffix[i+1]+minimum(slots[i].type);maxSuffix[i]=maxSuffix[i+1]+maximum(slots[i].type);multiSuffix[i]=multiSuffix[i+1]+(slots[i].type==='multi'?1:0);}
        const failed=new Set();
        function search(at,remaining,budget){
            if(at===slots.length)return budget===0?[]:null;
            const sizes=remaining.map(p=>p.length),state=at+':'+sizes.join(',')+':'+budget;
            if(failed.has(state))return null;
            if(budget<minSuffix[at] || budget>maxSuffix[at] || budget>sizes.reduce((n,v)=>n+v,0) || sizes.filter((_,i)=>i%2).reduce((n,v)=>n+v,0)<multiSuffix[at])return null;
            const {type,position}=slots[at];
            for(let size=Math.min(maximum(type),budget-minSuffix[at+1]);size>=minimum(type);size--){
                for(let lang=0;lang<(type==='order'?2:type==='match'?4:6);lang++){
                    const candidates=type==='multi'?remaining[lang*2+1]:[...remaining[lang*2],...remaining[lang*2+1]];
                    if(candidates.length<size)continue;
                    const indices=candidates.slice(0,size),selected=new Set(indices);
                    const next=remaining.map(pool=>pool.filter(i=>!selected.has(i)));
                    const rest=search(at+1,next,budget-size);
                    if(rest)return [{type,indices,position},...rest];
                }
            }
            failed.add(state);return null;
        }
        for(let target=max;target>=min;target--){
            const result=search(0,pools,target);
            if(result)return result.sort((a,b)=>a.position-b.position).map(({type,indices})=>({type,indices}));
        }
        return null;
    }
    function analyze(config,questions=[]){
        const rows=config.rows;let types=config.types;
        // A translation pair imported in both directions is still one fact.
        const aliases=rows.map(row=>rows.flatMap((other,i)=>identity(row)===identity(other) || row.kind!=='knowledge'&&other.kind!=='knowledge'&&key(row.word)===key(other.definition) && key(row.definition)===key(other.word)?[i]:[]));
        const directUsage=usage(rows,questions),used=aliases.map(indices=>[...new Set(indices.flatMap(i=>directUsage[i]))].sort((a,b)=>a-b));
        const untested=rows.map((_,i)=>i).filter(i=>!used[i].length);
        const available=untested.filter(i=>!aliases[i].some(j=>j<i && !used[j].length));
        const skippedTypes=[];
        if(rows.some(row=>row.kind==='knowledge'))types=types.filter(type=>{
            const possible=type==='multi'?available.some(i=>rows[i].additionalAnswers?.length):type==='order'?available.filter(i=>category(rows[i])===0).length>=2:type==='match'?[0,1,2,3].some(pool=>available.filter(i=>category(rows[i])*2+language(rows[i].word)===pool).length>=4):true;
            if(!possible)skippedTypes.push(type);return possible;
        });
        if(rows.some(row=>row.kind==='knowledge') && available.length && types.length>available.length){skippedTypes.push(...types.slice(available.length));types=types.slice(0,available.length);}
        const capacity=Math.max(0,100-questions.length);
        let recommended=null,recommendedUses=0;
        if(types.length && rows.every(r=>r.word.trim() && r.definition.trim())){
            for(let count=types.length;count<=Math.min(available.length,capacity);count++){
                if(minimumUses(types,count)>available.length)break;
                const candidate=allocate(rows,available,types,count);
                const total=candidate?.reduce((n,e)=>n+e.indices.length,0) || 0;
                if(total>recommendedUses){recommended=candidate;recommendedUses=total;}
                if(total===available.length)break;
            }
        }
        const suggestedCount=recommended?.length || 0;
        const entries=config.autoCount!==false?recommended:Number.isInteger(config.count) && config.count<=capacity?allocate(rows,available,types,config.count):null;
        const proposed=rows.map(()=>[]);
        (entries || []).forEach((entry,i)=>entry.indices.forEach(index=>aliases[index].forEach(j=>proposed[j].push(questions.length+i+1))));
        const coveredWords=used.filter((numbers,i)=>numbers.length || proposed[i].length).length;
        let error='';
        if(!types.length)error=config.types.length?'These formats cannot represent the selected knowledge questions. Choose written answer, multiple choice, or fill-in-the-blanks to keep pictures. Ordering is for vocabulary; matching needs 4–6 questions without pictures.':'Select at least one question type.';
        else if(rows.some(r=>!r.word.trim() || !r.definition.trim()))error='Complete every word and definition before generating questions.';
        else if(!available.length)error='Every word in this list is already tested in the draft. Replace generated questions or add new words.';
        else if(!capacity)error='This draft already has 100 questions. Remove questions before generating more.';
        else if(!entries)error=suggestedCount?'This question count cannot use each word once. Use the suggested '+suggestedCount+' questions or change the selected types.':'These formats cannot use the remaining words without repeats. Matching needs 4–6 untested terms in one language; ordering needs at least 2. Add a single-word format, deselect a group format, or add additional correct answers for Multiple answers.';
        return {entries:entries || [],error,skippedTypes,suggestedCount,wordCount:rows.length,availableWords:untested.length,existingWords:rows.length-untested.length,coveredWords,untestedWords:rows.length-coveredWords,repeatedUses:0,totalUses:proposed.reduce((n,v)=>n+v.length,0),questionCount:entries?.length || 0,words:rows.map((row,i)=>({word:row.word,existingQuestions:used[i],newQuestions:proposed[i]}))};
    }
    return {analyze,usage};
});

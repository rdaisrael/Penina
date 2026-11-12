'use strict';
// The vocabulary source lives on the draft so loading/duplicating quizzes retains teacher edits.
function distractorLanguage(word){return /[א-ת]/u.test(word)?'English':'Hebrew';}
function vocabularySource(){return quiz.vocabulary?{...quiz.vocabulary,autoCount:quiz.vocabulary.autoCount!==false,wordBank:true}: {rows:[],count:15,types:['choice','match','gaps'],autoCount:true,wordBank:true,direction:'ltr'};}
let vocabularyCoverage=null;
$('openVocabulary').onclick=()=>{
    const panel=$('vocabularyPanel');panel.open=true;
    const target=vocabularySource().rows.length?$('vocabularySettings').querySelector('h2'):panel.querySelector('summary');
    target.focus({preventScroll:true});target.scrollIntoView({block:'start'});
};
$('vocabularyPanel').addEventListener('toggle',()=>{
    $('openVocabulary').setAttribute('aria-expanded',String($('vocabularyPanel').open));
});
function vocabularyMessage(message){$('vocabularyStatus').textContent=message;}
function vocabularyButtons(){
    const panel=$('vocabularyPanel');if(!panel)return;
    for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=busy || !!quiz.published;
    for(const id of ['vocabularyImport','vocabularyRegenerate','vocabularyGenerate','vocabularyMissing','vocabularyLibraryRefresh','vocabularyLibraryImport','vocabularyLibraryApply'])$(id).disabled ||= !connected;
    for(const el of panel.querySelectorAll('[data-vocab-regenerate]'))el.disabled ||= !connected;
    $('vocabularyCount').readOnly=vocabularySource().autoCount;
    $('vocabularyGenerate').disabled ||= !!vocabularyCoverage?.error || !vocabularySource().rows.length;
}
function renderVocabulary(){
    const source=vocabularySource();
    $('vocabularyReview').hidden=!source.rows.length;$('vocabularySettings').hidden=!source.rows.length;
    $('vocabularyCount').value=source.count;$('vocabularyBank').checked=source.wordBank;
    $('vocabularyDirection').value=source.direction;
    $('vocabularyAutomatic').checked=source.autoCount;
    for(const el of $('vocabularyTypes').querySelectorAll('input'))el.checked=source.types.includes(el.value);
    $('vocabularyRows').innerHTML=source.rows.map((r,i)=>`<tr data-vocab-row="${i}"><td><small>${r.kind==='knowledge'?'Knowledge question':'Vocabulary'}</small>${r.kind==='knowledge'?`<textarea data-vocab-field="word" aria-label="Question ${i+1}" maxlength="5000" dir="auto">${esc(r.word)}</textarea>${r.picture?QuizPicture.render({image:{src:r.picture.src,alt:r.picture.alt,marker:r.picture.target,targets:r.picture.targets}}):''}`:`<input data-vocab-field="word" aria-label="Word ${i+1}" value="${esc(r.word)}" maxlength="500" dir="auto">`}</td><td><textarea data-vocab-field="definition" aria-label="Definition ${i+1}" maxlength="500" dir="auto">${esc(r.definition)}</textarea><label>Additional correct answers (for multiple answers)<textarea data-vocab-field="additionalAnswers" aria-label="Additional correct answers ${i+1}" maxlength="5010" dir="auto" placeholder="One additional correct answer per line">${esc((r.additionalAnswers??[]).join('\n'))}</textarea></label></td><td>${r.kind==='knowledge'?`<label>Saved distractor language<select data-knowledge-language aria-label="Distractor language ${i+1}"><option value="english" ${r.knowledgeLanguage!=='hebrew'?'selected':''}>English</option><option value="hebrew" ${r.knowledgeLanguage==='hebrew'?'selected':''}>Hebrew</option></select></label>`:`<small data-distractor-language>${distractorLanguage(r.word)} distractors</small>`}<textarea data-vocab-field="definitionDistractors" aria-label="Distractors ${i+1}" maxlength="5010" dir="auto">${esc(r.definitionDistractors.join('\n'))}</textarea></td><td><button type="button" class="quiet" data-vocab-regenerate="${i}">Regenerate row ${i+1}</button><button type="button" class="quiet" data-vocab-remove="${i}">Remove row ${i+1}</button></td></tr>`).join('');
    $('vocabularyRegenerate').textContent=source.rows.some(r=>r.definitionDistractors.length)?'Regenerate all distractors':'Generate distractors';
    refreshVocabularyCoverage();
    vocabularyButtons();
}
function vocabularyChanged(){changed();vocabularyMessage('Vocabulary edits are unsaved. Save draft to keep your table.');}
async function vocabularyRun(fn){
    if(busy || quiz.published)return;
    await run(async()=>{try{await fn();}catch(error){vocabularyMessage(error.message);throw error;}});
}
$('vocabularyFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file || busy || quiz.published)return;
    if(file.size>100000){vocabularyMessage('Choose a CSV, tab-separated text, or Markdown file smaller than 100 KB.');return;}
    if(!/\.(csv|tsv|txt|md)$/i.test(file.name)){vocabularyMessage('Use a CSV, TSV, TXT, or Markdown file, or paste a two-column table below.');return;}
    await vocabularyRun(async()=>{
        const text=await file.text();
        $('vocabularyPaste').value=text;
        vocabularyMessage('File loaded. Choose Load vocabulary table to review it.');
    });
});
$('vocabularyImport').onclick=()=>vocabularyRun(async()=>{
    const {rows}=await api('import-vocabulary',{text:$('vocabularyPaste').value});
    if(vocabularySource().rows.length && !confirm('Replace the current vocabulary table and its distractors? Existing quiz questions will stay as they are.'))return;
    quiz.vocabulary={...vocabularySource(),rows};changed();renderVocabulary();
    vocabularyMessage(rows.length+' words loaded. Generate distractors, or enter your own in the table.');
});
$('vocabularyRows').addEventListener('input',event=>{
    if(busy || quiz.published)return;
    const row=event.target.closest('[data-vocab-row]'),field=event.target.dataset.vocabField;
    if(!row)return;
    const item=quiz.vocabulary.rows[Number(row.dataset.vocabRow)];
    if(event.target.hasAttribute?.('data-knowledge-language')){
        item.knowledgeDistractors ||= {};item.knowledgeDistractors[item.knowledgeLanguage||'english']=[...item.definitionDistractors];
        item.knowledgeLanguage=event.target.value;item.definitionDistractors=[...(item.knowledgeDistractors[item.knowledgeLanguage]||[])];
        vocabularyChanged();renderVocabulary();return;
    }
    if(!field)return;
    const r=quiz.vocabulary.rows[Number(row.dataset.vocabRow)];
    r[field]=(field.endsWith('Distractors')||field==='additionalAnswers')?event.target.value.split('\n').map(v=>v.trim()).filter(Boolean):event.target.value;
    if(r.kind==='knowledge' && ['word','definition'].includes(field)){
        r.knowledgeDistractors={};r.definitionDistractors=[];
        const choices=row.querySelector?.('[data-vocab-field="definitionDistractors"]');if(choices)choices.value='';
    }
    if(r.kind==='knowledge' && field==='definitionDistractors'){r.knowledgeDistractors ||= {};r.knowledgeDistractors[r.knowledgeLanguage||'english']=[...r.definitionDistractors];}
    if(field==='word'){const label=row.querySelector?.('[data-distractor-language]');if(label)label.textContent=distractorLanguage(r.word)+' distractors';}
    vocabularyChanged();
});
$('vocabularyRows').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button || busy || quiz.published)return;
    if(button.dataset.vocabRegenerate!==undefined)return regenerateVocabulary(Number(button.dataset.vocabRegenerate));
    if(button.dataset.vocabRemove!==undefined){
        const i=Number(button.dataset.vocabRemove);
        if(!confirm('Remove this word and its distractors from the table? Existing questions will stay as they are.'))return;
        quiz.vocabulary.rows.splice(i,1);vocabularyChanged();renderVocabulary();
    }
});
$('vocabularyAdd').onclick=()=>{
    if(busy || quiz.published)return;
    if(quiz.vocabulary.rows.length>=50){vocabularyMessage('Use up to 50 vocabulary words.');return;}
    quiz.vocabulary.rows.push({word:'',definition:'',definitionDistractors:[],wordDistractors:[]});vocabularyChanged();renderVocabulary();
    $('vocabularyRows').lastElementChild.querySelector('input').focus();
};
async function regenerateVocabulary(index,missingOnly=false){
    await vocabularyRun(async()=>{
        const rows=structuredClone(vocabularySource().rows),indices=index===undefined?rows.map((_,i)=>i).filter(i=>!missingOnly || !rows[i].definitionDistractors.length):[index];
        if(!indices.length){vocabularyMessage('Every row already has distractors. Your choices are unchanged.');return;}
        if(indices.some(i=>rows[i].definitionDistractors.length) && !confirm(index===undefined?'Replace all distractors, including your edits?':'Replace the distractors in this row, including your edits?'))return;
        let generated=rows;
        for(let start=0;start<indices.length;start+=10){
            const batch=indices.slice(start,start+10);
            vocabularyMessage('Generating distractors for '+(index===undefined?'words '+(start+1)+'–'+Math.min(start+10,indices.length)+' of '+indices.length:'row '+(index+1))+'…');
            generated=(await api('vocabulary-distractors',{rows:generated,indices:batch})).rows;
        }
        quiz.vocabulary.rows=generated;changed();renderVocabulary();
        vocabularyMessage('Distractors are ready. Edit any suggestion or regenerate a row, then choose your quiz.');
    });
}
$('vocabularyMissing').onclick=()=>regenerateVocabulary(undefined,true);
$('vocabularyRegenerate').onclick=()=>regenerateVocabulary();
for(const id of ['vocabularyCount','vocabularyBank','vocabularyDirection','vocabularyTypes','vocabularyAutomatic'])$(id).addEventListener('change',()=>{
    if(busy || quiz.published)return;
    quiz.vocabulary={...vocabularySource(),count:$('vocabularyAutomatic').checked?(Number($('vocabularyCount').value)||vocabularySource().count):Number($('vocabularyCount').value),autoCount:$('vocabularyAutomatic').checked,wordBank:true,direction:$('vocabularyDirection').value,types:[...$('vocabularyTypes').querySelectorAll('input:checked')].map(el=>el.value)};
    vocabularyChanged();refreshVocabularyCoverage();
});
$('vocabularyCount').addEventListener('input',()=>{
    if(busy || quiz.published || vocabularySource().autoCount)return;
    quiz.vocabulary={...vocabularySource(),count:Number($('vocabularyCount').value)};
    vocabularyChanged();
});
$('vocabularyMode').addEventListener('change',refreshVocabularyCoverage);
$('vocabularyUseSuggestion').onclick=()=>{
    if(busy || quiz.published)return;
    quiz.vocabulary={...vocabularySource(),autoCount:true};$('vocabularyAutomatic').checked=true;vocabularyChanged();refreshVocabularyCoverage();
};
function vocabularyGenerationContext(){
    const replace=$('vocabularyMode').value==='replace';
    const existing=quiz.questions.filter(q=>!replace || q.vocabularyGenerated!==true);
    // Send only question content needed for coverage, never embedded pictures.
    const existingQuestions=existing.map(({type,prompt,answer,items,vocabularyTerms})=>({type,prompt,answer,items,vocabularyTerms}));
    return {existing,existingQuestions,replaced:quiz.questions.length-existing.length,replace};
}
function refreshVocabularyCoverage(){
    const source=vocabularySource(),context=vocabularyGenerationContext();
    vocabularyCoverage=source.rows.length?QuizVocabularyPlan.analyze(source,context.existingQuestions):null;
    const c=vocabularyCoverage;
    if(source.autoCount)$('vocabularyCount').value=c?.suggestedCount || '';
    $('vocabularyCount').readOnly=source.autoCount;
    $('vocabularyUseSuggestion').hidden=source.autoCount || !c?.suggestedCount;
    $('vocabularyUseSuggestion').textContent='Use suggested count'+(c?.suggestedCount?' ('+c.suggestedCount+')':'');
    $('vocabularyGenerate').textContent=context.replace?'Regenerate quiz':'Generate quiz';
    $('vocabularyCoverage').textContent=!c?'Load a wordlist to see the suggested count.':[
        c.suggestedCount?'Suggested: '+c.suggestedCount+' questions.':'',
        c.error || c.questionCount+' new questions · '+c.totalUses+' newly tested words · '+c.existingWords+' words already tested · '+c.coveredWords+' of '+c.wordCount+' words covered · No new repeats.',
        !c.error && c.untestedWords?c.untestedWords+' words remain untested. Add a single-word format or adjust the question count to cover more.':'',
        c.skippedTypes?.length?'Unavailable formats skipped: '+c.skippedTypes.map(type=>({match:'Matching',order:'Ordering',multi:'Multiple answers'})[type]||type).join(', ')+'.':'',
        context.replaced?context.replaced+' generated questions will be replaced.':''
    ].filter(Boolean).join(' ');
    $('vocabularyWordCoverage').innerHTML=c?'<ul>'+c.words.map(w=>'<li><bdi>'+esc(w.word)+'</bdi>: '+(w.existingQuestions.length?'already in question'+(w.existingQuestions.length===1?' ':'s ')+w.existingQuestions.join(', ')+(w.existingQuestions.length>1?' — repeated in the existing draft':''):w.newQuestions.length?'planned for question '+w.newQuestions.join(', '):'not tested')+'</li>').join('')+'</ul>':'';
    vocabularyButtons();
}
$('vocabularyGenerate').onclick=()=>vocabularyRun(async()=>{
    const context=vocabularyGenerationContext();
    const config={...structuredClone(vocabularySource()),existingQuestions:structuredClone(context.existingQuestions)};
    if(!Number.isInteger(config.count)||config.count<1||config.count>100)throw Error('Choose 1–100 questions.');
    vocabularyMessage('Checking vocabulary coverage across the draft…');
    const {coverage}=await api('vocabulary-coverage',config);
    if(coverage.error)throw Error(coverage.error);
    if(context.replaced && !confirm('Replace '+context.replaced+' previously generated questions? Manually added questions will be kept.'))return;
    // Freeze the count and existing questions for all batches; nothing is removed
    // or appended until the complete replacement/addition succeeds.
    config.count=coverage.questionCount;config.autoCount=false;
    const generated=[];
    for(let offset=0;offset<config.count;offset+=10){
        vocabularyMessage('Creating questions '+(offset+1)+'–'+Math.min(offset+10,config.count)+' of '+config.count+'… Your draft will update when all questions are ready.');
        generated.push(...(await api('vocabulary-questions',{...config,offset})).questions);
    }
    if(context.replaced){
        const checkpoint=quiz.questions[quiz.forwardOnlyFrom];
        const next=[...context.existing,...generated];
        const checkpointIndex=checkpoint?next.indexOf(checkpoint):-1;
        quiz.forwardOnlyFrom=checkpointIndex>0?checkpointIndex:null;
        quiz.questions=next;
    }else quiz.questions.push(...generated);
    if(!quiz.title || quiz.title==='Untitled quiz')quiz.title=vocabularySource().rows.some(r=>r.kind==='knowledge')?'Study quiz':'Vocabulary quiz';
    changed();render();
    vocabularyMessage(generated.length+' questions '+(context.replaced?'replaced the previous generated set':'added to your draft')+'. Each newly tested word is used once. Review the questions and answer keys, then save.');
    status('Generated '+generated.length+' editable questions. Review and save your draft before publishing.');
    $('title').focus();
});

renderVocabulary();

let pendingVocabularyImport=null;
function clearVocabularyImport(){pendingVocabularyImport=null;$('vocabularyConflicts').hidden=true;$('vocabularyLibraryApply').hidden=true;}
$('vocabularyLibraryRefresh').onclick=()=>vocabularyRun(async()=>{
    const {sets}=await api('vocabulary-library');
    clearVocabularyImport();
    $('vocabularyLibrary').innerHTML=sets.length?'<fieldset><legend>My saved lists and knowledge lists</legend>'+sets.map(set=>`<label><input type="checkbox" data-vocab-list value="${esc(set.pathname)}">${esc(set.title)} — ${set.kind==='knowledge'?'Knowledge':'Vocabulary'} · ${esc(set.pageName)}</label>`).join('')+'</fieldset>':'<p>No saved lists were found on your vocabulary webpages. Upload or paste a list below.</p>';
    vocabularyMessage(sets.length+' saved lists available.');
});
$('vocabularyLibrary').addEventListener('change',clearVocabularyImport);
$('knowledgeLanguage').addEventListener('change',clearVocabularyImport);
$('vocabularyLibraryImport').onclick=()=>vocabularyRun(async()=>{
    const pathnames=[...$('vocabularyLibrary').querySelectorAll('input:checked')].map(el=>el.value);
    if(!pathnames.length)throw Error('Select at least one saved wordlist.');
    clearVocabularyImport();
    const result=await api('import-vocabulary-library',{pathnames,language:$('knowledgeLanguage').value||'english'});
    pendingVocabularyImport=result;
    $('vocabularyConflicts').innerHTML='<h3>Review selected lists</h3><p>'+result.rows.length+' source items. '+(result.conflicts.length?'Choose a definition for each conflicting word before loading.':'No conflicting definitions found.')+'</p>'+result.conflicts.map(c=>`<label>${esc(c.word)} — choose the correct definition<select data-vocab-conflict="${c.index}"><option value="">Choose a definition…</option>${c.definitions.map((d,i)=>`<option value="${i}">${esc(d)}</option>`).join('')}</select></label>`).join('')+result.warnings.map(w=>'<p>'+esc(w)+'</p>').join('');
    $('vocabularyConflicts').hidden=false;$('vocabularyLibraryApply').hidden=false;
    vocabularyMessage('Review the selected lists, then choose Load reviewed lists. Existing distractors will be preserved.');
});
$('vocabularyLibraryApply').onclick=()=>vocabularyRun(async()=>{
    if(!pendingVocabularyImport)throw Error('Select and review your lists first.');
    const rows=structuredClone(pendingVocabularyImport.rows);
    for(const select of $('vocabularyConflicts').querySelectorAll('select')){
        if(select.value==='')throw Error('Choose a definition for every conflicting word.');
        const conflict=pendingVocabularyImport.conflicts.find(c=>c.index===Number(select.dataset.vocabConflict));
        rows[conflict.index].definition=conflict.definitions[Number(select.value)];
    }
    if(vocabularySource().rows.length && !confirm('Replace the current vocabulary table and its distractors with the reviewed lists? Existing quiz questions will stay as they are.'))return;
    quiz.vocabulary={...vocabularySource(),rows};clearVocabularyImport();changed();renderVocabulary();
    vocabularyMessage(rows.length+' items loaded with saved pictures and distractors. Review the table and use Generate missing distractors for empty cells. Save draft to keep your changes.');
});

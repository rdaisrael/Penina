'use strict';
// The vocabulary source lives on the draft so loading/duplicating quizzes retains teacher edits.
function vocabularySource(){return quiz.vocabulary || {rows:[],count:15,types:['choice','match','gaps'],wordBank:true,direction:'ltr'};}
function vocabularyMessage(message){$('vocabularyStatus').textContent=message;}
function vocabularyButtons(){
    const panel=$('vocabularyPanel');if(!panel)return;
    for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=busy || !!quiz.published;
    for(const id of ['vocabularyImport','vocabularyRegenerate','vocabularyGenerate'])$(id).disabled ||= !connected;
    for(const el of panel.querySelectorAll('[data-vocab-regenerate]'))el.disabled ||= !connected;
}
function renderVocabulary(){
    const source=vocabularySource();
    $('vocabularyReview').hidden=!source.rows.length;$('vocabularySettings').hidden=!source.rows.length;
    $('vocabularyCount').value=source.count;$('vocabularyBank').checked=source.wordBank;
    $('vocabularyDirection').value=source.direction;
    for(const el of $('vocabularyTypes').querySelectorAll('input'))el.checked=source.types.includes(el.value);
    $('vocabularyRows').innerHTML=source.rows.map((r,i)=>`<tr data-vocab-row="${i}"><td><input data-vocab-field="word" aria-label="Word ${i+1}" value="${esc(r.word)}" maxlength="500" dir="auto"></td><td><textarea data-vocab-field="definition" aria-label="Definition ${i+1}" maxlength="500" dir="auto">${esc(r.definition)}</textarea></td><td><textarea data-vocab-field="definitionDistractors" aria-label="Incorrect definitions ${i+1}" maxlength="5010" dir="auto">${esc(r.definitionDistractors.join('\n'))}</textarea></td><td><textarea data-vocab-field="wordDistractors" aria-label="Extra words ${i+1}" maxlength="5010" dir="auto">${esc(r.wordDistractors.join('\n'))}</textarea></td><td><button type="button" class="quiet" data-vocab-regenerate="${i}">Regenerate row ${i+1}</button><button type="button" class="quiet" data-vocab-remove="${i}">Remove row ${i+1}</button></td></tr>`).join('');
    $('vocabularyRegenerate').textContent=source.rows.some(r=>r.definitionDistractors.length||r.wordDistractors.length)?'Regenerate all distractors':'Generate distractors';
    vocabularyButtons();
}
function vocabularyChanged(){changed();vocabularyMessage('Vocabulary edits are unsaved. Save draft to keep your table.');}
async function vocabularyRun(fn){
    if(busy || quiz.published)return;
    await run(async()=>{try{await fn();}catch(error){vocabularyMessage(error.message);throw error;}});
}
$('vocabularyFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file || busy || quiz.published)return;
    if(file.size>100000){vocabularyMessage('Choose a CSV or tab-separated text file smaller than 100 KB.');return;}
    if(!/\.(csv|tsv|txt)$/i.test(file.name)){vocabularyMessage('Save the word list as CSV or tab-separated text, or paste two spreadsheet columns below.');return;}
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
    if(!row || !field)return;
    const r=quiz.vocabulary.rows[Number(row.dataset.vocabRow)];
    r[field]=field.endsWith('Distractors')?event.target.value.split('\n').map(v=>v.trim()).filter(Boolean):event.target.value;
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
async function regenerateVocabulary(index){
    await vocabularyRun(async()=>{
        const rows=structuredClone(vocabularySource().rows),indices=index===undefined?rows.map((_,i)=>i):[index];
        if(indices.some(i=>rows[i].definitionDistractors.length||rows[i].wordDistractors.length) && !confirm(index===undefined?'Replace all distractors, including your edits?':'Replace the distractors in this row, including your edits?'))return;
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
$('vocabularyRegenerate').onclick=()=>regenerateVocabulary();
for(const id of ['vocabularyCount','vocabularyBank','vocabularyDirection','vocabularyTypes'])$(id).addEventListener('change',()=>{
    if(busy || quiz.published)return;
    quiz.vocabulary={...vocabularySource(),count:Number($('vocabularyCount').value),wordBank:$('vocabularyBank').checked,direction:$('vocabularyDirection').value,types:[...$('vocabularyTypes').querySelectorAll('input:checked')].map(el=>el.value)};
    vocabularyChanged();
});
$('vocabularyGenerate').onclick=()=>vocabularyRun(async()=>{
    const config=structuredClone(vocabularySource());
    if(!Number.isInteger(config.count)||config.count<1||config.count>100)throw Error('Choose 1–100 questions.');
    if(!config.types.length)throw Error('Select at least one question type.');
    if(config.count<config.types.length)throw Error('Choose at least one question for each selected type.');
    if(quiz.questions.length+config.count>100)throw Error('A quiz can contain up to 100 questions. Choose a smaller number or start a new quiz.');
    const generated=[];
    for(let offset=0;offset<config.count;offset+=10){
        vocabularyMessage('Creating questions '+(offset+1)+'–'+Math.min(offset+10,config.count)+' of '+config.count+'… Your draft will update when all questions are ready.');
        generated.push(...(await api('vocabulary-questions',{...config,offset})).questions);
    }
    quiz.questions.push(...generated);
    if(!quiz.title || quiz.title==='Untitled quiz')quiz.title='Vocabulary quiz';
    changed();render();
    vocabularyMessage(generated.length+' questions added to your draft. Name your quiz, review the questions and answer keys, and save when ready.');
    status('Generated '+generated.length+' editable questions. Review and save your draft before publishing.');
    $('title').focus();
});
renderVocabulary();

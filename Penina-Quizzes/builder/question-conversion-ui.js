'use strict';
let questionConversion=null,questionConversionUndo=null;
function canUndoQuestionConversion(q){return questionConversionUndo?.quiz===quiz && questionConversionUndo.current===q;}
function clearQuestionConversionUndo(){
    questionConversionUndo=null;$('conversionUndo').hidden=true;
    for(const button of $('questions').querySelectorAll('[data-action="undo-type"]'))button.hidden=true;
}
function renderQuestionConversionUndo(){
    if(questionConversionUndo && (questionConversionUndo.quiz!==quiz || quiz.questions[questionConversionUndo.index]!==questionConversionUndo.current))clearQuestionConversionUndo();
    $('undoConversion').disabled=busy || !!quiz.published;
}
function openQuestionConversion(index){
    if(busy || quiz.published)return;
    const original=quiz.questions[index];if(!QuizQuestionConversion.supported(original))return;
    questionConversion={quiz,index,original,snapshot:JSON.stringify(original),draft:null,uploading:false};
    $('conversionType').disabled=false;$('conversionPicture').disabled=false;
    $('conversionTitle').textContent='Change question '+(index+1)+' type';
    $('conversionType').innerHTML=QuizQuestionConversion.types.filter(type=>type!==QuizQuestionConversion.kind(original)).map(type=>`<option value="${type}">${type==='picture'?'Picture question':names[type]}</option>`).join('');
    $('conversionDialog').showModal();resetQuestionConversion();
}
function resetQuestionConversion(){
    const state=questionConversion;if(!state)return;
    const error=QuizQuestionConversion.blocked(state.original);
    $('conversionError').textContent=error;$('conversionFields').hidden=!!error;$('replaceQuestionType').disabled=!!error;
    $('conversionPreview').innerHTML='';$('conversionImpact').textContent='';
    if(error){state.draft=null;return;}
    state.draft=QuizQuestionConversion.create(state.original,$('conversionType').value,quiz.vocabulary?.rows || []);
    const q=state.draft,gaps=q.type==='gaps',picture=q.pictureQuestion===true;
    $('conversionPrompt').value=gaps?q.sentence:q.prompt;
    $('conversionPromptLabel').textContent=gaps?'Sentence (put <<answer>> around the answer)':'Question';
    $('conversionAnswerField').hidden=gaps;
    $('conversionAnswerLabel').textContent=q.type==='text'?'Model answer':'Correct answer';
    $('conversionAnswer').value=q.type==='text'?q.answer:q.answer[0] || '';
    $('conversionDistractorsField').hidden=q.type==='text';
    $('conversionDistractors').value=q.conversionDistractors.join('\n');
    $('conversionPictureFields').hidden=!picture;
    $('conversionPicture').value='';$('conversionPictureAlt').value=q.image?.alt || '';
    updateQuestionConversion();
}
function conversionValues(){
    const q=structuredClone(questionConversion.draft);
    if(q.type==='gaps')q.sentence=$('conversionPrompt').value;
    else{q.prompt=$('conversionPrompt').value;q.answer=q.type==='text'?$('conversionAnswer').value:[$('conversionAnswer').value];}
    if(q.type!=='text')q.conversionDistractors=$('conversionDistractors').value.split('\n').map(value=>value.trim()).filter(Boolean);
    if(q.pictureQuestion && q.image)q.image.alt=$('conversionPictureAlt').value;
    return QuizQuestionConversion.finish(q);
}
function updateQuestionConversion(){
    if(!questionConversion?.draft)return;
    try{
        const q=conversionValues();
        $('conversionError').textContent='';$('replaceQuestionType').disabled=questionConversion.uploading;
        const answer=q.type==='text'?`<p><strong>Model answer:</strong> <span dir="auto">${esc(q.answer)}</span></p>`:`<ul class="conversion-choices">${q.choices.map(choice=>`<li dir="auto">${esc(choice)}${q.answer.includes(choice)?' <strong>✓ Correct</strong>':''}</li>`).join('')}</ul>`;
        $('conversionPreview').innerHTML=`<h3>Replacement preview</h3>${QuizPicture.render(q)}<p class="conversion-prompt" dir="${q.direction}">${esc(q.prompt)}</p>${answer}`;
        $('conversionImpact').textContent=`Question ${questionConversion.index+1} only · ${maxPoints(q)} ${q.extraCredit?'extra-credit':'total'} points · ${q.type==='text'?'Teacher graded':'Automatically graded'}`+(q.pictureQuestion&&!q.image?'. Upload a picture here or after replacing; a picture is required before publishing.':q.image?'. The picture and its marked locations are kept.':'');
    }catch(error){
        $('conversionError').textContent=error.message;$('replaceQuestionType').disabled=true;
        $('conversionPreview').innerHTML='';$('conversionImpact').textContent='Your original question is unchanged.';
    }
}
$('conversionType').onchange=resetQuestionConversion;
for(const id of ['conversionPrompt','conversionAnswer','conversionDistractors','conversionPictureAlt'])$(id).oninput=updateQuestionConversion;
$('conversionPicture').onchange=async event=>{
    const state=questionConversion,file=event.target.files[0];if(!state?.draft || !file || state.uploading)return;
    state.uploading=true;$('conversionType').disabled=true;$('conversionPicture').disabled=true;$('replaceQuestionType').disabled=true;
    $('conversionError').textContent='Loading picture…';
    try{
        const image=await QuizPicture.read(file);
        if(questionConversion!==state)return;
        if(quiz.questions.reduce((total,q,i)=>total+(i===state.index?image.src.length:q.image?.src.length||0),0)>2500000)throw Error('Use smaller pictures or split this quiz into two quizzes.');
        state.draft.image={...image,alt:$('conversionPictureAlt').value};
        updateQuestionConversion();
    }catch(error){if(questionConversion===state)$('conversionError').textContent=error.message;}
    finally{
        state.uploading=false;
        if(questionConversion===state){$('conversionType').disabled=false;$('conversionPicture').disabled=false;try{conversionValues();$('replaceQuestionType').disabled=false;}catch{}}
    }
};
$('cancelQuestionType').onclick=()=>$('conversionDialog').close();
$('conversionDialog').addEventListener('close',()=>{questionConversion=null;});
$('replaceQuestionType').onclick=()=>{
    const state=questionConversion;if(!state || !state.draft || state.uploading || busy || quiz.published)return;
    try{
        if(state.quiz!==quiz || quiz.questions[state.index]!==state.original || JSON.stringify(state.original)!==state.snapshot)throw Error('The question changed. Close this window and open Change type again.');
        const replacement=conversionValues(),original=structuredClone(state.original);
        quiz.questions[state.index]=replacement;changed();
        questionConversionUndo={quiz,index:state.index,original,current:replacement};
        $('conversionUndo').hidden=false;
        $('conversionUndoMessage').textContent='Question '+(state.index+1)+' changed to '+(replacement.pictureQuestion?'Picture question':names[replacement.type])+'. Undo is available until your next edit or save.';
        $('conversionDialog').close();render();
        status('Question type changed. Review the question and answer key, then save your draft.');
        const article=$('questions').querySelector(`[data-index="${state.index}"]`);
        article.querySelector(replacement.pictureQuestion&&!replacement.image?'[data-picture-file]':'[data-field="prompt"]').focus();
    }catch(error){$('conversionError').textContent=error.message;}
};
$('undoConversion').onclick=()=>{
    const undo=questionConversionUndo;if(!undo || busy || quiz.published || undo.quiz!==quiz || quiz.questions[undo.index]!==undo.current)return;
    quiz.questions[undo.index]=undo.original;changed();render();status('Original question restored. Save your draft when ready.');
};

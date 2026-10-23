'use strict';
const $=id=>document.getElementById(id),names={text:'Written answer',choice:'Multiple choice',multi:'Multiple answers',gaps:'Fill in the blanks',order:'Ordering',match:'Matching'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let quiz={title:'Untitled quiz',durationMinutes:null,questions:[]},dirty=false,busy=false,connected=false;
const status=message=>$('status').textContent=message;
function changed(){dirty=true;summary();status('Unsaved changes. Save your draft when ready.');}
function responseCount(q){return q.type==='gaps'?q.prompt.split('___').length-1:q.type==='match'?q.answer.filter(Boolean).length:q.type==='order'?q.choices.length:q.type==='multi'?q.answer.length:1;}
function maxPoints(q){return q.points*(q.scoringMode==='response'?responseCount(q):1);}
function pointsHint(q){return q.scoringMode==='response'?`${q.points} points × ${responseCount(q)} response${responseCount(q)===1?'':'s'} = ${maxPoints(q)} points maximum${q.type==='multi'?'. All correct choices and no incorrect choices are required for credit.':q.type==='order'?'. The entire sequence must be correct for credit.':''}`:`${q.points} points for the whole question`; }
function summary(){$('summary').textContent=quiz.questions.length+' question'+(quiz.questions.length===1?'':'s')+' · '+quiz.questions.filter(q=>!q.extraCredit).reduce((n,q)=>n+maxPoints(q),0)+' regular points · '+quiz.questions.filter(q=>q.extraCredit).reduce((n,q)=>n+maxPoints(q),0)+' extra-credit points';for(const article of $('questions').querySelectorAll('[data-index]')){const hint=article.querySelector('.scoring-hint');if(hint && quiz.questions[Number(article.dataset.index)])hint.textContent=pointsHint(quiz.questions[Number(article.dataset.index)]);}}
async function api(action,body={}){const r=await fetch('/api/game-scores?game=quiz-builder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})});const data=await r.json();if(!r.ok)throw Error(data.error || 'The request could not be completed.');return data;}
async function run(fn){if(busy)return;busy=true;renderButtons();try{await fn();}catch(e){status(e.message);}finally{busy=false;renderButtons();}}
function renderButtons(){if(typeof vocabularyButtons==='function')vocabularyButtons();for(const id of ['save','publish','add','new','duplicate','refresh'])$(id).disabled=busy || (['save','publish','add'].includes(id) && quiz.published);const previous=quiz.questions.at(-1);$('reuseChoices').disabled=busy || !!quiz.published || !previous || !['choice','multi'].includes(previous.type);$('save').disabled ||= !connected;$('publish').disabled ||= !connected;$('title').disabled=!!quiz.published || busy;$('duration').disabled=!!quiz.published || busy || quiz.durationMinutes===null;for(const id of ['timing','checkpoint','checkpointMessage'])$(id).disabled=!!quiz.published || busy;for(const el of $('questions').querySelectorAll('input,textarea,select,button'))el.disabled=!!quiz.published || busy;}
function options(q,value,blank=true){return (blank?'<option value="">Choose an answer</option>':'')+q.choices.map(c=>`<option value="${esc(c)}" ${c===value?'selected':''}>${esc(c || '(Empty choice)')}</option>`).join('');}
function prepareQuestion(q){
    if(q.type==='order' && !q.answer.length)q.answer=[...q.choices];
    if(q.type==='match' && !q.pairs)q.pairs=[...q.items.map((v,j)=>[v,q.answer[j]||'']),...q.choices.filter(v=>v && !q.answer.includes(v)).map(v=>['',v])];
    if(q.type==='gaps'){if(q.sentence===undefined){let j=0;q.sentence=q.prompt.replace(/___/g,()=> '<<'+(q.answer[j++]||'')+'>>');}q.distractors ??= q.choices.filter(v=>!q.answer.includes(v));}
}
function syncQuestion(q){
    if(q.type==='match'){const terms=q.pairs.filter(p=>p[0].trim());q.items=terms.map(p=>p[0]);q.answer=terms.map(p=>p[1]);q.choices=[...new Set(q.pairs.map(p=>p[1]).filter(Boolean))];}
    if(q.type==='gaps'){q.answer=[];q.prompt=q.sentence.replace(/<<([^<>]+)>>/g,(_,v)=>{q.answer.push(v.trim());return '___';});q.choices=[...new Set([...q.answer,...q.distractors])];q.wordBank=true;}
}
function renderQuestion(q,i){
    prepareQuestion(q);
    const choices=['choice','multi'].includes(q.type)?`<div><label>Choices</label><p class="hint">${q.type==='choice'?'Mark the one correct answer.':'Check every correct answer. Students must select all correct choices and no incorrect choices for credit.'}</p>${q.choices.map((c,j)=>`<div class="choice"><input data-correct="${j}" aria-label="Correct choice ${j+1}" type="${q.type==='choice'?'radio':'checkbox'}" name="key${i}" ${q.answer.includes(c)&&c?'checked':''}><input data-choice="${j}" aria-label="Choice ${j+1}" value="${esc(c)}" dir="auto"><button type="button" data-remove-choice="${j}">×</button></div>`).join('')}<button type="button" data-action="choice-add">Add choice</button></div>`:'';
    const key=q.type==='text'?`<label>Model answer<textarea data-field="answer" dir="auto">${esc(q.answer)}</textarea></label>`:q.type==='match'?`<p>Enter a term and its definition in each pair. Leave either side empty to make the other side a distractor.</p>${q.pairs.map((pair,j)=>`<div class="choice"><label>Term ${j+1}<input data-pair="${j}" data-side="0" value="${esc(pair[0])}" dir="auto"></label><label>Definition ${j+1}<input data-pair="${j}" data-side="1" value="${esc(pair[1])}" dir="auto"></label><button type="button" data-remove-pair="${j}">Remove pair</button></div>`).join('')}<button type="button" data-action="pair-add">Add term / definition pair</button>`:q.type==='order'?`<p>Enter the items in the correct order. Students must place the entire sequence correctly for credit; no partial credit is awarded.</p>${q.answer.map((v,j)=>`<label>Position ${j+1}<input data-position="${j}" value="${esc(v)}" dir="auto"></label><button type="button" data-remove-position="${j}">Remove position ${j+1}</button>`).join('')}<button type="button" data-action="position-add">Add position</button>`:q.type==='gaps'?`<p>Put &lt;&lt;answer&gt;&gt; around each answer in your sentence. Students drag the words below into the blanks.</p><label>Distractor words (one per line)<textarea data-distractors dir="auto">${esc(q.distractors.join('\n'))}</textarea></label>`:'';
    return `<article class="question ${q.extraCredit?'extra-credit':''}" data-index="${i}"><div class="question-head"><strong>${i+1}. ${names[q.type]} <span class="extra-credit-badge" ${q.extraCredit?'':'hidden'}>Extra credit</span></strong><button class="quiet" data-action="up" aria-label="Move question ${i+1} up">↑</button><button class="quiet" data-action="down" aria-label="Move question ${i+1} down">↓</button><button class="quiet" data-action="copy">Duplicate</button><button class="quiet" data-action="remove">Remove</button></div><div class="question-body"><label>Question<textarea data-field="prompt" maxlength="5000" dir="${q.direction}" placeholder="Write your question here…">${esc(q.type==='gaps'?q.sentence:q.prompt)}</textarea></label><label class="half-credit"><input type="checkbox" data-field="extraCredit" ${q.extraCredit?'checked':''}>Extra credit — adds bonus points without increasing the test total</label><div class="q-settings"><div class="points-setting"><label>Points<input type="number" data-field="points" min="${q.allowHalfCredit?0.5:1}" max="100" step="${q.allowHalfCredit?0.5:1}" value="${q.points}"></label><label class="half-credit"><input type="checkbox" data-field="allowHalfCredit" ${q.allowHalfCredit===true?'checked':''}>Allow half credit</label></div><fieldset class="scoring-mode"><legend>Points apply to</legend><label><input type="radio" name="scoring${i}" data-field="scoringMode" value="total" ${q.scoringMode!=='response'?'checked':''}>Pts. per total question</label><label><input type="radio" name="scoring${i}" data-field="scoringMode" value="response" ${q.scoringMode==='response'?'checked':''}>Pts. per correct response</label></fieldset><fieldset><legend>Reading direction</legend><label><input type="radio" name="direction${i}" data-field="direction" value="ltr" ${q.direction==='ltr'?'checked':''}>Left to right</label><label><input type="radio" name="direction${i}" data-field="direction" value="rtl" ${q.direction==='rtl'?'checked':''}>Right to left (Hebrew)</label></fieldset></div><p class="hint scoring-hint">${esc(pointsHint(q))}</p>${choices}${key}</div></article>`;
}
function render(){
    if(typeof renderVocabulary==='function')renderVocabulary();
    $('title').value=quiz.title;$('duration').value=quiz.durationMinutes ?? 60;$('timing').value=quiz.durationMinutes===null?'none':'timed';$('durationField').hidden=quiz.durationMinutes===null;
    if(quiz.forwardOnlyFrom>=quiz.questions.length)quiz.forwardOnlyFrom=null;
    $('checkpoint').innerHTML='<option value="">No checkpoint — students may go back</option>'+quiz.questions.slice(1).map((q,i)=>`<option value="${i+1}">Before question ${i+2}</option>`).join('');
    $('checkpoint').value=quiz.forwardOnlyFrom ?? '';$('checkpointMessageField').hidden=quiz.forwardOnlyFrom==null;
    $('checkpointMessage').value=quiz.checkpointMessage || 'Review your previous answers now. Beginning with the next question, you cannot return to previous questions. The rest of this quiz goes forward only.';$('badge').textContent=quiz.published?'PUBLISHED':'DRAFT';summary();
    $('questions').innerHTML=quiz.questions.map((q,i)=>(i===quiz.forwardOnlyFrom?'<section class="checkpoint-banner"><strong>Review checkpoint</strong><p>'+esc($('checkpointMessage').value)+'</p></section>':'')+renderQuestion(q,i)).join('') || '<p class="muted">A blank page for your next great lesson. Add a question below.</p>';
    $('assign').hidden=!quiz.published;if(quiz.published)$('assign').href='/Penina-Quizzes/custom/teacher.html?quiz='+encodeURIComponent(quiz.id)+'&mode=assign';renderButtons();
}
async function library(){const data=await api('list');connected=true;$('connect').hidden=true;$('account').textContent='Connected as '+data.email;$('library').innerHTML=data.quizzes.map(q=>`<button class="library-item" data-id="${esc(q.id)}">${esc(q.title)}<small>${q.published?'Published':'Draft'} · ${q.count} question${q.count===1?'':'s'}</small></button>`).join('') || '<p class="muted">Your saved quizzes will appear here.</p>';renderButtons();}
function leave(){return !dirty || confirm('Discard unsaved changes to this quiz?');}
$('library').addEventListener('click',e=>{const button=e.target.closest('[data-id]');if(!button || busy || !leave())return;run(async()=>{quiz=(await api('load',{id:button.dataset.id})).quiz;dirty=false;render();status(quiz.published?'Published quiz. Duplicate it to create a revised version.':'Draft loaded.');});});
$('new').onclick=()=>{if(busy || !leave())return;quiz={title:'',durationMinutes:null,questions:[]};for(const key of Object.keys(sessionStorage))if(key.startsWith('ppquiz-preview:'))sessionStorage.removeItem(key);dirty=false;$('vocabularyPaste').value='';$('vocabularyFile').value='';$('vocabularyStatus').textContent='';$('type').selectedIndex=0;render();status('Start by adding your first question.');};
$('duplicate').onclick=()=>{if(busy)return;quiz=structuredClone(quiz);delete quiz.id;delete quiz.owner;delete quiz.updatedAt;quiz.published=false;quiz.title+=' (copy)';dirty=true;render();status('Copy created. Save it as a new draft.');};
$('title').oninput=e=>{quiz.title=e.target.value;changed();};$('duration').oninput=e=>{quiz.durationMinutes=Number(e.target.value);changed();};
$('timing').onchange=e=>{quiz.durationMinutes=e.target.value==='none'?null:60;changed();render();};
$('checkpoint').onchange=e=>{quiz.forwardOnlyFrom=e.target.value===''?null:Number(e.target.value);quiz.checkpointMessage=$('checkpointMessage').value;changed();render();};
$('checkpointMessage').oninput=e=>{quiz.checkpointMessage=e.target.value;changed();};
$('add').onclick=()=>{const type=$('type').value;quiz.questions.push({type,prompt:'',points:1,scoringMode:'total',allowHalfCredit:false,direction:'ltr',answer:type==='text'?'':[],...(type!=='text'?{choices:['','']}: {}),...(type==='match'?{items:['','']}:{}),...(type==='gaps'?{wordBank:true}:{})});changed();render();$('questions').lastElementChild.querySelector('textarea').focus();};
$('reuseChoices').onclick=()=>{
    const previous=quiz.questions.at(-1);
    if(busy || quiz.published || !previous || !['choice','multi'].includes(previous.type))return;
    quiz.questions.push({...structuredClone(previous),prompt:'',answer:[]});
    changed();render();$('questions').lastElementChild.querySelector('textarea').focus();
};
$('questions').addEventListener('input',e=>{
    const article=e.target.closest('[data-index]');if(!article || quiz.published)return;const q=quiz.questions[Number(article.dataset.index)],el=e.target;
    if(el.dataset.pair!==undefined){q.pairs[Number(el.dataset.pair)][Number(el.dataset.side)]=el.value;syncQuestion(q);changed();return;}
    if(el.dataset.position!==undefined){q.answer[Number(el.dataset.position)]=el.value;q.choices=[...q.answer];changed();return;}
    if(el.hasAttribute('data-distractors')){q.distractors=el.value.split('\n').map(v=>v.trim()).filter(Boolean);syncQuestion(q);changed();return;}
    if(q.type==='gaps' && el.dataset.field==='prompt'){q.sentence=el.value;syncQuestion(q);changed();return;}
    if(el.dataset.field==='wordBank'){q.wordBank=el.checked;if(q.wordBank)q.choices=[...new Set([...q.choices,...q.answer].filter(v=>v.trim()))];changed();render();return;}
    if(el.dataset.field){q[el.dataset.field]=el.type==='checkbox'?el.checked:el.dataset.field==='points'?Number(el.value):el.value;if(el.dataset.field==='allowHalfCredit'){const points=article.querySelector('[data-field=points]');points.min=el.checked?'0.5':'1';points.step=el.checked?'0.5':'1';}}
    else if(el.dataset.item!==undefined){q.items[Number(el.dataset.item)]=el.value;}
    else if(el.dataset.choice!==undefined){const j=Number(el.dataset.choice),old=q.choices[j];q.choices[j]=el.value;q.answer=q.answer.map(v=>v===old && old!==''?el.value:v);for(const select of article.querySelectorAll('select[data-answer]'))select.innerHTML=options(q,q.answer[Number(select.dataset.answer)]);}
    else if(el.dataset.correct!==undefined){const c=q.choices[Number(el.dataset.correct)];q.answer=q.type==='choice'?[c]:el.checked?[...q.answer.filter(v=>v!==c),c]:q.answer.filter(v=>v!==c);}
    else if(el.dataset.answer!==undefined){q.answer=Array.from({length:q.type==='match'?q.items.length:q.type==='order'?q.choices.length:q.prompt.split('___').length-1},(_,j)=>q.answer[j] || '');q.answer[Number(el.dataset.answer)]=el.value;}
    if(el.dataset.field==='direction')article.querySelector('[data-field=prompt]').dir=q.direction;
    article.classList.toggle('extra-credit',q.extraCredit===true);article.querySelector('.extra-credit-badge').hidden=!q.extraCredit;
    changed();
});
$('questions').addEventListener('click',e=>{
    const button=e.target.closest('button'),article=e.target.closest('[data-index]');if(!button || !article || quiz.published)return;const i=Number(article.dataset.index),q=quiz.questions[i],action=button.dataset.action;
    if(action==='pair-add')q.pairs.push(['','']);
    if(button.dataset.removePair!==undefined)q.pairs.splice(Number(button.dataset.removePair),1);
    if(action==='position-add')q.answer.push('');
    if(button.dataset.removePosition!==undefined)q.answer.splice(Number(button.dataset.removePosition),1);
    if(q.type==='match')syncQuestion(q);
    if(q.type==='order')q.choices=[...q.answer];
    if(action==='remove'){if(!confirm('Remove this question?'))return;quiz.questions.splice(i,1);}
    if(action==='copy')quiz.questions.splice(i+1,0,structuredClone(q));
    if(action==='up' && i>0)[quiz.questions[i-1],quiz.questions[i]]=[q,quiz.questions[i-1]];
    if(action==='down' && i<quiz.questions.length-1)[quiz.questions[i+1],quiz.questions[i]]=[q,quiz.questions[i+1]];
    if(action==='choice-add'){if(q.choices.length>=50){status('Use up to 50 choices.');return;}q.choices.push('');}
    if(button.dataset.removeChoice!==undefined){const j=Number(button.dataset.removeChoice),removed=q.choices.splice(j,1)[0];q.answer=['gaps','match','order'].includes(q.type)?q.answer.map(v=>v===removed?'':v):q.answer.filter(v=>v!==removed);}
    if(action==='item-add'){if(q.items.length>=50){status('Use up to 50 matching items.');return;}q.items.push('');q.answer=Array.from({length:q.items.length},(_,j)=>q.answer[j] || '');}
    if(button.dataset.removeItem!==undefined){const j=Number(button.dataset.removeItem);q.items.splice(j,1);q.answer.splice(j,1);}
    if(action==='blanks')q.answer=Array.from({length:q.prompt.split('___').length-1},(_,j)=>q.answer[j] || '');
    changed();render();
});
async function save(){status('Saving draft…');const data=await api('save',{id:quiz.id,quiz});quiz=data.quiz;dirty=false;render();status('Draft saved.');await library();}
$('save').onclick=()=>run(save);$('refresh').onclick=()=>run(library);
$('publish').onclick=()=>$('publishDialog').showModal();$('cancelPublish').onclick=()=>$('publishDialog').close();
$('confirmPublish').onclick=()=>{if(busy)return;$('publishDialog').close();run(async()=>{await save();quiz=(await api('publish',{id:quiz.id})).quiz;dirty=false;render();status('Published. Open teacher tools to assign this quiz to a class.');await library();});};
$('connect').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type="submit"]');button.disabled=true;try{const r=await fetch('/api/game-scores?game=quiz-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',role:'teacher',builder:true,password:e.target.elements.password.value})});const data=await r.json();if(!r.ok)throw Error(data.error);if(dirty && !confirm('Connecting will leave this page. Copy any unsaved questions before continuing. Continue?'))return;location.assign(data.url);}catch(err){$('account').textContent=err.message;}finally{button.disabled=false;}};
$('preview').onclick=()=>{const key='ppquiz-preview:'+crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify(quiz));window.open('/Penina-Quizzes/custom/?preview='+encodeURIComponent(key),'_blank');};
$('closePreview').onclick=()=>$('previewDialog').close();
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
render();library().catch(e=>{$('account').textContent=e.message;renderButtons();});

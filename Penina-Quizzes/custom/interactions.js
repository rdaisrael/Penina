'use strict';
const QuizInteractions=(()=>{
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle=a=>a.map(v=>({v,r:Math.random()})).sort((a,b)=>a.r-b.r).map(x=>x.v);
function controls(q,i){
 const choices=shuffle(q.choices||[]), hidden=j=>`<input type="hidden" name="q${i}-${j}">`;
 if(q.type==='choice'||q.type==='multi')return `<fieldset><legend>${q.type==='choice'?'Choose one answer':'Check all that apply'}</legend>${choices.map(c=>`<label class="choice"><input type="${q.type==='choice'?'radio':'checkbox'}" name="${q.type==='choice'?`q${i}-0`:`q${i}-choice-${q.choices.indexOf(c)}`}" value="${esc(c)}"><span dir="auto">${esc(c)}</span></label>`).join('')}</fieldset>`;
 if(q.type==='text')return `<label>Your answer<textarea name="q${i}-0" dir="auto" maxlength="5000"></textarea></label>`;
 if(q.type==='match')return `<p>Drag a line from a term to its definition, or select each end. ${Number.isInteger(q.responseCount)?`Make ${q.responseCount} matches. `:''}Some terms and definitions are distractors. Select a connected term twice to clear its line.</p><div class="match-board" dir="ltr"><svg aria-hidden="true"></svg><div>${shuffle(q.items.map((v,j)=>({v,j}))).map(({v,j})=>`<div>${hidden(j)}<button type="button" draggable="true" class="match-term" data-term="${j}" dir="auto">${esc(v)}</button></div>`).join('')}</div><div>${choices.map(c=>`<button type="button" class="match-definition" data-value="${esc(c)}" dir="auto">${esc(c)}</button>`).join('')}</div></div>`;
 if(q.type==='gaps' && q.wordBank===false)return `<div class="sentence" dir="${q.direction}">${q.prompt.split('___').map((v,j,a)=>esc(v)+(j<a.length-1?`<input name="q${i}-${j}" aria-label="Blank ${j+1}" dir="auto">`:'')).join('')}</div>`;
 const slot=(j,label)=>`<span class="answer-slot">${hidden(j)}<button type="button" class="drop-slot" data-slot="${j}" data-label="${label}" aria-label="${label}: empty" dir="auto">${label}</button></span>`;
 const slots=q.type==='gaps'?`<div class="sentence" dir="${q.direction}">${q.prompt.split('___').map((v,j,a)=>esc(v)+(j<a.length-1?slot(j,'Blank '+(j+1)):'')).join('')}</div>`:`<div class="ordering" dir="${q.direction}">${q.choices.map((_,j)=>slot(j,'Position '+(j+1))).join('')}</div>`;
 return `<p>Drag a word into place, or select a word and then its place. Select a filled place to clear it.</p>${slots}<div class="drag-words">${choices.map(c=>`<button type="button" draggable="true" class="drag-word" data-value="${esc(c)}" dir="auto">${esc(c)}</button>`).join('')}</div>`;
}
function refresh(root){
 root.querySelectorAll('.drop-slot').forEach(b=>{const value=b.previousElementSibling.value,label=b.dataset.label;b.textContent=value||label;b.setAttribute('aria-label',label+': '+(value||'empty'));});
 root.querySelectorAll('.match-board').forEach(board=>{
 const svg=board.querySelector('svg'),rect=board.getBoundingClientRect();svg.innerHTML='';
 board.querySelectorAll('[data-term]').forEach(term=>{const value=term.previousElementSibling.value,def=[...board.querySelectorAll('[data-value]')].find(b=>b.dataset.value===value);term.classList.toggle('connected',!!def);term.setAttribute('aria-label',term.textContent+(def?' — matched to '+value:' — unmatched'));if(!def)return;const a=term.getBoundingClientRect(),b=def.getBoundingClientRect();const line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [k,v] of Object.entries({x1:a.right-rect.left,y1:a.top+a.height/2-rect.top,x2:b.left-rect.left,y2:b.top+b.height/2-rect.top}))line.setAttribute(k,v);svg.append(line);});
 });
}
function bind(root,onChange,canEdit=()=>true){
 let selected=null;
 function select(b){root.querySelectorAll('.selected').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});selected=b;if(b){b.classList.add('selected');b.setAttribute('aria-pressed','true');}}
 function act(b){const section=b.closest('[data-question]');if(!section || !canEdit(Number(section.dataset.question)) || b.disabled)return;
 if(b.matches('.drag-word,.match-term')){if(selected===b && b.matches('.match-term')){b.previousElementSibling.value='';select(null);refresh(root);onChange();}else select(b);return;}
 if(b.matches('.drop-slot')){const value=selected?.matches('.drag-word')&&selected.closest('[data-question]')===section?selected.dataset.value:'';if(section.querySelector('.ordering')&&value)section.querySelectorAll('input[type=hidden]').forEach(c=>{if(c.value===value)c.value='';});b.previousElementSibling.value=value;select(null);}
 else if(b.matches('.match-definition') && selected?.matches('.match-term') && selected.closest('[data-question]')===section){selected.previousElementSibling.value=b.dataset.value;select(null);}else return;
 refresh(root);onChange();
 }
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(b)act(b);});
 root.addEventListener('dragstart',e=>{const b=e.target.closest('.drag-word,.match-term');if(!b)return;const i=Number(b.closest('[data-question]').dataset.question);if(!canEdit(i)){e.preventDefault();return;}select(b);e.dataTransfer.setData('text/plain',b.textContent);});
 root.addEventListener('dragover',e=>{if(e.target.closest('.drop-slot,.match-definition'))e.preventDefault();});
 root.addEventListener('drop',e=>{const b=e.target.closest('.drop-slot,.match-definition');if(b){e.preventDefault();act(b);}});
 window.addEventListener('resize',()=>refresh(root));
 return ()=>refresh(root);
}
return {controls,bind,refresh};
})();

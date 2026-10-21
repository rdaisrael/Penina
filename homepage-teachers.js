
'use strict';
(() => {
const $ = id => document.getElementById(id);
function hideManagement() {
    $('teacher-numbers').hidden = true;
    $('teacher-list').replaceChildren();
    $('assign-teacher').reset();
    $('teacher-number-status').textContent = '';
}
async function checkOwner() {
    hideManagement();
    try {
        const response = await fetch('/api/game-scores?game=quiz-account&action=teacher', {cache:'no-store'});
        if (!response.ok) return;
        const user = await response.json();
        if (user.userId !== 1 || user.email?.toLowerCase() !== 'disrael@saracademy.org') return;
        await teacherNumbers();
        $('teacher-numbers').hidden = false;
    } catch (_) { hideManagement(); }
}
window.addEventListener('pageshow', checkOwner);
window.addEventListener('pagehide', hideManagement);

async function teacherNumbers(body) {
    const response=await fetch('/api/vocabulary-pages?action=teachers',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action:'teachers'})}:{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error || 'Teacher numbers could not be loaded.');
    $('teacher-list').replaceChildren();
    for(const teacher of data.teachers){const item=document.createElement('li');item.textContent=teacher.userId+' — '+teacher.name+' ('+teacher.email+')';$('teacher-list').append(item);}
}
$('load-teachers').onclick=async()=>{try{await teacherNumbers();$('teacher-number-status').textContent='';}catch(error){$('teacher-number-status').textContent=error.message;}};
$('assign-teacher').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');button.disabled=true;
    try{await teacherNumbers(Object.fromEntries(new FormData(form)));form.reset();$('teacher-number-status').textContent='Teacher number assigned. Give the teacher their number and sign-in password.';}
    catch(error){$('teacher-number-status').textContent=error.message;}finally{button.disabled=false;}
};

})();

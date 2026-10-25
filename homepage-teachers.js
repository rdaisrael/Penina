
'use strict';
(() => {
const $ = id => document.getElementById(id);
const appChoices=[['reader','PeninaPlus Hebrew Reader'],['vocabulary','PeninaPlus Vocabulary Builder'],['binyan','PeninaPlus Binyan Builder'],['quizzes','Penina Quizzes']];
function showApps(user) {
    const apps=user?.userId===1?['reader','vocabulary','binyan','quizzes']:(user?.apps || []);
    document.querySelectorAll('[data-webapp]').forEach(card=>{card.hidden=!apps.includes(card.dataset.webapp);});
    $('app-access-status').textContent=user?(apps.length?'':'No webapps have been assigned to you yet. Contact David Israel for access.'):'Sign in to see your available webapps.';
}
function hideManagement() {
    showApps(null);
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
        showApps(user);
        if (user.userId !== 1 || user.email?.toLowerCase() !== 'disrael@saracademy.org') return;
        await teacherNumbers();
        $('teacher-numbers').hidden = false;
    } catch (_) { hideManagement(); }
}
window.addEventListener('pageshow', checkOwner);
window.addEventListener('pagehide', hideManagement);

async function teacherRequest(body) {
    const response=await fetch('/api/vocabulary-pages?action=teachers',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action:'teachers'})}:{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error || 'Teacher numbers could not be loaded.');
    return data;
}
async function teacherNumbers(body) {
    const data=await teacherRequest(body);
    $('teacher-list').replaceChildren();
    for(const teacher of data.teachers){
        const item=document.createElement('li');
        item.textContent=teacher.userId+' — '+teacher.name+' ('+teacher.email+')';
        if(teacher.userId!==1){
            const button=document.createElement('button');
            button.type='button';button.textContent='Delete user';
            button.setAttribute('aria-label','Delete user '+teacher.name+' ('+teacher.email+')');
            const deletePages=document.createElement('input');deletePages.type='checkbox';deletePages.checked=!!teacher.deletingPages;
            const deletePagesLabel=document.createElement('label');deletePagesLabel.className='delete-webpages-option';
            deletePagesLabel.append(deletePages,document.createTextNode('Also permanently delete this user’s webpages and their published content'));
            button.onclick=async()=>{
                const removePages=deletePages.checked;
                const warning=removePages?'Permanently delete '+teacher.name+' ('+teacher.email+'), teacher #'+teacher.userId+', AND all of their webpages and published content? This cannot be undone. Their quizzes will be kept.':'Delete '+teacher.name+' ('+teacher.email+'), teacher #'+teacher.userId+'? They will lose teacher access. Their quizzes and webpages will be kept, and their number will remain reserved.';
                if(!window.confirm(warning))return;
                button.disabled=true;
                try{await teacherNumbers({operation:'delete',userId:teacher.userId,email:teacher.email,deleteWebpages:removePages,confirmPermanentDeletion:removePages});$('teacher-number-status').textContent=removePages?'User and webpages permanently deleted. Their quizzes have been kept.':'User deleted. Their quizzes and webpages have been kept.';}
                catch(error){$('teacher-number-status').textContent=error.message;button.disabled=false;}
            };
            item.append(button,deletePagesLabel);
            const resend=document.createElement('button');resend.type='button';resend.textContent='Resend welcome email';
            resend.onclick=async()=>{resend.disabled=true;try{const result=await teacherNumbers({operation:'welcome',userId:teacher.userId});$('teacher-number-status').textContent=result.welcomeEmail?.status==='accepted'?'Welcome email sent.':'User exists, but the welcome email was not sent. '+(result.welcomeEmail?.error || 'Please retry.');}catch(error){$('teacher-number-status').textContent=error.message;}finally{resend.disabled=false;}};
            item.append(resend);
            const access=document.createElement('fieldset');access.className='user-app-access';access.disabled=!!teacher.deletingPages;
            const legend=document.createElement('legend');legend.textContent='Webapp access';access.append(legend);
            const checks=appChoices.map(([id,name])=>{
                const label=document.createElement('label'),input=document.createElement('input');
                input.type='checkbox';input.value=id;input.checked=(teacher.apps || appChoices.map(app=>app[0])).includes(id);
                label.append(input,document.createTextNode(name));access.append(label);return input;
            });
            const save=document.createElement('button');save.type='button';save.textContent='Save access';
            save.setAttribute('aria-label','Save webapp access for '+teacher.name);
            const accessStatus=document.createElement('p');accessStatus.setAttribute('role','status');
            checks.forEach(input=>{input.onchange=()=>{accessStatus.textContent='Unsaved access changes';};});
            save.onclick=async()=>{
                const apps=checks.filter(input=>input.checked).map(input=>input.value);
                access.disabled=true;accessStatus.textContent='Saving access…';
                try{await teacherRequest({operation:'access',userId:teacher.userId,email:teacher.email,apps});teacher.apps=apps;accessStatus.textContent=apps.length?'Access saved.':'Access saved. No webapps are enabled for this user.';}
                catch(error){accessStatus.textContent=error.message;}
                finally{access.disabled=!!teacher.deletingPages;}
            };
            access.append(save,accessStatus);item.append(access);
        }
        $('teacher-list').append(item);
    }
    return data;
}
$('load-teachers').onclick=async()=>{try{await teacherNumbers();$('teacher-number-status').textContent='';}catch(error){$('teacher-number-status').textContent=error.message;}};
$('assign-teacher').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');button.disabled=true;
    try{const fields=new FormData(form);const result=await teacherNumbers({...Object.fromEntries(fields),apps:fields.getAll('apps')});form.reset();$('teacher-number-status').textContent=result.welcomeEmail?.status==='accepted'?'Teacher added. Welcome email sent with Google sign-in instructions.':'Teacher added, but the welcome email was not sent. '+(result.welcomeEmail?.error || 'Use Resend welcome email to retry.');}
    catch(error){$('teacher-number-status').textContent=error.message;}finally{button.disabled=false;}
};

})();

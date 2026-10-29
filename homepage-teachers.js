
'use strict';
(() => {
const $ = id => document.getElementById(id);
let accountCheck = 0;
const appChoices=[['reader','Penina Hebrew Reader'],['vocabulary','Penina Vocabulary Builder'],['binyan','Penina Binyan Builder'],['quizzes','Penina Quizzes']];
function greetingName(name) {
    const parts=String(name || '').trim().split(/\s+/);
    const titled=/^(mr|mrs|ms|miss|mx|dr|prof|professor|rabbi|rav|reb|rebbe|rebbetzin|rebbitzen|morah|mora|moreh|chazzan|cantor)\.?$/i.test(parts[0]);
    return titled && parts.length>1 ? parts[0]+' '+parts[parts.length-1] : parts[0];
}
function showAccount(user) {
    const name=greetingName(user?.name);
    $('account-greeting').textContent=user?'Welcome'+(name?' '+name:''):'';
    $('signed-in-account').hidden=!user;
    $('teacher-signin').hidden=!!user && $('email-signin-confirm').hidden;
    $('account-error').textContent='';
}
$('account-logout').onclick=async()=>{
    const button=$('account-logout');button.disabled=true;
    try {
        const response=await fetch('/api/game-scores?game=quiz-account&action=logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        if(!response.ok)throw Error('Could not log out. Please try again.');
        hideManagement();
    } catch(error) { $('account-error').textContent=error.message; }
    finally { button.disabled=false; }
};
$('teacher-signin-button').onclick=async()=>{
    const button=$('teacher-signin-button');button.disabled=true;$('teacher-signin-status').textContent='Connecting to Google…';
    try {
        const response=await fetch('/api/game-scores?game=quiz-account&action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'teacher',portal:true,returnHome:true})});
        const result=await response.json();
        if(!response.ok)throw Error(result.error || 'Google sign-in could not be started. Please try again.');
        if(typeof result.url!=='string')throw Error('Google sign-in could not be started. Please try again.');
        location.assign(result.url);
    } catch(error) {$('teacher-signin-status').textContent=error.message;button.disabled=false;}
};
async function emailRequest(action,body) {
    const response=await fetch('/api/game-scores?game=quiz-account&action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error || 'Email sign-in could not be completed. Please try again.');
    return result;
}
function showPasswordChange() {
    hideManagement();
    $('teacher-signin').hidden=true;
    $('password-change-panel').hidden=false;
}
$('password-signin-form').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    $('teacher-signin-status').textContent='Signing in…';
    try {
        const result=await emailRequest('password-login',{email:$('password-email').value,password:$('signin-password').value});
        $('signin-password').value='';
        if(result.passwordChangeRequired)showPasswordChange();else location.replace('/');
    } catch(error){$('teacher-signin-status').textContent=error.message;}
    finally{button.disabled=false;}
};
$('password-change-form').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('button');
    if($('new-password').value!==$('confirm-password').value){$('password-change-status').textContent='The passwords do not match.';return;}
    button.disabled=true;$('password-change-status').textContent='Saving your password…';
    try {
        await emailRequest('password-change',{password:$('new-password').value});
        $('new-password').value='';$('confirm-password').value='';location.replace('/');
    } catch(error){$('password-change-status').textContent=error.message;}
    finally{button.disabled=false;}
};
$('password-change-cancel').onclick=async()=>{
    try{await emailRequest('logout',{});location.replace('/');}
    catch(error){$('password-change-status').textContent=error.message;}
};
// Keep the credential out of server request URLs and remove it from browser history.
if(typeof location!=='undefined' && location.hash.startsWith('#email-signin=')) {
    const token=location.hash.slice('#email-signin='.length);
    history.replaceState(null,'',location.pathname+location.search);
    $('email-signin-confirm').hidden=false;
    $('email-signin-confirm-button').onclick=async()=>{
        const button=$('email-signin-confirm-button');button.disabled=true;
        $('teacher-signin-status').textContent='Signing in…';
        try {const result=await emailRequest('email-verify',{token});if(result.passwordChangeRequired)showPasswordChange();else location.replace('/');}
        catch(error){$('teacher-signin-status').textContent=error.message;button.disabled=false;}
    };
}
function showApps(user) {
    const apps=user?.userId===1?['reader','vocabulary','binyan','quizzes']:(user?.apps || []);
    document.querySelectorAll('[data-webapp]').forEach(card=>{card.hidden=!apps.includes(card.dataset.webapp);});
    $('app-access-status').textContent=user?(apps.length?'':'No webapps have been assigned to you yet. Contact David Israel for access.'):'';
}
async function showWebpages(check) {
    $('your-webpages').hidden=false;
    $('your-webpages-status').textContent='Loading your webpages…';
    $('your-webpages-list').replaceChildren();
    try {
        const response=await fetch('/api/vocabulary-pages?action=my-pages',{cache:'no-store'});
        const data=await response.json();
        if(check!==accountCheck)return;
        if(!response.ok)throw Error(data.error || 'Your webpages could not be loaded. Refresh the page to try again.');
        for(const page of data.pages || []) {
            // Public page links must stay within Penina's published webpage routes.
            if(typeof page.url!=='string' || !page.url.startsWith('/PeninaPlus-vocab-builder/flash-cards/'))continue;
            const item=document.createElement('li'),link=document.createElement('a');
            link.href=page.url;link.textContent=page.name;item.append(link);$('your-webpages-list').append(item);
        }
        $('your-webpages-status').textContent=data.pages?.length?'':'You haven’t published any webpages yet.';
    } catch(error) {
        if(check===accountCheck)$('your-webpages-status').textContent=error.message;
    }
}
function hideManagement() {
    $('your-webpages').hidden=true;
    $('your-webpages-list').replaceChildren();
    $('your-webpages-status').textContent='';
    $('password-change-panel').hidden=true;
    accountCheck++;
    window.PeninaVideos?.hide();
    showAccount(null);
    showApps(null);
    $('teacher-numbers').hidden = true;
    $('teacher-list').replaceChildren();
    $('assign-teacher').reset();
    $('teacher-number-status').textContent = '';
    $('assign-teacher-status').textContent = '';
}
async function loadManagement(check) {
    $('teacher-numbers').hidden=false;
    const button=$('teacher-retry');
    if(button.disabled)return;
    button.disabled=true;button.textContent='Refreshing users…';
    $('teacher-number-status').textContent='Loading users…';
    try {
        const data=await teacherNumbers(undefined,check);
        if(check===accountCheck)$('teacher-number-status').textContent='User list refreshed. '+data.teachers.length+' users.';
    } catch(error) {
        if(check===accountCheck)$('teacher-number-status').textContent=error.message;
    } finally {button.disabled=false;button.textContent='Refresh users';}
}
$('teacher-retry').onclick=()=>loadManagement(accountCheck);
$('webpages-retry').onclick=()=>showWebpages(accountCheck);
async function checkOwner() {
    hideManagement();
    const check = accountCheck;
    let user;
    try {
        const response = await fetch('/api/game-scores?game=quiz-account&action=teacher', {cache:'no-store'});
        if(check!==accountCheck)return;
        if(response.status===401)return;
        user=await response.json();
        if(check!==accountCheck)return;
        if(!response.ok || !user)throw Error(user?.error || 'Your account could not be loaded. Please refresh to try again.');
    } catch(error) {
        if(check===accountCheck)$('teacher-signin-status').textContent=error.message;
        return;
    }
    if(user.passwordChangeRequired){showPasswordChange();return;}
    showAccount(user);
    showApps(user);
    const loading=[showWebpages(check)];
    if(user.userId===1 && user.email?.toLowerCase()==='disrael@saracademy.org') {
        loading.push(loadManagement(check));
        window.PeninaVideos?.show(user);
    }
    await Promise.all(loading);
}
window.addEventListener('pageshow', checkOwner);
window.addEventListener('pagehide', hideManagement);

async function teacherRequest(body) {
    let response,data;
    try {
        response=await fetch('/api/vocabulary-pages?action=teachers',{
            ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action:'teachers'})}:{cache:'no-store'}),
            signal:AbortSignal.timeout(30000)
        });
        try {data=await response.json();}
        catch(_){throw Error('The user service returned an unreadable response. Refresh users to check the current list.');}
    } catch(error) {
        if(error.name==='TimeoutError' || error.name==='AbortError')throw Error(body?'The request timed out. It may still have completed. Refresh users before trying again.':'Loading users timed out. Please try Refresh users again.');
        throw error;
    }
    if(!response.ok)throw Error(data.error || 'Users could not be loaded or saved. Please try again.');
    return data;
}
async function teacherNumbers(body,check=accountCheck) {
    const data=await teacherRequest(body);
    if(check!==accountCheck)return data;
    $('teacher-list').replaceChildren();
    for(const teacher of data.teachers){
        const item=document.createElement('li');
        item.textContent=teacher.userId+' — '+teacher.name+' ('+teacher.email+')';
        if(teacher.userId!==1){
            const button=document.createElement('button');
            button.type='button';button.textContent='Delete user';
            button.setAttribute('aria-label','Delete user '+teacher.name+' ('+teacher.email+')');
            button.onclick=async()=>{
                const warning='Permanently delete '+teacher.name+' ('+teacher.email+'), user #'+teacher.userId+', and ALL their Penina data, including webpages, quizzes, results, and saved account connections? This cannot be undone. Their email and number will be available for reuse when deletion finishes. Google Classroom and Drive will remain unchanged.';
                if(!window.confirm(warning))return;
                button.disabled=true;
                try{await teacherNumbers({operation:'delete',userId:teacher.userId,email:teacher.email,confirmPermanentDeletion:true});$('teacher-number-status').textContent='User deleted. All their Penina data has been removed. Their email and number are now available for reuse.';}
                catch(error){$('teacher-number-status').textContent=error.message;button.disabled=false;}
            };
            item.append(button);
            const resend=document.createElement('button');resend.type='button';resend.textContent='Resend welcome email';
            resend.onclick=async()=>{resend.disabled=true;$('teacher-number-status').textContent='Sending welcome email…';try{const result=await teacherRequest({operation:'welcome',userId:teacher.userId});$('teacher-number-status').textContent=result.welcomeEmail?.status==='accepted'?'Welcome email sent.':'User exists, but the welcome email was not sent. '+(result.welcomeEmail?.error || 'Please retry.');}catch(error){$('teacher-number-status').textContent=error.message;}finally{resend.disabled=false;}};
            item.append(resend);
            const access=document.createElement('fieldset');access.className='user-app-access';access.disabled=!!teacher.deletingPages;
            const legend=document.createElement('legend');legend.textContent='Webapp access for #'+teacher.userId+' — '+teacher.name;access.append(legend);
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
$('assign-teacher').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');
    if(button.disabled)return;
    button.disabled=true;button.textContent='Adding user…';
    $('assign-teacher-status').textContent='Adding user and sending welcome email…';
    try{const fields=new FormData(form);const result=await teacherNumbers({...Object.fromEntries(fields),apps:fields.getAll('apps')});form.reset();$('assign-teacher-status').textContent=result.welcomeEmail?.status==='accepted'?'Teacher added. Welcome email sent with sign-in instructions.':'Teacher added, but the welcome email was not sent. '+(result.welcomeEmail?.error || 'Use Resend welcome email to retry.');}
    catch(error){$('assign-teacher-status').textContent=error.message;}finally{button.disabled=false;button.textContent='Assign teacher number';}
};

})();

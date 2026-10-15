'use strict';
document.querySelectorAll('input[type="password"]').forEach((input,index)=>{
    if(input.closest('.password-entry'))return;
    input.id ||= 'teacher-password-'+index;
    if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',input.labels?.[0]?.textContent.trim() || 'Teacher password');
    const wrapper=document.createElement('span');wrapper.className='password-entry';
    const button=document.createElement('button');button.type='button';button.className='password-visibility';
    button.setAttribute('aria-controls',input.id);button.setAttribute('aria-label','Show password');button.setAttribute('aria-pressed','false');button.title='Show password';
    button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="password-slash" d="m3 3 18 18"/></svg>';
    input.before(wrapper);wrapper.append(input,button);
    button.addEventListener('click',event=>{
        event.preventDefault();const visible=input.type==='password';input.type=visible?'text':'password';
        button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Hide password':'Show password');button.title=visible?'Hide password':'Show password';
    });
});

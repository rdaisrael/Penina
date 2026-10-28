'use strict';
// Shared entrance and navigation for writing, assigning, and correcting.
(async()=>{
 const root='/Penina-Quizzes/teacher/';
 const idleScript=document.createElement('script');idleScript.src='/session-idle.js';document.head.append(idleScript);
 const returnHomeScript=document.createElement('script');returnHomeScript.src='/return-to-penina.js';document.head.append(returnHomeScript);
 function mountAccount(user){
  const style=document.createElement('style');style.textContent='#penina-app-account{position:fixed;top:12px;right:16px;z-index:10000;display:grid;justify-items:end;gap:0;padding:10px 14px;background:rgba(255,255,255,.96);border:1px solid #d8c79d;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);font:14px/1.4 Arial,sans-serif;color:#302c25}#penina-app-account button{justify-self:end;padding:2px 0;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}#penina-app-account [role=status]{color:#8a2d22}';document.head.append(style);
  const box=document.createElement('aside');box.id='penina-app-account';box.setAttribute('aria-label','Signed-in account');
  const greeting=document.createElement('span'),logout=document.createElement('button'),status=document.createElement('span');logout.type='button';logout.textContent='Log Out';status.setAttribute('role','status');
  const parts=String(user.name||'').trim().split(/\s+/).filter(Boolean),title=/^(mr|mrs|ms|miss|mx|dr|prof|professor|rabbi|rav|reb|rebbe|rebbetzin|rebbitzen|morah|mora|moreh|chazzan|cantor)\.?$/i,display=title.test(parts[0]||'')&&parts.length>1?parts[0]+' '+parts[parts.length-1]:(parts[0]||'');greeting.textContent='Welcome'+(display?' '+display:'');box.append(greeting,logout,status);document.body.append(box);
  logout.addEventListener('click',async()=>{logout.disabled=true;status.textContent='';try{const result=await fetch('/api/game-scores?game=quiz-account&action=logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});if(!result.ok)throw Error('Could not log out. Please try again.');location.assign('/');}catch(error){status.textContent=error.message;logout.disabled=false;}});
 }
 const response=await fetch('/api/game-scores?game=quiz-account&action=teacher').catch(()=>null);
 if(!response){document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Teacher sign-in could not be checked. Please reload this page.'}));return;}
 if(response.status===401 || response.status===403){location.replace(root);return;}
 if(!response.ok){document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Teacher tools are temporarily unavailable. Please reload this page.'}));return;}
 mountAccount(await response.json());
 const connect=document.getElementById('connectGoogle');
 if(!connect)return;
 const params=new URLSearchParams(location.search),assign=params.get('mode')==='assign';
 const assignment=connect.closest('section.card');assignment.hidden=!assign;
 const login=document.getElementById('login');const review=login.closest('section.card');review.hidden=assign;
 for(const id of ['reports','rosterPanel','summaryPanel']){const el=document.getElementById(id);if(assign&&el)el.hidden=true;}
 connect.hidden=true;
 // The owner session now authorizes imported reports; no grade password is needed.
 const password=login.elements.password;if(password){password.required=false;password.closest('label').hidden=true;}
 if(!assign && !params.has('quiz'))login.requestSubmit();
 if(assign){
  const link=document.getElementById('classLink'),button=document.createElement('button'),message=document.createElement('p');
  button.type='button';button.textContent='Publish assignment to students';message.setAttribute('role','status');
  const explanation=document.createElement('p');explanation.textContent='Review the draft in Classroom if you want to change its due date or settings. Publishing makes it available to students in the selected class.';link.append(explanation,button,message);
  button.onclick=async()=>{button.disabled=true;message.textContent='Publishing to Classroom…';try{await accountRequest('publish-assignment',{courseId:document.getElementById('classChoice').value});message.textContent='Published. Students can now open the assignment in Classroom.';}catch(e){message.textContent=e.message;}finally{button.disabled=false;}};
  document.getElementById('classChoice').addEventListener('change',()=>{message.textContent='';});
 }
})().catch(()=>{location.replace('/');});

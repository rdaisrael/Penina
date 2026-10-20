'use strict';
// Shared entrance and navigation for writing, assigning, and correcting.
(async()=>{
 const root='/Penina-Quizzes/teacher/';
 const response=await fetch('/api/game-scores?game=quiz-account&action=teacher').catch(()=>null);
 if(!response){document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Teacher sign-in could not be checked. Please reload this page.'}));return;}
 if(response.status===401 || response.status===403){location.replace(root);return;}
 if(!response.ok){document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Teacher tools are temporarily unavailable. Please reload this page.'}));return;}
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
})().catch(()=>{location.replace('/Penina-Quizzes/teacher/');});

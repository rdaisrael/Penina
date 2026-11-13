(() => {
 'use strict';
const returnHomeScript=document.createElement('script');returnHomeScript.src='/return-to-penina.js';document.head.append(returnHomeScript);
 const params=new URLSearchParams(location.search),stage=document.getElementById('stage'),status=document.getElementById('connection'),error=document.getElementById('error');
 const host=params.get('host')==='1';let code=params.get('code')||'',auth='',snapshot=null,stamp='',timer=null,busy=false,stopped=false,online=true,pollId=0,failures=0;
 let answerSubmission=null;
 const storageKey=()=>`penina-live-${host?'host':'student'}-${code}`;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let clockOffset=0;const celebrated=new Set(),startedRounds=new Set(),finishedRounds=new Set();
 let realtimeClient=null,realtimeChannel=null,realtimeReady=false,refreshHint=null,inFlight=false;
 const letters=['A','B','C','D'];
 let joinQrUrl='',joinQrSvg='';
 function activeJoinInfo(data){
  const url=new URL('?code='+encodeURIComponent(code),location.href);
  if(window.qrcode&&joinQrUrl!==url.href){
   const qr=window.qrcode(0,'M');qr.addData(url.href);qr.make();
   joinQrSvg=qr.createSvgTag({cellSize:4,margin:16,scalable:true});joinQrUrl=url.href;
  }
  return `<span class="live-host-join"><span class="live-host-join-original" aria-hidden="true">Game <b>${esc(code)}</b> · ${data.playerCount} joined</span><span class="live-host-join-panel"><span class="live-host-code">Game<b>${esc(code)}</b><span>${data.playerCount} joined</span></span>${joinQrSvg?`<a class="live-join-qr" href="${esc(url.href)}" target="_blank" rel="noopener" aria-label="Open student join page for game ${esc(code)}"><span role="img" aria-label="QR code to join this game">${joinQrSvg}</span></a>`:''}</span></span>`;
 }
 function stored(key,value){try{if(value===undefined)return sessionStorage.getItem(key);sessionStorage.setItem(key,value);}catch(_){}return null;}
 function showError(message){error.textContent=message||'';error.hidden=!message;}
 async function request(action,data={}){
  const sentAt=Date.now();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch('/api/game-scores?game=live'+(!action?'&code='+encodeURIComponent(code):''),{method:action?'POST':'GET',headers:{...(action?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},...(action?{body:JSON.stringify({action,code,...data})}:{}),cache:'no-store',signal:controller.signal});
   const result=await response.json();if(!response.ok){const e=new Error(result.error||'Please try again.');e.status=response.status;throw e;}syncClock(result,sentAt,Date.now());return result;
  }catch(e){if(e.name==='AbortError')throw new Error('Connection timed out. Please try again.');throw e;}finally{clearTimeout(timeout);}
 }
 function syncClock(data,sentAt,receivedAt){
  if(!Number.isFinite(data.serverNow)||!Number.isFinite(data.serverReceivedAt))return;
  const serverWork=Math.max(0,data.serverNow-data.serverReceivedAt);
  const networkTime=Math.max(0,receivedAt-sentAt-serverWork);
  // Estimate one-way travel time without counting database processing as clock drift.
  clockOffset=data.serverNow+networkTime/2-receivedAt;
 }
 const avatarCount=14;
 function avatarFigure(value){
  const id=Number.isInteger(value)&&value>=1&&value<=avatarCount?value:1;
  return `<span class="avatar-figure avatar-${id}" aria-hidden="true"></span>`;
 }
 function avatarPicker(){
  return `<fieldset class="avatar-picker"><legend>Choose your character</legend><p class="muted">Your character appears beside your initials.</p><div class="avatar-options">${Array.from({length:avatarCount},(_,i)=>`<label class="avatar-option"><input type="radio" name="avatar" value="${i+1}" required aria-label="Character ${i+1}"><span class="avatar-card">${avatarFigure(i+1)}<span class="avatar-number">${i+1}</span></span></label>`).join('')}</div></fieldset>`;
 }
 function joinForm(){
  stage.innerHTML=`<section class="panel join-panel"><p class="eyebrow">A whole class. One challenge.</p><h1>Join the live game</h1><p class="muted">Enter the code on your classroom board.</p><form id="join-form"><label>Game code<input name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" value="${esc(/^\d{6}$/.test(code)?code:'')}" required></label><label>Your initials (1–3 letters)<input name="name" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label><label>School email address<input type="email" name="schoolEmail" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required></label><p class="muted">Your school email is included in the teacher’s score report. Only your initials and character appear on the leaderboard.</p>${avatarPicker()}<button class="primary full" type="submit">Join game →</button></form></section>`;
  stage.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(busy)return;const form=event.currentTarget;code=form.elements.code.value.trim();const name=form.elements.name.value.normalize('NFKC').trim().toUpperCase();if(!/^\d{6}$/.test(code))return;if(!/^\p{L}{1,3}$/u.test(name)){showError('Enter 1–3 letters for your initials.');return;}
   const schoolEmail=form.elements.schoolEmail.value.trim();if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(schoolEmail)){showError('Enter a valid school email address.');return;}
   const avatar=Number(form.elements.avatar.value);if(!Number.isInteger(avatar)||avatar<1||avatar>avatarCount){showError('Choose your character.');return;}
   busy=true;form.querySelector('button').disabled=true;showError('');
   let joinKey=stored('penina-live-join-key-'+code);if(!joinKey){joinKey=crypto.randomUUID();stored('penina-live-join-key-'+code,joinKey);}
   try{const result=await request('join',{name,joinKey,schoolEmail,avatar});auth=result.studentToken;stored(storageKey(),auth);history.replaceState(null,'','?code='+code);busy=false;if(inFlight)timer=setTimeout(poll,300);else await poll();}
   catch(e){showError(e.message);busy=false;form.querySelector('button').disabled=false;}
  };
 }
 function leaderboard(scores){return `<ol class="scores">${scores.slice(0,3).map((p,i)=>`<li><span class="player-identity"><span>${i+1}.</span>${avatarFigure(p.avatar)}<span>${esc(p.name)}</span></span><strong>${p.score} pts</strong></li>`).join('')}</ol>`;}
 function podium(scores){
  const places=['1st','2nd','3rd'],groups=[];
  for(const player of [...scores].sort((a,b)=>b.score-a.score)){
   let group=groups.find(group=>group.score===player.score);
   if(!group){if(groups.length===3)break;group={score:player.score,players:[]};groups.push(group);}
   group.players.push(player);
  }
  return `<ol class="winner-podium" aria-label="Final standings">${groups.map((group,i)=>`<li class="podium-place podium-place-${i+1}" value="${i+1}"><div class="podium-person" role="group" aria-label="${places[i]} place winners" tabindex="0">${group.players.map(p=>`<div class="podium-contestant"><strong class="podium-initials">${esc(p.name)}</strong>${avatarFigure(p.avatar)}</div>`).join('')}</div><div class="podium-step"><span class="podium-rank">${places[i]}</span><strong class="podium-points">${group.score} <span>points${group.players.length>1?' each':''}</span></strong></div></li>`).join('')}</ol>`;
 }
 function clockText(data,remaining=Math.max(0,Math.ceil((data.deadline-Date.now()-clockOffset)/1000))){
  return (data.phase==='reveal'?'Next question in ':'Time left: ')+remaining+'s';
 }
 function updateClock(){
  const clock=stage.querySelector('[data-clock]');if(!clock||!snapshot)return;
  const remaining=Math.max(0,Math.ceil((snapshot.deadline-Date.now()-clockOffset)/1000));
  clock.textContent=clockText(snapshot,remaining);
  if(!remaining&&snapshot.phase==='question')stage.querySelectorAll('[data-choice]').forEach(button=>button.disabled=true);
 }
 function startConfetti(data,finish=false){
  if(finish){
   if(data.phase!=='ended'||data.index<0||finishedRounds.has(data.round||0))return;
   finishedRounds.add(data.round||0);
  }else{
  if(data.phase!=='question'||data.index!==0||startedRounds.has(data.round||0))return;
  startedRounds.add(data.round||0);
  }
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const burst=document.createElement('div');burst.className='start-confetti';burst.setAttribute('aria-hidden','true');
  const colors=['#ff1744','#ff8a00','#ffe600','#40ed5b','#00d9ff','#2979ff','#b64cff','#ff40c8'];
  for(let i=0;i<160;i++){
   const piece=document.createElement('i'),drift=(Math.random()-.5)*36;
   piece.style.cssText=`left:${Math.random()*100}%;top:${-15+Math.random()*70}%;background:${colors[i%colors.length]};width:${6+Math.random()*7}px;height:${8+Math.random()*10}px;border-radius:${i%3===0?'50%':'2px'};--drift:${drift}vw;--spin:${(Math.random()>.5?1:-1)*(360+Math.random()*720)}deg;--duration:${2.4+Math.random()*1.2}s;--delay:${Math.random()*.35}s`;
   burst.append(piece);
  }
  document.body.append(burst);setTimeout(()=>burst.remove(),4100);
  if(finish){
   const balloons=document.createElement('div');balloons.className='finish-balloons';balloons.setAttribute('aria-hidden','true');
   for(let i=0;i<24;i++){
    const balloon=document.createElement('i');
    balloon.style.cssText=`left:${2+Math.random()*92}%;--balloon-color:${colors[i%colors.length]};--sway:${(Math.random()-.5)*24}vw;--duration:${3.8+Math.random()*1.4}s;--delay:${Math.random()*1.2}s;--size:${32+Math.random()*28}px`;
    balloons.append(balloon);
   }
   document.body.append(balloons);setTimeout(()=>balloons.remove(),6600);
  }
 }
 function fireworks(data){
  if(host||data.phase!=='reveal'||data.me?.choice!==data.question.correct||celebrated.has(`${data.round||0}:${data.index}`))return;
  celebrated.add(`${data.round||0}:${data.index}`);
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  if(data.me.bonuses?.first)return; // The first correct responder gets the Leviim instead.
  const burst=document.createElement('div');burst.className='fireworks';burst.setAttribute('aria-hidden','true');
  const groups=3,sparks=16;
  for(let group=0;group<groups;group++)for(let i=0;i<sparks;i++){
   const spark=document.createElement('i'),angle=i*Math.PI*2/sparks,radius=110;
   spark.style.cssText=`left:${(group+1)*100/(groups+1)}%;top:${25+(group%2)*20}%;--dx:${Math.cos(angle)*radius}px;--dy:${Math.sin(angle)*radius}px;--delay:${group*0.12}s;background:${['#fbbf24','#38bdf8','#fb7185','#a78bfa'][i%4]}`;burst.append(spark);
  }
  document.body.append(burst);setTimeout(()=>burst.remove(),1400);
 }
 function wrongAnswer(data){
  if(host||data.phase!=='reveal'||data.me?.choice==null||data.me.choice===data.question.correct||celebrated.has(`${data.round||0}:${data.index}`))return;
  celebrated.add(`${data.round||0}:${data.index}`);
  const mark=document.createElement('div');mark.className='wrong-answer-mark';mark.setAttribute('role','status');
  const symbol=document.createElement('span');symbol.textContent='✕';symbol.setAttribute('aria-hidden','true');
  const label=document.createElement('strong');label.textContent='Incorrect';mark.append(symbol,label);
  document.body.append(mark);setTimeout(()=>mark.remove(),1400);
 }
 function present(data){
  // Follow the shared phase immediately. Replaying an old reveal would use up
  // answering time for a question whose server countdown has already started.
  draw(data);updateClock();
 }
 async function gameSettings(){
  if(!host||busy||!['lobby','ended'].includes(snapshot?.phase)||!snapshot.settings||document.querySelector('.live-settings'))return;
  const options=(values,selected,label)=>values.map(value=>`<option value="${value}" ${value===selected?'selected':''}>${label(value)}</option>`).join('');
  const dialog=document.createElement('dialog');dialog.className='live-settings';
  dialog.setAttribute('aria-labelledby','live-settings-title');
  dialog.innerHTML='<h2 id="live-settings-title">Game settings</h2><p role="status">Loading class lists…</p><button type="button" data-cancel>Cancel</button>';
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  let settings,version;
  try{({settings,version}=await request('settings'));}
  catch(e){
   if(!dialog.isConnected)return;
   dialog.innerHTML=`<h2 id="live-settings-title">Game settings</h2><p role="alert">${esc(e.message)}</p><div class="actions"><button type="button" data-retry>Retry</button><button type="button" data-cancel>Cancel</button></div>`;
   dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
   dialog.querySelector('[data-retry]').onclick=()=>{dialog.remove();gameSettings();};return;
  }
  if(!dialog.isConnected)return;
  const missing=settings.pathnames.some(pathname=>!settings.wordlists.some(set=>set.pathname===pathname));
  dialog.innerHTML=`<form><h2 id="live-settings-title">Game settings</h2><p>Students stay in the lobby while you make changes.</p>
   <div class="settings-grid"><label>Answer language<select name="language" required>${settings.language?'':'<option value="" selected disabled>Choose a language</option>'}${options(['english','hebrew'],settings.language,value=>value==='english'?'English':'Hebrew')}</select></label>
   <label>Number of questions<select name="count">${options([5,10,15,20],settings.count,value=>value)}</select></label>
   <label>Time per question<select name="seconds">${options([0,5,7,10],settings.seconds,value=>value?value+' seconds':'Manual — teacher advances')}</select></label>
   <label>Time between questions<select name="revealSeconds">${options([2,5,7,10,15,20,30],settings.revealSeconds,value=>value+' seconds')}</select></label></div>
   <p class="muted">The pause between questions displays the answer and standings. With manual pacing, you decide when to continue.</p>
   <fieldset><legend>Included wordlists and knowledge lists</legend><p class="muted">Choose up to 20 lists from this class. Choose Normal, 2×, or 3× emphasis for each list.</p>${missing?'<p role="status">Some previously selected wordlists are no longer available. Choose the lists for this round below.</p>':''}${settings.wordlists.length?'':'<p>No lists are available. Add a wordlist or knowledge list on your class page, then reopen Game settings.</p>'}${settings.wordlists.map((set,index)=>`<div class="live-wordlist-row"><label class="wordlist-choice"><input type="checkbox" name="wordlist" value="${index}" ${settings.pathnames.includes(set.pathname)?'checked':''}><span>${esc(set.title)}</span></label><select name="emphasis-${index}" aria-label="Emphasis for ${esc(set.title)}" ${settings.pathnames.includes(set.pathname)?'':'disabled'}>${options([1,2,3],settings.wordlistEmphasis?.[set.pathname]??1,value=>value===1?'Normal':value+'×')}</select></div>`).join('')}</fieldset>
   <label class="wordlist-choice"><input type="checkbox" name="sendScoresToTeacher" ${settings.sendScoresToTeacher?'checked':''}><span>Send scores to teacher</span></label>
   <p class="muted">The game uses up to the selected number of questions. With multiple lists, terms may repeat to match your emphasis.</p><p data-settings-error role="alert"></p>
   <div class="actions"><button type="submit" class="primary">Save settings</button><button type="button" data-cancel>Cancel</button></div></form>`;
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  const form=dialog.querySelector('form');
  const syncEmphasisControls=()=>form.querySelectorAll('input[name="wordlist"]').forEach(input=>{form.elements['emphasis-'+input.value].disabled=!input.checked;});
  form.querySelectorAll('input[name="wordlist"]').forEach(input=>input.onchange=syncEmphasisControls);
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   const pathnames=[...form.querySelectorAll('input[name="wordlist"]:checked')].map(input=>settings.wordlists[Number(input.value)].pathname);
   const message=dialog.querySelector('[data-settings-error]');
   if(!pathnames.length){message.textContent='Include at least one list.';return;}
   if(pathnames.length>20){message.textContent='Choose up to 20 lists.';return;}
   const values={version,language:form.elements.language.value,sendScoresToTeacher:form.elements.sendScoresToTeacher.checked,count:Number(form.elements.count.value),seconds:Number(form.elements.seconds.value),revealSeconds:Number(form.elements.revealSeconds.value),pathnames,wordlistEmphasis:Object.fromEntries(settings.wordlists.map((set,index)=>[set.pathname,Number(form.elements['emphasis-'+index].value)]))};
   const controls=[...form.querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);
   const saved=await act('configure',values);
   if(saved)dialog.close();else{controls.forEach(control=>control.disabled=false);syncEmphasisControls();message.textContent=error.textContent;}
  };
 }
 function streakMeter(data){
  if(host)return '';
  const streak=data.me.streak||0,won=data.phase==='reveal'&&data.me.bonuses?.streak>0,progress=won?5:streak%5;
  const remaining=5-progress;
  const detail=won?'Streak bonus! +50 points':`${remaining} more correct ${remaining===1?'answer':'answers'} for +50 points`;
  return `<section class="streak-meter${won?' streak-complete':''}" aria-label="Correct-answer streak"><div class="streak-heading"><strong>5 in a row</strong><span>${progress} / 5</span></div><div class="streak-track" role="progressbar" aria-label="Progress toward the next 50-point streak bonus" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${progress}" aria-valuetext="${progress} of 5. ${detail}">${Array.from({length:5},(_,i)=>`<span class="streak-step${i<progress?' filled':''}" aria-hidden="true"></span>`).join('')}</div><p>${detail}${streak>5?` · ${streak} correct in a row`:''}</p></section>`;
 }
 function bonusNotice(data){
  if(host||data.phase!=='reveal')return '';
  const bonuses=data.me.bonuses;
  if(!bonuses?.first&&!bonuses?.streak)return '';
  return `<div class="bonus-notice" role="status">${bonuses.first?'<span class="first-response-bonus">★ First correct answer! <strong>+25 points</strong></span>':''}${bonuses.streak?'<span>★ 5 in a row! <strong>+50 points</strong></span>':''}</div>`;
 }
 function draw(data){
  // Keep immediate tap feedback separate from the server's saved answer.
  // A confirmed answer must survive a refresh that started before the write.
  if(answerSubmission&&(!['question','reveal'].includes(data.phase)||answerSubmission.round!==(data.round||0)||answerSubmission.index!==data.index))answerSubmission=null;
  if(answerSubmission&&data.me?.choice!=null)Object.assign(answerSubmission,{choice:data.me.choice,saved:true});
  if(data.phase==='question'&&answerSubmission?.saved&&data.me?.choice===null)data={...data,me:{...data.me,choice:answerSubmission.choice}};
  if(host)window.PeninaMusic?.update(data);
  else window.PeninaShofar?.update(data);
  startConfetti(data);startConfetti(data,true);fireworks(data);wrongAnswer(data);
  // Poll timestamps (including lastReveal's) must not replace a button mid-tap.
  // Keep the latest version for submissions even when nothing visible changed.
  snapshot=data;
  const signature=JSON.stringify(data,(key,value)=>key==='serverNow'||key==='serverReceivedAt'||key==='lastReveal'||key==='version'||(!host&&key==='answeredCount')?undefined:value)+busy+online+JSON.stringify(answerSubmission);
  if(signature===stamp){
   const count=stage.querySelector('[data-answered-count]');
   if(count)count.textContent=data.answeredCount;
   return;
  }
  stamp=signature;
  const meta=`<div class="question-meta"><span>${esc(data.className)}</span>${host&&['question','reveal'].includes(data.phase)?activeJoinInfo(data):`<span>Game <b>${code}</b> · ${data.playerCount} joined</span>`}</div>`;
  if(data.phase==='lobby'){
   if(host){const url=new URL('?code='+code,location.href);stage.innerHTML=meta+`<div class="lobby"><section class="panel"><p class="eyebrow">Project this screen</p><h1>Let’s play.</h1><div class="join-code">${code}</div><div class="qr-row"><div id="qr" aria-label="QR code to join this game"></div><div><p>Scan on your iPad or open:</p><a class="join-link" href="${esc(url.href)}" target="_blank" rel="noopener">Student join page ↗</a><p class="muted">${esc(url.host+url.pathname)}</p><button data-copy="${esc(url.href)}">Copy join link</button></div></div><div class="actions"><button class="primary" data-action="start" ${!data.playerCount||busy||!online?'disabled':''}>Start game →</button>${data.settings?`<button data-settings ${busy||!online?'disabled':''}>Game settings</button>`:''}<button class="danger" data-end>End game</button></div></section><section class="panel"><p class="eyebrow">The lobby</p><h2>${data.playerCount} student${data.playerCount===1?'':'s'} ready</h2><p class="muted">${data.total} questions · 100 points per correct answer.<br>+50 for every 5 correct in a row · +25 for the first correct answer.<br>${data.seconds?data.seconds+' seconds per question · '+(data.revealSeconds??2)+' seconds between questions.':'Manual pacing · you reveal answers and advance.'}</p><ul class="students">${data.players.map(p=>`<li>${avatarFigure(p.avatar)}<span>${esc(p.name)}</span></li>`).join('')}</ul>${!data.playerCount?'<p class="muted">Students appear here as they join.</p>':''}</section></div>`;
    if(window.qrcode){const qr=qrcode(0,'M');qr.addData(url.href);qr.make();document.getElementById('qr').innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true});}
   }else stage.innerHTML=meta+`<section class="panel waiting"><div class="chosen-avatar">${avatarFigure(data.me.avatar)}</div><h1>You’re in, ${esc(data.me.name)}.</h1><p>Keep this page open. Your teacher will start the game.</p><p class="muted">${data.playerCount} student${data.playerCount===1?'':'s'} joined · ${data.total} questions</p><p class="scoring-rules">100 points per correct answer<br><strong>+50</strong> for every 5 correct in a row<br><strong>+25</strong> for the first correct answer</p></section>`;
   return;
  }
  if(data.phase==='ended'){stage.innerHTML=meta+`<section class="panel waiting game-finale"><p class="eyebrow">Game complete</p><h1>Well played, everyone.</h1>${!host?`<p class="notice success player-identity">${avatarFigure(data.me.avatar)}${esc(data.me.name)} · ${data.me.score} points</p>`:''}${podium(data.scores)}${host&&data.scoreEmail?`<p role="status">${data.scoreEmail.status==='sent'?'Scores submitted for email delivery to your teacher address.':'The score email could not be sent. Please retry.'}</p>${data.scoreEmail.status==='failed'?'<button data-email-retry>Retry score email</button>':''}`:''}<div class="actions"><a class="button" href="${esc(data.classUrl||'../')}">Back to class</a>${host&&data.settings?`<button class="primary" data-action="restart" ${busy||!online?'disabled':''}>Play again →</button>`:''}${!host?'<p class="muted">Stay on this page to play again. Your teacher can return everyone to the lobby.</p>':''}</div></section>`;return;}
  const revealed=data.phase==='reveal',q=data.question,choice=data.me?.choice??answerSubmission?.choice??null,awaitingAnswer=revealed&&answerSubmission&&data.me?.choice===null;
  const answerMarkup=q.options.map((text,i)=>{
   const className='answer'+(revealed&&i===q.correct?' correct':'')+(!host&&choice===i?' selected':'')+(revealed&&!host&&choice===i&&i!==q.correct?' wrong':'');
   const content=`<span class="letter">${letters[i]}</span><span class="text" dir="auto">${esc(text)}${revealed?`<span class="count">${i===q.correct?'✓ Correct · ':''}${data.distribution[i]} chose this</span>`:''}</span>`;
   return host?`<div class="${className}">${content}</div>`:`<button class="${className}" data-choice="${i}" ${data.paused||revealed||choice!==null||busy||!online?'disabled':''} aria-pressed="${choice===i}">${content}</button>`;
  }).join('');
  // Keep the prompt's space after a choice and populate the clock before paint.
  // Collapsing either area can clamp scroll position while a student is tapping.
  const answerNotice=host||awaitingAnswer?'':revealed?`<p class="notice ${choice===q.correct?'success':''}" role="status">${choice===q.correct?'Correct! +100 points':choice===null?'No answer submitted this time.':'The correct answer is '+letters[q.correct]+'.'}</p>`:`<p class="notice answer-prompt" ${choice===null?'role="status"':'aria-hidden="true"'}>Choose the correct answer. Your first answer is final.</p>`;
  stage.innerHTML=meta+`<div class="live-round${host&&revealed?' has-standings':''}"><section class="live-question"><div class="question-meta"><span class="eyebrow">Question ${data.index+1} of ${data.total}</span><span${host?' class="host-answered-count" aria-hidden="true"':''}><span data-answered-count>${data.answeredCount}</span> / ${data.playerCount} answered${!host?' · Your score: '+data.me.score:''}</span></div>${streakMeter(data)}${data.deadline?`<p class="countdown" data-clock role="timer">${clockText(data)}</p>`:''}${data.paused?'<p class="notice">Paused by teacher</p>':''}${revealed?`<p class="notice success"><strong>Correct answer: ${esc(q.options[q.correct])}</strong></p>`:''}<h1 class="question" dir="auto">${esc(q.term)}</h1>${pictureMarkup(q.picture)}<div class="answers">${answerMarkup}</div>${answerNotice}${bonusNotice(data)}${host?`<div class="actions"><button class="primary" data-action="${revealed?'next':'reveal'}" ${data.paused||busy||!online?'disabled':''}>${revealed?(data.index+1===data.total?'Finish game →':'Next question →'):'Reveal answer'}</button><button data-action="${data.paused?'resume':'pause'}" ${busy||!online?'disabled':''}>${data.paused?'Resume':'Pause'}</button><button class="danger" data-end>End game</button></div>${!revealed?`<ul class="students" aria-label="Student responses">${data.players.map(p=>`<li class="${p.answered?'answered':''}">${avatarFigure(p.avatar)}<span>${p.answered?'✓ ':''}${esc(p.name)}</span></li>`).join('')}</ul>`:''}`:''}</section>${host&&revealed?`<aside class="live-standings" aria-label="Class standings"><section class="panel"><h2>Class standings</h2>${leaderboard(data.scores)}</section><section class="panel"><h2>Answer revealed</h2><p>${data.seconds?'The next question starts automatically after '+(data.revealSeconds??2)+' seconds.':'Discuss the correct definition, then move on when the class is ready.'}</p></section></aside>`:''}</div>`;
 }
 function pictureMarkup(picture){
  if(!picture || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(picture.src||''))return '';
  const targets=(Array.isArray(picture.targets)?picture.targets:picture.target?[picture.target]:[]).slice(0,5).filter(t=>t&&[t.x,t.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  const marker=targets.map((t,i)=>`<span class="live-picture-target${targets.length>1?' lettered':''}" style="left:${t.x*100}%;top:${t.y*100}%" aria-label="${targets.length>1?'Target '+'ABCDE'[i]:'Marked location'}">${targets.length>1?'ABCDE'[i]:'＋'}</span>`).join('');
  return `<div class="live-picture"><span><img src="${esc(picture.src)}" alt="${esc(picture.alt||'Question picture')}" draggable="false">${marker}</span></div>`;
 }
 function disconnectRealtime(){
  clearTimeout(refreshHint);refreshHint=null;realtimeReady=false;
  if(realtimeClient)realtimeClient.removeAllChannels();realtimeClient=null;realtimeChannel=null;
 }
 function connectRealtime(data){
  if(!data.realtime||!window.supabase||realtimeChannel||document.hidden)return;
  const {url,key,topic}=data.realtime;
  realtimeClient=window.supabase.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const refresh=()=>{
   if(stopped||document.hidden||refreshHint)return;
   refreshHint=setTimeout(()=>{refreshHint=null;if(!busy)poll();},250);
  };
  realtimeChannel=realtimeClient.channel(topic,{config:{private:false}}).on('broadcast',{event:'changed'},refresh).subscribe(state=>{
   realtimeReady=state==='SUBSCRIBED';
   if(realtimeReady)refresh();
  });
 }
 function nextPollDelay(){
  if(failures)return Math.min(30000,2000*2**Math.min(failures,4));
  let delay=realtimeReady?15000:snapshot?.phase==='lobby'||snapshot?.phase==='ended'||snapshot?.paused?3000:1000;
  // Clock ticks stay local. A single scheduled fetch advances each timed phase.
  if(snapshot?.deadline)delay=Math.min(delay,Math.max(250,snapshot.deadline-Date.now()-clockOffset+100));
  return delay;
 }
 async function poll(){
  clearTimeout(timer);if(stopped||!auth||document.hidden)return;if(busy||inFlight){timer=setTimeout(poll,250);return;}inFlight=true;const currentPoll=++pollId;
  try{const data=await request();if(currentPoll!==pollId||stopped)return;if(snapshot&&data.version<snapshot.version)return;failures=0;online=true;status.textContent=host?'Teacher screen · Connected':'Connected';showError('');connectRealtime(data);present(data);}
  catch(e){if(currentPoll!==pollId||stopped)return;failures++;online=false;status.textContent='Reconnecting…';showError(e.message);if(snapshot)draw(snapshot);if([401,404,410].includes(e.status)){stopped=true;status.textContent='Game unavailable';return;}}
  finally{inFlight=false;}
  if(!stopped&&!document.hidden){
   const delay=nextPollDelay();
   timer=setTimeout(poll,delay);
  }
 }
 async function submitAnswer(choice){
  if(host||busy||!snapshot||snapshot.phase!=='question'||snapshot.paused||snapshot.me?.choice!==null||answerSubmission||!Number.isInteger(choice)||choice<0||choice>3)return;
  if(snapshot.deadline&&Date.now()+clockOffset>=snapshot.deadline)return;
  const data={version:snapshot.version,index:snapshot.index,round:snapshot.round||0,choice};
  const submission={round:data.round,index:data.index,choice,saved:false};
  answerSubmission=submission;draw(snapshot);showError('');
  // This request belongs to one question. It must not block phase updates or
  // answers to later questions, even if its response arrives much later.
  try{
   const result=await request('answer',data);
   if(answerSubmission===submission&&result.saved&&result.round===submission.round&&result.index===submission.index&&Number.isInteger(result.choice)&&result.choice>=0&&result.choice<=3){Object.assign(submission,{choice:result.choice,saved:true});draw(snapshot);}
   await poll();return true;
  }catch(e){
   if(answerSubmission===submission&&!submission.saved){answerSubmission=null;showError(e.message);draw(snapshot);}
   if(!stopped)timer=setTimeout(poll,300);
   return submission.saved;
  }
 }
 async function act(action,extra={}){
  if(action==='answer')return submitAnswer(extra.choice);
  if(busy||!snapshot)return;
  const data={version:snapshot.version,index:snapshot.index,round:snapshot.round||0,...extra};
  ++pollId;clearTimeout(timer);busy=true;draw(snapshot);showError('');
  try{
   await request(action,data);
   busy=false;
   if(inFlight)timer=setTimeout(poll,300);else await poll();return true;
  }
  catch(e){busy=false;showError(e.message);draw(snapshot);timer=setTimeout(poll,1800);return false;}
 }
 // Submit touch answers before a poll can replace the button mid-tap.
 const touchAnswers=new WeakSet();
 stage.addEventListener('pointerdown',event=>{
  if(host||event.pointerType!=='touch'||!event.isPrimary||event.button!==0)return;
  const button=event.target.closest('button[data-choice]');
  if(!button||button.disabled||busy)return;
  touchAnswers.add(button);
  event.preventDefault();
  void act('answer',{choice:Number(button.dataset.choice)});
 });
 stage.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-email-retry')){button.disabled=true;stopped=false;await poll();return;}
  if(button.hasAttribute('data-settings')){gameSettings();return;}
  if(button.dataset.action==='restart'){if(await act('restart'))await gameSettings();return;}
  if(button.dataset.copy){try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copied!';}catch(_){showError('Copy the student join page link shown above.');}return;}
  if(button.hasAttribute('data-end')){
   const dialog=document.createElement('dialog');dialog.className='live-confirm';dialog.innerHTML='<h2>End this game?</h2><p>Students will see the final scores. An unrevealed question will not count.</p><div class="actions"><button data-cancel>Keep playing</button><button class="danger" data-confirm>End game</button></div>';document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.querySelector('[data-confirm]').onclick=()=>{dialog.close();act('end');};return;
  }
  if(button.dataset.action)await act(button.dataset.action);
  if(button.dataset.choice!==undefined&&event.pointerType!=='touch'&&!touchAnswers.has(button))await act('answer',{choice:Number(button.dataset.choice)});
 });
 setInterval(updateClock,100);
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);disconnectRealtime();});
 window.addEventListener('pageshow',()=>{if(auth&&stopped){stopped=false;poll();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);disconnectRealtime();return;}if(auth&&!busy&&!stopped)poll();});
 auth=stored(storageKey())||'';
 if(host&&!auth){stage.innerHTML='<section class="panel waiting"><h1>Open Teacher tools first.</h1><p>Start a live game from your class webpage using its editing code.</p><a class="button primary" href="../">Back to classes</a></section>';}
 else if(auth){status.textContent='Connecting…';poll();}else joinForm();
})();

(() => {
 'use strict';
 const params=new URLSearchParams(location.search),stage=document.getElementById('stage'),status=document.getElementById('connection'),error=document.getElementById('error');
 const host=params.get('host')==='1';let code=params.get('code')||'',auth='',snapshot=null,stamp='',timer=null,busy=false,stopped=false,online=true,pollId=0,failures=0;
 const storageKey=()=>`penina-live-${host?'host':'student'}-${code}`;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let clockOffset=0;const celebrated=new Set();
 const revealSeen=new Set();let revealUntil=0;
 let realtimeClient=null,realtimeChannel=null,realtimeReady=false,refreshHint=null,inFlight=false;
 const letters=['A','B','C','D'];
 function stored(key,value){try{if(value===undefined)return sessionStorage.getItem(key);sessionStorage.setItem(key,value);}catch(_){}return null;}
 function showError(message){error.textContent=message||'';error.hidden=!message;}
 async function request(action,data={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch('/api/game-scores?game=live'+(!action?'&code='+encodeURIComponent(code):''),{method:action?'POST':'GET',headers:{...(action?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},...(action?{body:JSON.stringify({action,code,...data})}:{}),cache:'no-store',signal:controller.signal});
   const result=await response.json();if(!response.ok){const e=new Error(result.error||'Please try again.');e.status=response.status;throw e;}return result;
  }catch(e){if(e.name==='AbortError')throw new Error('Connection timed out. Please try again.');throw e;}finally{clearTimeout(timeout);}
 }
 function joinForm(){
  stage.innerHTML=`<section class="panel join-panel"><p class="eyebrow">A whole class. One challenge.</p><h1>Join the live game</h1><p class="muted">Enter the code on your classroom board.</p><form id="join-form"><label>Game code<input name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" value="${esc(/^\d{6}$/.test(code)?code:'')}" required></label><label>Your initials (1–3 letters)<input name="name" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label><label>School email address<input type="email" name="schoolEmail" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required></label><p class="muted">Your school email is included in the teacher’s score report. Only your initials appear on the leaderboard.</p><button class="primary full" type="submit">Join game →</button></form></section>`;
  stage.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(busy)return;const form=event.currentTarget;code=form.elements.code.value.trim();const name=form.elements.name.value.normalize('NFKC').trim().toUpperCase();if(!/^\d{6}$/.test(code))return;if(!/^\p{L}{1,3}$/u.test(name)){showError('Enter 1–3 letters for your initials.');return;}
   const schoolEmail=form.elements.schoolEmail.value.trim();if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(schoolEmail)){showError('Enter a valid school email address.');return;}
   busy=true;form.querySelector('button').disabled=true;showError('');
   let joinKey=stored('penina-live-join-key-'+code);if(!joinKey){joinKey=crypto.randomUUID();stored('penina-live-join-key-'+code,joinKey);}
   try{const result=await request('join',{name,joinKey,schoolEmail});auth=result.studentToken;stored(storageKey(),auth);history.replaceState(null,'','?code='+code);busy=false;if(inFlight)timer=setTimeout(poll,300);else await poll();}
   catch(e){showError(e.message);busy=false;form.querySelector('button').disabled=false;}
  };
 }
 function leaderboard(scores){return `<ol class="scores">${scores.slice(0,3).map((p,i)=>`<li><span>${i+1}. ${esc(p.name)}</span><strong>${p.score} pts</strong></li>`).join('')}</ol>`;}
 function updateClock(){
  const clock=stage.querySelector('[data-clock]');if(!clock||!snapshot)return;
  const remaining=Math.max(0,Math.ceil((snapshot.deadline-Date.now()-clockOffset)/1000));
  clock.textContent=(snapshot.phase==='reveal'?'Next question in ':'Time left: ')+remaining+'s';
  if(!remaining&&snapshot.phase==='question')stage.querySelectorAll('[data-choice]').forEach(button=>button.disabled=true);
 }
 function fireworks(data){
  if(host||data.phase!=='reveal'||data.me?.choice!==data.question.correct||celebrated.has(`${data.round||0}:${data.index}`))return;
  celebrated.add(`${data.round||0}:${data.index}`);
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const burst=document.createElement('div');burst.className='fireworks';burst.setAttribute('aria-hidden','true');
  for(let group=0;group<3;group++)for(let i=0;i<16;i++){
   const spark=document.createElement('i'),angle=i*Math.PI/8;
   spark.style.cssText=`left:${25+group*25}%;top:${30+(group%2)*15}%;--dx:${Math.cos(angle)*110}px;--dy:${Math.sin(angle)*110}px;--delay:${group*0.12}s;background:${['#fbbf24','#38bdf8','#fb7185','#a78bfa'][i%4]}`;burst.append(spark);
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
  if(data.serverNow)clockOffset=data.serverNow-Date.now();
  const reveal=data.phase==='reveal'?data:data.lastReveal;
  if(reveal&&!revealSeen.has(`${reveal.round||0}:${reveal.index}`)){
   revealSeen.add(`${reveal.round||0}:${reveal.index}`);revealUntil=Date.now()+2000;
   draw(reveal);updateClock();return;
  }
  if((snapshot?.round||0)===(data.round||0) && Date.now()<revealUntil && snapshot?.phase==='reveal' && data.phase!=='reveal')return;
  draw(data);updateClock();
 }
 function gameSettings(){
  if(!host||busy||snapshot?.phase!=='lobby'||!snapshot.settings)return;
  const settings=snapshot.settings,version=snapshot.version;
  const options=(values,selected,label)=>values.map(value=>`<option value="${value}" ${value===selected?'selected':''}>${label(value)}</option>`).join('');
  const dialog=document.createElement('dialog');dialog.className='live-settings';
  dialog.setAttribute('aria-labelledby','live-settings-title');
  dialog.innerHTML=`<form><h2 id="live-settings-title">Game settings</h2><p>Students stay in the lobby while you make changes.</p>
   <div class="settings-grid"><label>Number of questions<select name="count">${options([5,10,15,20],settings.count,value=>value)}</select></label>
   <label>Time per question<select name="seconds">${options([0,5,7,10],settings.seconds,value=>value?value+' seconds':'Manual — teacher advances')}</select></label>
   <label>Time between questions<select name="revealSeconds">${options([2,5,7,10,15,20,30],settings.revealSeconds,value=>value+' seconds')}</select></label></div>
   <p class="muted">The pause between questions displays the answer and standings. With manual pacing, you decide when to continue.</p>
   <fieldset><legend>Included wordlists</legend><p class="muted">Uncheck any wordlist to exclude it.</p>${settings.wordlists.map((set,index)=>`<label class="wordlist-choice"><input type="checkbox" name="wordlist" value="${index}" ${settings.pathnames.includes(set.pathname)?'checked':''}><span>${esc(set.title)} <small>(${set.terms} terms)</small></span></label>`).join('')}</fieldset>
   <p class="muted">If fewer terms are available than requested, the game uses all available terms.</p><p data-settings-error role="alert"></p>
   <div class="actions"><button type="submit" class="primary">Save settings</button><button type="button" data-cancel>Cancel</button></div></form>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  const form=dialog.querySelector('form');
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   const pathnames=[...form.querySelectorAll('input[name="wordlist"]:checked')].map(input=>settings.wordlists[Number(input.value)].pathname);
   const message=dialog.querySelector('[data-settings-error]');
   if(!pathnames.length){message.textContent='Include at least one wordlist.';return;}
   const values={version,count:Number(form.elements.count.value),seconds:Number(form.elements.seconds.value),revealSeconds:Number(form.elements.revealSeconds.value),pathnames};
   const controls=[...form.querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);
   const saved=await act('configure',values);
   if(saved)dialog.close();else{controls.forEach(control=>control.disabled=false);message.textContent=error.textContent;}
  };
 }
 function draw(data){
  fireworks(data);wrongAnswer(data);
  const signature=JSON.stringify(data)+busy+online;if(signature===stamp)return;stamp=signature;snapshot=data;
  const meta=`<div class="question-meta"><span>${esc(data.className)}</span><span>Game <b>${code}</b> · ${data.playerCount} joined</span></div>`;
  if(data.phase==='lobby'){
   if(host){const url=new URL('?code='+code,location.href);stage.innerHTML=meta+`<div class="lobby"><section class="panel"><p class="eyebrow">Project this screen</p><h1>Let’s play vocabulary.</h1><div class="join-code">${code}</div><div class="qr-row"><div id="qr" aria-label="QR code to join this game"></div><div><p>Scan on your iPad or open:</p><a class="join-link" href="${esc(url.href)}" target="_blank" rel="noopener">Student join page ↗</a><p class="muted">${esc(url.host+url.pathname)}</p><button data-copy="${esc(url.href)}">Copy join link</button></div></div><div class="actions"><button class="primary" data-action="start" ${!data.playerCount||busy||!online?'disabled':''}>Start game →</button>${data.settings?`<button data-settings ${busy||!online?'disabled':''}>Game settings</button>`:''}<button class="danger" data-end>End game</button></div></section><section class="panel"><p class="eyebrow">The lobby</p><h2>${data.playerCount} student${data.playerCount===1?'':'s'} ready</h2><p class="muted">${data.total} questions · 100 points per correct answer.<br>${data.seconds?data.seconds+' seconds per question · '+(data.revealSeconds??2)+' seconds between questions.':'Manual pacing · you reveal answers and advance.'}</p><ul class="students">${data.players.map(p=>`<li>${esc(p.name)}</li>`).join('')}</ul>${!data.playerCount?'<p class="muted">Students appear here as they join.</p>':''}</section></div>`;
    if(window.qrcode){const qr=qrcode(0,'M');qr.addData(url.href);qr.make();document.getElementById('qr').innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true});}
   }else stage.innerHTML=meta+`<section class="panel waiting"><div class="orb">✓</div><h1>You’re in, ${esc(data.me.name)}.</h1><p>Keep this page open. Your teacher will start the game.</p><p class="muted">${data.playerCount} student${data.playerCount===1?'':'s'} joined · ${data.total} questions</p></section>`;
   return;
  }
  if(data.phase==='ended'){stage.innerHTML=meta+`<section class="panel waiting"><p class="eyebrow">Game complete</p><h1>Well played, everyone.</h1>${!host?`<p class="notice success">${esc(data.me.name)} · ${data.me.score} points</p>`:''}${leaderboard(data.scores)}${host&&data.scoreEmail?`<p role="status">${data.scoreEmail.status==='sent'?'Scores submitted for email delivery to your teacher address.':'The score email could not be sent. Please retry.'}</p>${data.scoreEmail.status==='failed'?'<button data-email-retry>Retry score email</button>':''}`:''}<div class="actions"><a class="button" href="${esc(data.classUrl||'../')}">Back to class</a>${host&&data.settings?`<button class="primary" data-action="restart" ${busy||!online?'disabled':''}>Play again →</button>`:''}${!host?'<p class="muted">Stay on this page to play again. Your teacher can return everyone to the lobby.</p>':''}</div></section>`;return;}
  const revealed=data.phase==='reveal',q=data.question,choice=data.me?.choice;
  const answerMarkup=q.options.map((text,i)=>{
   const className='answer'+(revealed&&i===q.correct?' correct':'')+(!host&&choice===i?' selected':'')+(revealed&&!host&&choice===i&&i!==q.correct?' wrong':'');
   const content=`<span class="letter">${letters[i]}</span><span class="text" dir="auto">${esc(text)}${revealed?`<span class="count">${i===q.correct?'✓ Correct · ':''}${data.distribution[i]} chose this</span>`:''}</span>`;
   return host?`<div class="${className}">${content}</div>`:`<button class="${className}" data-choice="${i}" ${data.paused||revealed||choice!==null||busy||!online?'disabled':''} aria-pressed="${choice===i}">${content}</button>`;
  }).join('');
  stage.innerHTML=meta+`<div class="live-round${host&&revealed?' has-standings':''}"><section class="live-question"><div class="question-meta"><span class="eyebrow">Question ${data.index+1} of ${data.total}</span><span>${data.answeredCount} / ${data.playerCount} answered${!host?' · Your score: '+data.me.score:''}</span></div>${data.deadline?'<p class="countdown" data-clock role="timer"></p>':''}${data.paused?'<p class="notice">Paused by teacher</p>':''}${revealed?`<p class="notice success"><strong>Correct answer: ${esc(q.options[q.correct])}</strong></p>`:''}<h1 class="question" dir="auto">${esc(q.term)}</h1><div class="answers">${answerMarkup}</div>${!host?`<p class="notice ${revealed&&choice===q.correct?'success':''}" role="status">${revealed?(choice===q.correct?'Correct! +100 points':choice===null?'No answer submitted this time.':'The correct answer is '+letters[q.correct]+'.'):(choice!==null?'Answer '+letters[choice]+' saved. Waiting for the answer reveal.':'Choose the matching definition. Your first answer is final.')}</p>`:''}${host?`<div class="actions"><button class="primary" data-action="${revealed?'next':'reveal'}" ${data.paused||busy||!online?'disabled':''}>${revealed?(data.index+1===data.total?'Finish game →':'Next question →'):'Reveal answer'}</button><button data-action="${data.paused?'resume':'pause'}" ${busy||!online?'disabled':''}>${data.paused?'Resume':'Pause'}</button><button class="danger" data-end>End game</button></div>${!revealed?`<ul class="students" aria-label="Student responses">${data.players.map(p=>`<li class="${p.answered?'answered':''}">${p.answered?'✓ ':''}${esc(p.name)}</li>`).join('')}</ul>`:''}`:''}</section>${host&&revealed?`<aside class="live-standings" aria-label="Class standings"><section class="panel"><h2>Class standings</h2>${leaderboard(data.scores)}</section><section class="panel"><h2>Answer revealed</h2><p>${data.seconds?'The next question starts automatically after '+(data.revealSeconds??2)+' seconds.':'Discuss the correct definition, then move on when the class is ready.'}</p></section></aside>`:''}</div>`;
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
  if(snapshot?.phase==='reveal'&&revealUntil>Date.now())delay=Math.min(delay,revealUntil-Date.now()+20);
  return delay;
 }
 async function poll(){
  clearTimeout(timer);if(stopped||!auth||document.hidden)return;if(inFlight){timer=setTimeout(poll,250);return;}inFlight=true;const currentPoll=++pollId;
  try{const data=await request();if(currentPoll!==pollId||stopped)return;if(snapshot&&data.version<snapshot.version)return;failures=0;online=true;status.textContent=host?'Teacher screen · Connected':'Connected';showError('');connectRealtime(data);present(data);}
  catch(e){if(currentPoll!==pollId||stopped)return;failures++;online=false;status.textContent='Reconnecting…';showError(e.message);if(snapshot)draw(snapshot);if([401,404,410].includes(e.status)){stopped=true;status.textContent='Game unavailable';return;}}
  finally{inFlight=false;}
  if(!stopped&&!document.hidden){
   const delay=nextPollDelay();
   timer=setTimeout(poll,delay);
  }
 }
 async function act(action,extra={}){
  if(busy||!snapshot)return;++pollId;clearTimeout(timer);busy=true;if(snapshot)draw(snapshot);showError('');
  try{await request(action,{version:snapshot.version,index:snapshot.index,round:snapshot.round||0,...extra});busy=false;if(inFlight)timer=setTimeout(poll,300);else await poll();return true;}
  catch(e){busy=false;showError(e.message);if(snapshot)draw(snapshot);timer=setTimeout(poll,1800);return false;}
 }
 stage.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-email-retry')){button.disabled=true;stopped=false;await poll();return;}
  if(button.hasAttribute('data-settings')){gameSettings();return;}
  if(button.dataset.copy){try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copied!';}catch(_){showError('Copy the student join page link shown above.');}return;}
  if(button.hasAttribute('data-end')){
   const dialog=document.createElement('dialog');dialog.className='live-confirm';dialog.innerHTML='<h2>End this game?</h2><p>Students will see the final scores. An unrevealed question will not count.</p><div class="actions"><button data-cancel>Keep playing</button><button class="danger" data-confirm>End game</button></div>';document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.querySelector('[data-confirm]').onclick=()=>{dialog.close();act('end');};return;
  }
  if(button.dataset.action)await act(button.dataset.action);
  if(button.dataset.choice!==undefined)await act('answer',{choice:Number(button.dataset.choice)});
 });
 setInterval(updateClock,100);
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);disconnectRealtime();});
 window.addEventListener('pageshow',()=>{if(auth&&stopped){stopped=false;poll();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);disconnectRealtime();return;}if(auth&&!busy&&!stopped)poll();});
 auth=stored(storageKey())||'';
 if(host&&!auth){stage.innerHTML='<section class="panel waiting"><h1>Open Teacher tools first.</h1><p>Start a live game from your class webpage using its editing code.</p><a class="button primary" href="../">Back to classes</a></section>';}
 else if(auth){status.textContent='Connecting…';poll();}else joinForm();
})();

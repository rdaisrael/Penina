/* A private, decorative first-correct celebration. Never awaited by gameplay. */
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('host')==='1')return;
 const duration=2100,seen=new Set();
 let overlay=null,activeKey='',cleanupTimer=null,context=null,voices=[];
 const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 // Decode early; a slow or unavailable illustration never holds up a reveal.
 const artwork=new Image();artwork.src='/PeninaPlus-vocab-builder/flash-cards/live/leviim.webp';
 let artReady=false;artwork.decode().then(()=>{artReady=true;}).catch(()=>{});

 function stop(){
  clearTimeout(cleanupTimer);cleanupTimer=null;
  overlay?.remove();overlay=null;activeKey='';
  for(const voice of voices){try{voice.oscillator.stop();voice.oscillator.disconnect();voice.gain.disconnect();}catch(_){}}
  voices=[];
 }
 function primeAudio(event){
  if(event?.type==='keydown' && !['Enter',' '].includes(event.key))return;
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   context ||= new Audio({latencyHint:'interactive'});
   if(context.state!=='running'){
    // Called synchronously from the student's normal tap, as required on iPad.
    const resumed=context.resume();resumed?.catch(()=>{});
    const silent=context.createBufferSource();silent.buffer=context.createBuffer(1,1,context.sampleRate);silent.connect(context.destination);silent.onended=()=>silent.disconnect();silent.start();
   }
  }catch(_){/* Muted/unavailable audio must never affect answering. */}
 }
 function shevarim(){
  if(!context || context.state!=='running')return; // Never queue late sound.
  try{
   const real=new Float32Array(9),imag=new Float32Array([0,1,.48,.3,.16,.09,.05,.025,.012]);
   const wave=context.createPeriodicWave(real,imag),start=context.currentTime+.28;
   // Three distinct, gently falling horn calls; two soft voices, one per Levi.
   for(let blast=0;blast<3;blast++)for(let side=0;side<2;side++){
    const at=start+blast*.46,oscillator=context.createOscillator(),gain=context.createGain();
    const pitch=side?438:444;
    oscillator.setPeriodicWave(wave);
    oscillator.frequency.setValueAtTime(pitch*.88,at);
    oscillator.frequency.exponentialRampToValueAtTime(pitch,at+.065);
    oscillator.frequency.exponentialRampToValueAtTime(pitch*.94,at+.29);
    gain.gain.setValueAtTime(0,at);
    gain.gain.linearRampToValueAtTime(.025,at+.045);
    gain.gain.linearRampToValueAtTime(.019,at+.24);
    gain.gain.linearRampToValueAtTime(0,at+.36);
    oscillator.connect(gain);gain.connect(context.destination);
    const voice={oscillator,gain};voices.push(voice);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();voices=voices.filter(item=>item!==voice);};
    oscillator.start(at);oscillator.stop(at+.37);
   }
  }catch(_){/* Decorative sound is optional. */}
 }
 function wasSeen(key){
  if(seen.has(key))return true;
  seen.add(key);
  try{const code=new URLSearchParams(location.search).get('code')||'',storageKey='penina-live-shofar:'+code+':'+key;if(sessionStorage.getItem(storageKey))return true;sessionStorage.setItem(storageKey,'1');}catch(_){}
  return false;
 }
 function update(data){
  const key=`${data.round||0}:${data.index}`;
  if(activeKey && (activeKey!==key || data.phase!=='reveal' || data.paused))stop();
  if(data.phase!=='reveal' || !(data.me?.bonuses?.first>0) || data.me.choice==null || data.me.choice!==data.question?.correct || wasSeen(key))return;
  if(document.hidden || data.paused)return;
  activeKey=key;
  if(artReady){
   overlay=document.createElement('div');overlay.className='leviim-celebration'+(reduceMotion?.matches?' reduced-motion':'');overlay.setAttribute('aria-hidden','true');
   for(const side of ['left','right']){
    const performer=document.createElement('div');performer.className='levi-performer levi-'+side;
    const sprite=document.createElement('div');sprite.className='levi-sprite';performer.append(sprite);
    const notes=document.createElement('div');notes.className='shofar-notes';
    for(let i=0;i<6;i++){const note=document.createElement('span');note.textContent=i%2?'♪':'♫';note.style.setProperty('--note-delay',(.26+i*.2)+'s');note.style.setProperty('--note-rise',(-28-(i%3)*14)+'px');notes.append(note);}
    performer.append(notes);overlay.append(performer);
   }
   document.body.append(overlay);
  }
  shevarim();cleanupTimer=setTimeout(stop,duration);
 }
 // These listeners never cancel an event or delay the game's own handlers.
 document.addEventListener('pointerup',primeAudio,{capture:true,passive:true});
 document.addEventListener('touchend',primeAudio,{capture:true,passive:true});
 document.addEventListener('keydown',primeAudio,{capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 window.addEventListener('pagehide',stop);
 window.PeninaShofar={update,stop};
})();

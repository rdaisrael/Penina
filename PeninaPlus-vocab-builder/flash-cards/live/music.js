(() => {
 'use strict';
 const tracks=[{title:'Kol Haderech',url:'/PeninaPlus-vocab-builder/flash-cards/live/music/kol-haderech.mp3'},{title:'Schar Mitzvah',url:'/PeninaPlus-vocab-builder/flash-cards/live/music/schar-mitzvah.mp3'}];
 let panel,audio,dialog,startButton,queue=tracks.map((_,i)=>i),current=0,repeat=true,phase='',generation=0,finished=false;
 function stop(){generation++;audio.pause();audio.currentTime=0;finished=false;}
 const storageKey='penina-lobby-music';
 function save(){try{localStorage.setItem(storageKey,JSON.stringify({version:2,queue,muted:audio.muted,repeat,volume:audio.volume}));}catch(e){}}
 function render(){
  save();
  if(!panel)return;
  panel.querySelector('[data-playlist]').innerHTML=queue.map((id,i)=>`<li><span>${i+1}. ${tracks[id].title}</span><button type="button" data-up="${i}" aria-label="Move ${tracks[id].title} up" ${i===0?'disabled':''}>\u2191</button><button type="button" data-down="${i}" aria-label="Move ${tracks[id].title} down" ${i===queue.length-1?'disabled':''}>\u2193</button><button type="button" data-remove="${i}" aria-label="Remove ${tracks[id].title}">Remove</button></li>`).join('');
  panel.querySelectorAll('[data-add]').forEach(b=>b.disabled=queue.includes(Number(b.dataset.add)));
  panel.querySelector('[data-mute]').textContent=audio.muted?'Unmute':'Mute';
  panel.querySelector('[data-mute]').setAttribute('aria-pressed',String(audio.muted));
  panel.querySelector('[data-play]').disabled=!queue.length||phase==='ended';
  panel.querySelector('[data-play]').textContent=audio.paused?'Play music':'Pause music';
  panel.querySelector('[data-next]').disabled=!queue.length||phase==='ended'||(!repeat&&current>=queue.length-1);
  panel.querySelector('[data-music-status]').textContent=audio.muted?'Music muted':!queue.length?'Add songs to your playlist.':finished?'Playlist finished':phase==='ended'?'Game finished \u00b7 music stopped':`${audio.paused?'Ready / paused':'Playing'}: ${tracks[queue[current]].title}`;
 }
 async function play(){
  if(!queue.length||phase==='ended')return;
  if(finished){current=0;finished=false;audio.removeAttribute('src');}
  const url=new URL(tracks[queue[current]].url,location.href).href;
  if(audio.src!==url){audio.src=url;audio.load();}
  const attempt=++generation;
  try{await audio.play();if(attempt!==generation)return;if(startButton){startButton.remove();startButton=null;}render();}
  catch(e){if(attempt!==generation)return;render();if(!panel){if(!startButton){startButton=document.createElement('button');startButton.className='music-start';startButton.textContent='Start lobby music';startButton.onclick=()=>play();document.querySelector('.topbar').after(startButton);}return;}panel.querySelector('[data-music-status]').textContent=e.name==='NotAllowedError'?'Press Play music to start audio.':'This song could not play. Try the next song.';}
 }
 function next(){
  if(current+1<queue.length)current++;else if(repeat)current=0;else{stop();finished=true;render();return;}
  stop();audio.removeAttribute('src');play();
 }
 function init(){
  if(audio)return;
  audio=new Audio();audio.preload='none';audio.volume=.35;audio.hidden=true;document.body.append(audio);
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(saved.version===2){queue=Array.isArray(saved.queue)?[...new Set(saved.queue.filter(i=>Number.isInteger(i)&&tracks[i]))]:queue;repeat=saved.repeat!==false;audio.muted=saved.muted===true;}if(Number.isFinite(saved.volume))audio.volume=Math.max(0,Math.min(1,saved.volume));}catch(e){}
  audio.onended=next;
  audio.onerror=()=>{if(panel)panel.querySelector('[data-music-status]').textContent='This song could not load. Try the next song.';};
  window.addEventListener('pagehide',stop);
 }
 function mount(){
  init();
  dialog=document.createElement('dialog');dialog.className='music-dialog';dialog.setAttribute('aria-label','Adjust Lobby Music');
  dialog.innerHTML='<h2>Adjust Lobby Music</h2>';
  document.body.append(dialog);
  panel=document.createElement('section');panel.className='music-panel';panel.setAttribute('aria-label','Classroom music');
  panel.innerHTML=`<div class="music-toolbar"><strong>\u266b Classroom music</strong><button type="button" data-mute aria-pressed="false">Mute</button><button type="button" data-play disabled>Play music</button><button type="button" data-next disabled>Next song</button><label class="music-volume">Volume <input data-volume type="range" min="0" max="100" value="35" aria-label="Music volume"><output data-volume-label>35%</output></label></div><p data-music-status role="status">Ready to play</p><details open><summary>Build playlist</summary><p class="muted">Mordechai Shapiro \u00b7 Plays through the teacher\u2019s speakers in the lobby and during the game.</p><div class="music-library">${tracks.map((t,i)=>`<button type="button" data-add="${i}">Add ${t.title}</button>`).join('')}</div><ol data-playlist class="music-playlist"></ol><label>Playback<select data-repeat><option value="once">Play through once</option><option value="repeat">Repeat playlist</option></select></label><p class="muted">All songs play and repeat by default when the lobby opens. Remove or reorder songs to customize your playlist, or choose Play through once. Mute silences the music; Unmute restores it. Play music previews your selection. Your settings are saved in this browser. Music stops when the game finishes.</p></details>`;
  dialog.append(panel);
  const done=document.createElement('button');done.type='button';done.textContent='Done';done.className='music-done';done.onclick=()=>dialog.close();dialog.append(done);
  dialog.addEventListener('close',()=>{stop();render();});
  panel.querySelector('[data-repeat]').value=repeat?'repeat':'once';
  panel.querySelector('[data-volume]').value=Math.round(audio.volume*100);
  panel.querySelector('[data-volume-label]').value=Math.round(audio.volume*100)+'%';
  panel.querySelector('[data-mute]').onclick=()=>{audio.muted=!audio.muted;render();};
  panel.querySelector('[data-repeat]').onchange=e=>{repeat=e.target.value==='repeat';render();};
  panel.querySelector('[data-volume]').oninput=e=>{audio.volume=Number(e.target.value)/100;panel.querySelector('[data-volume-label]').value=e.target.value+'%';save();};
  panel.querySelector('[data-play]').onclick=()=>{if(audio.paused)play();else{generation++;audio.pause();render();}};
  panel.querySelector('[data-next]').onclick=next;
  panel.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b||b.disabled)return;
   if(b.dataset.add!==undefined){queue.push(Number(b.dataset.add));render();return;}
   const kind=['up','down','remove'].find(k=>b.dataset[k]!==undefined);if(!kind)return;
   const i=Number(b.dataset[kind]),active=queue[current],wasPlaying=!audio.paused;
   if(kind==='remove')queue.splice(i,1);else{const j=i+(kind==='up'?-1:1);[queue[i],queue[j]]=[queue[j],queue[i]];}
   if(queue.includes(active))current=queue.indexOf(active);else{stop();current=Math.min(i,Math.max(0,queue.length-1));audio.removeAttribute('src');if(wasPlaying&&queue.length)play();}
   render();
  });
  render();
 }
 window.PeninaMusic={
  openSettings(){if(!dialog)mount();dialog.showModal();},
  update(data){init();const previous=phase;phase=data.phase;if(phase==='ended'){stop();if(startButton){startButton.remove();startButton=null;}}else if(!previous||previous==='ended'){current=0;finished=false;play();}}
 };

})();

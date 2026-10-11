(() => {
 'use strict';
 const tracks=[{title:'Kol Haderech',url:'music/kol-haderech.mp3'},{title:'Schar Mitzvah',url:'music/schar-mitzvah.mp3'}];
 let panel,audio,queue=[],current=0,mode='off',repeat=false,phase='',generation=0,finished=false;
 function stop(){generation++;audio.pause();audio.currentTime=0;finished=false;}
 function render(){
  panel.querySelector('[data-playlist]').innerHTML=queue.map((id,i)=>`<li><span>${i+1}. ${tracks[id].title}</span><button type="button" data-up="${i}" aria-label="Move ${tracks[id].title} up" ${i===0?'disabled':''}>\u2191</button><button type="button" data-down="${i}" aria-label="Move ${tracks[id].title} down" ${i===queue.length-1?'disabled':''}>\u2193</button><button type="button" data-remove="${i}" aria-label="Remove ${tracks[id].title}">Remove</button></li>`).join('');
  panel.querySelectorAll('[data-add]').forEach(b=>b.disabled=queue.includes(Number(b.dataset.add)));
  panel.querySelector('[data-play]').disabled=mode==='off'||!queue.length||phase==='ended';
  panel.querySelector('[data-play]').textContent=audio.paused?'Play music':'Pause music';
  panel.querySelector('[data-next]').disabled=mode==='off'||!queue.length||phase==='ended'||(!repeat&&current>=queue.length-1);
  panel.querySelector('[data-music-status]').textContent=mode==='off'?'No Music':!queue.length?'Add songs to your playlist.':finished?'Playlist finished':phase==='ended'?'Game finished \u00b7 music stopped':`${audio.paused?'Ready / paused':'Playing'}: ${tracks[queue[current]].title}`;
 }
 async function play(){
  if(mode==='off'||!queue.length||phase==='ended')return;
  if(finished){current=0;finished=false;audio.removeAttribute('src');}
  const url=new URL(tracks[queue[current]].url,location.href).href;
  if(audio.src!==url){audio.src=url;audio.load();}
  const attempt=++generation;
  try{await audio.play();if(attempt!==generation)return;render();}
  catch(e){if(attempt!==generation)return;render();panel.querySelector('[data-music-status]').textContent=e.name==='NotAllowedError'?'Press Play music to start audio.':'This song could not play. Try the next song.';}
 }
 function next(){
  if(current+1<queue.length)current++;else if(repeat)current=0;else{stop();finished=true;render();return;}
  stop();audio.removeAttribute('src');play();
 }
 function mount(){
  audio=new Audio();audio.preload='none';audio.volume=.35;
  panel=document.createElement('section');panel.className='music-panel';panel.setAttribute('aria-label','Classroom music');
  panel.innerHTML=`<div class="music-toolbar"><strong>\u266b Classroom music</strong><label>Music<select data-mode><option value="off">No Music</option><option value="playlist">Playlist</option></select></label><button type="button" data-play disabled>Play music</button><button type="button" data-next disabled>Next song</button><label class="music-volume">Volume <input data-volume type="range" min="0" max="100" value="35" aria-label="Music volume"><output data-volume-label>35%</output></label></div><p data-music-status role="status">No Music</p><details><summary>Build playlist</summary><p class="muted">Mordechai Shapiro \u00b7 Plays through the teacher\u2019s speakers in the lobby and during the game.</p><div class="music-library">${tracks.map((t,i)=>`<button type="button" data-add="${i}">Add ${t.title}</button>`).join('')}</div><ol data-playlist class="music-playlist"></ol><label>Playback<select data-repeat><option value="once">Play through once</option><option value="repeat">Repeat playlist</option></select></label><p class="muted">Choose Playlist, then press Play music. No Music stops playback. Music stops when the game finishes.</p></details>`;
  document.querySelector('.topbar').after(panel);
  panel.querySelector('[data-mode]').onchange=e=>{mode=e.target.value;if(mode==='off')stop();render();};
  panel.querySelector('[data-repeat]').onchange=e=>{repeat=e.target.value==='repeat';render();};
  panel.querySelector('[data-volume]').oninput=e=>{audio.volume=Number(e.target.value)/100;panel.querySelector('[data-volume-label]').value=e.target.value+'%';};
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
  audio.onended=next;audio.onerror=()=>{render();panel.querySelector('[data-music-status]').textContent='This song could not load. Try the next song.';};
  window.addEventListener('pagehide',()=>{stop();render();});render();
 }
 window.PeninaMusic={update(data){if(!panel)mount();const changed=phase!==data.phase;phase=data.phase;if(changed){if(phase==='ended')stop();render();}}};
})();

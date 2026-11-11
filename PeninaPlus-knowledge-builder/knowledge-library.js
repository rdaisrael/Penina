/* Knowledge sets share the existing class page and teacher ownership checks. */
(() => {
    'use strict';
    const grade=document.body.dataset.grade || new URLSearchParams(location.search).get('page') || '';
    if(!grade)return;
    const section=document.createElement('section');section.className='knowledge-library';section.hidden=true;
    section.setAttribute('aria-labelledby','knowledge-lists-heading');
    section.innerHTML='<h2 id="knowledge-lists-heading">Knowledge Lists</h2><p class="status" role="status"></p><div class="sets"></div>';
    document.getElementById('sets').after(section);
    const note=section.querySelector('p'),list=section.querySelector('.sets');
    const tools=document.createElement('fieldset');tools.className='teacher-choices';tools.hidden=true;
    document.getElementById('management').append(tools);
    let sets=[];
    function render() {
        const query=document.getElementById('search').value.trim().toLowerCase();
        const visible=sets.filter(set=>set.title.toLowerCase().includes(query));
        section.hidden=!sets.length;
        list.replaceChildren(...visible.map(set=>{
            const card=document.createElement('article');card.className='set';
            const heading=document.createElement('h2');heading.textContent=set.title;
            const count=document.createElement('p');count.textContent=`${set.cardCount} cards`;
            const actions=document.createElement('div');actions.className='set-actions';
            [['Flashcards',set.url],['Download',set.downloadUrl],['Print Cards',set.printUrl],['Knowledge Sheet',set.sheetUrl],...(set.hasPractice?[['Practice',set.practiceUrl]]:[])].forEach(([title,url])=>{
                if(typeof url!=='string'||!/^\/(?!\/)/.test(url))return;
                const link=document.createElement('a');link.className='set-action';link.textContent=title;link.href=url;link.target='_blank';link.rel='noopener';if(title==='Download')link.download='';actions.append(link);
            });card.append(heading,count,actions);return card;
        }));
        note.textContent=visible.length?'':'No knowledge lists match that search.';note.hidden=visible.length>0;
        if(visible.length && !document.getElementById('sets').children.length)document.getElementById('status').hidden=true;
        if(sets.length){document.querySelector('.intro').textContent='Choose a vocabulary or knowledge set to study its flashcards, sheets, and practice activities.';const search=document.getElementById('search');search.placeholder='Search vocabulary and knowledge sets…';search.setAttribute('aria-label','Search vocabulary and knowledge sets');}
        tools.hidden=!sets.length;tools.replaceChildren();
        const legend=document.createElement('legend');legend.textContent='Knowledge sets';tools.append(legend);
        sets.forEach(set=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=set.pathname;label.append(input,document.createTextNode(set.title));tools.append(label);});
        const button=document.createElement('button');button.type='button';button.className='combine-action';button.textContent='Remove Selected Knowledge Sets';tools.append(button);
        const message=document.createElement('p');message.setAttribute('role','status');tools.append(message);
        button.onclick=async()=>{
            const pathnames=[...tools.querySelectorAll('input:checked')].map(input=>input.value);
            if(!pathnames.length){message.textContent='Select at least one knowledge set.';return;}
            if(!window.confirm('Remove these knowledge sets from this class page? Keep a downloaded draft if you want to publish them again.'))return;
            button.disabled=true;
            try{const response=await fetch('/api/flashcard-sets',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'knowledge',grade,pathnames})});const data=await response.json();if(!response.ok)throw Error(data.error);await load();}
            catch(error){message.textContent=error.message;button.disabled=false;}
        };
    }
    async function load() {
        try{const response=await fetch(`/api/flashcard-sets?kind=knowledge&grade=${encodeURIComponent(grade)}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);sets=Array.isArray(data.sets)?data.sets:[];render();}
        catch(_){section.hidden=false;note.hidden=false;note.textContent='Knowledge sets could not be loaded. Refresh the page to try again.';}
    }
    document.getElementById('search').addEventListener('input',render);
    window.addEventListener('penina-vocabulary-library-loaded',render);
    load();
})();

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
        const query=document.getElementById('search').value;
        const visible=sets.map(set=>({set,result:PeninaLibrarySearch.find(set,query)})).filter(item=>item.result.matches);
        section.hidden=!sets.length;
        list.replaceChildren(...visible.map(({set,result})=>{
            const card=document.createElement('article');card.className='set';
            const heading=document.createElement('div');heading.className='set-heading';
            const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='combine-select';checkbox.value=set.pathname;
            checkbox.checked=!!window.PeninaStudySelection?.has(set.pathname);checkbox.setAttribute('aria-label',`Include ${set.title} in a combined set`);
            const title=document.createElement('h2');title.textContent=set.title;heading.append(checkbox,title);
            const date=document.createElement('time'),published=new Date(set.publishedAt);
            date.textContent=Number.isNaN(published.getTime())?'':published.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
            if(!Number.isNaN(published.getTime()))date.dateTime=published.toISOString();
            const actions=document.createElement('div');actions.className='set-actions';
            for(const [name,links] of [
                ['Flashcards',[['View',set.url],['Download',set.downloadUrl,true],['Print',set.printUrl,true],['Print/PDF',set.printUrl]]],
                ['Sheets',[['View',set.sheetUrl],['Download PDF',set.sheetDownloadUrl,true],['Print',set.sheetPrintUrl,true],['Print/PDF',set.sheetPrintUrl]]]
            ]) {
                const group=document.createElement('section');group.className='set-action-group';group.setAttribute('aria-label',name);
                const label=document.createElement('h3');label.textContent=name;group.append(label);
                for(const [text,url,hidden=false] of links) {
                    if(typeof url!=='string'||!/^\/(?!\/)/.test(url))continue;
                    const link=document.createElement('a');link.className='set-action';link.textContent=text;link.href=url;link.target='_blank';link.rel='noopener';
                    link.hidden=hidden;
                    link.setAttribute('aria-label',text==='Download PDF'?'Download Sheets (PDF)':`${text} ${name}`);
                    if(text==='Download')link.download='';group.append(link);
                }
                actions.append(group);
            }
            card.append(heading);
            card.insertAdjacentHTML('beforeend',PeninaLibrarySearch.preview(result.entries));
            card.append(date,actions);return card;
        }));
        note.textContent=visible.length?'':'No knowledge sets, questions, or answers match that search.';note.hidden=visible.length>0;
        if(visible.length && !document.getElementById('sets').children.length)document.getElementById('status').hidden=true;
        if(sets.length){document.querySelector('.intro').textContent='Choose a vocabulary or knowledge set to study its flashcards, sheets, and practice activities.';const search=document.getElementById('search');search.setAttribute('aria-label','Search set names, Hebrew terms, English or Hebrew definitions, and knowledge questions and answers');}
        tools.hidden=!sets.length;tools.replaceChildren();
        const legend=document.createElement('legend');legend.textContent='Knowledge sets';tools.append(legend);
        sets.forEach(set=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=set.pathname;label.append(input,document.createTextNode(set.title));tools.append(label);});
        const button=document.createElement('button');button.type='button';button.className='combine-action';button.textContent='Remove Selected Knowledge Sets';tools.append(button);
        const message=document.createElement('p');message.setAttribute('role','status');tools.append(message);
        button.onclick=async()=>{
            const pathnames=[...tools.querySelectorAll('input:checked')].map(input=>input.value);
            if(!pathnames.length){message.textContent='Select at least one knowledge set.';return;}
            if(!window.confirm('Remove these knowledge sets from this class page? Keep a saved draft if you want to publish them again.'))return;
            button.disabled=true;
            try{const response=await fetch('/api/flashcard-sets',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'knowledge',grade,pathnames})});const data=await response.json();if(!response.ok)throw Error(data.error);await load();}
            catch(error){message.textContent=error.message;button.disabled=false;}
        };
    }
    async function load() {
        try{const response=await fetch(`/api/flashcard-sets?kind=knowledge&grade=${encodeURIComponent(grade)}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);sets=Array.isArray(data.sets)?data.sets:[];render();window.dispatchEvent(new CustomEvent('penina-knowledge-library-loaded',{detail:sets}));}
        catch(_){section.hidden=false;note.hidden=false;note.textContent='Knowledge sets could not be loaded. Refresh the page to try again.';}
    }
    document.getElementById('search').addEventListener('input',render);
    window.addEventListener('penina-vocabulary-library-loaded',render);
    load();
})();

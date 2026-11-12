/* Measure questions and their notes together at the existing Letter print size. */
(function(root){
    function scale(output){
        const page=output.querySelector('.worksheet-page');
        if(!page||!output.clientWidth)return;
        const style=getComputedStyle(output);
        const width=output.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
        output.style.setProperty('--page-scale',Math.min(1,width/page.offsetWidth));
    }
    function paginate(output,placement){
        const notes=output.querySelector('.vocabulary-notes');
        const noteById=new Map([...output.querySelectorAll('.vocabulary-note')].map(note=>[note.dataset.noteId,note]));
        const units=[];
        for(const node of [...output.children]){
            if(node===notes)continue;
            if(node.matches('.exercise-section')){
                const questions=[...node.querySelectorAll('.question')];
                questions.forEach((question,i)=>units.push({node:question,section:node,last:i===questions.length-1}));
            }else units.push({node});
        }
        // End notes flow after the exercises, and may span several pages.
        if(placement==='end'&&notes)for(const note of noteById.values())units.push({node:note,section:notes});
        const stage=document.createElement('div');
        stage.className='paper worksheet-measure';document.body.append(stage);
        let page,content,noteBox,wrappers;
        const newPage=()=>{
            page=document.createElement('section');page.className='worksheet-page';
            page.setAttribute('aria-label',`Page ${stage.children.length+1}`);
            content=document.createElement('div');content.className='worksheet-page-content';
            noteBox=document.createElement('aside');noteBox.className='vocabulary-notes page-notes';
            page.append(content,noteBox);stage.append(page);wrappers=new Map();
        };
        const append=unit=>{
            let target=content;
            if(unit.section){
                if(!wrappers.has(unit.section)){
                    const wrapper=unit.section.cloneNode(false);
                    for(const child of unit.section.children)if(child.matches('h3,.exercise-instructions'))wrapper.append(child.cloneNode(true));
                    content.append(wrapper);wrappers.set(unit.section,wrapper);
                }
                target=wrappers.get(unit.section);
            }
            const clone=unit.node.cloneNode(true);target.append(clone);
            let check;
            if(unit.last){check=unit.section.querySelector('.self-check')?.cloneNode(true);if(check)target.append(check);}
            return ()=>{clone.remove();check?.remove();if(unit.section&&!target.querySelector('.question,.vocabulary-note')){target.remove();wrappers.delete(unit.section);}};
        };
        const renderNotes=()=>{
            noteBox.replaceChildren();
            const ids=placement==='page'?[...new Set([...content.querySelectorAll('.vocabulary-marker')].map(marker=>marker.dataset.noteId))]:[];
            noteBox.hidden=!ids.length;
            if(!ids.length)return;
            const heading=document.createElement('h3');heading.textContent='Vocabulary notes';
            const list=document.createElement('div');list.className='vocabulary-note-list';
            for(const id of ids)if(noteById.has(id))list.append(noteById.get(id).cloneNode(true));
            noteBox.append(heading,list);
        };
        try{
            newPage();
            for(const unit of units){
                const hadContent=content.childElementCount>0,remove=append(unit);renderNotes();
                if(page.scrollHeight>page.clientHeight+1&&hadContent){remove();renderNotes();newPage();append(unit);renderNotes();}
                // Exceptionally large teaching text must remain readable, never clipped.
                if(page.scrollHeight>page.clientHeight+1)page.classList.add('worksheet-page-overflow');
            }
            output.replaceChildren(...stage.children);output.classList.add('paginated');scale(output);
        }finally{stage.remove();}
    }
    root.BinyanPagination={paginate,scale};
})(typeof globalThis!=='undefined'?globalThis:this);

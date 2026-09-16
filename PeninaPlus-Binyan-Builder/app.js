(() => {
    'use strict';
    const core=window.BinyanBuilder, $=id=>document.getElementById(id);
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let vocabulary=null, pairs=[], uploadVersion=0, generationVersion=0, controller=null, busy=false, result=null;
    const mode=()=>document.querySelector('input[name="mode"]:checked').value;
    const pairLabel=pair=>{const [group,tense]=pair.split('|');return `${group} · ${core.tenseNames[core.tenses.indexOf(tense)]} / ${tense}`;};
    function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
    function dirty(){
        generationVersion++;controller?.abort();controller=null;busy=false;
        if(result)$('preview-label').textContent='Previous worksheet';
        status('generation-status',result?'Settings changed. Build again to apply them; the previous worksheet is still available.':'Choose your patterns, then build a worksheet.');
        updateButton();
    }
    function eligiblePairs(){
        if(!vocabulary)return [];
        return mode()==='practice'?vocabulary.binyanim:core.groups.flatMap(g=>core.tenses.map(t=>`${g}|${t}`).filter(core.validPair));
    }
    const mixing=()=>$('mix-patterns').checked;
    const currentPair=()=>`${$('group').value}|${$('tense').value}`;
    const selectedPairs=()=>mixing()?pairs:(eligiblePairs().includes(currentPair())?[currentPair()]:[]);
    function updatePicker(){
        const available=eligiblePairs(), previous=$('group').value;
        const groups=core.groups.filter(g=>available.some(p=>p.split('|')[0]===g));
        $('group').replaceChildren(...groups.map(g=>new Option(core.generalGroups.includes(g)?`${g.split(' ')[0]} — All root types`:g,g)));
        if(groups.includes(previous))$('group').value=previous;
        $('group').disabled=!groups.length;
        updateTenses();
        $('selection-help').textContent=mode()==='practice'?'Only combinations marked X in this workbook are available. Enable mixed practice to include several.':'Choose a binyan and tense, then build. All root types accepts the different root types in your vocabulary; choose a specific group to focus on that pattern.';
    }
    function updateTenses(){
        const previous=$('tense').value;
        const available=eligiblePairs().filter(p=>p.split('|')[0]===$('group').value).map(p=>p.split('|')[1]);
        $('tense').replaceChildren(...available.map(t=>new Option(`${core.tenseNames[core.tenses.indexOf(t)]} / ${t}`,t)));
        if(available.includes(previous))$('tense').value=previous;
        $('tense').disabled=!available.length;$('add-pair').disabled=!available.length||pairs.length>=8;
    }
    function renderPairs(){
        $('pairs').replaceChildren(...pairs.map(pair=>{
            const chip=document.createElement('span');chip.className='pair-chip';
            const label=document.createElement('bdi');label.textContent=pairLabel(pair);
            const button=document.createElement('button');button.type='button';button.textContent='×';button.setAttribute('aria-label',`Remove ${pairLabel(pair)}`);
            button.addEventListener('click',()=>{pairs=pairs.filter(p=>p!==pair);dirty();renderPairs();});
            chip.append(label,button);return chip;
        }));
        $('pairs').hidden=!mixing();$('add-pair').hidden=!mixing();
        const selected=selectedPairs();
        status('pair-status',!vocabulary?'Upload a workbook to begin.':mode()==='practice'&&!vocabulary.binyanim.length?'No learned combinations are marked. Add X marks to your workbook, or choose Learn.':selected.length?`${selected.length} combination${selected.length===1?'':'s'} selected: ${selected.map(pairLabel).join('; ')}`:'Add at least one combination.');
        updateTenses();updateButton();
    }
    function request(){return core.validateRequest({mode:mode(),vocabulary,pairs:selectedPairs(),count:Number($('count').value)});}
    function updateButton(){
        let valid=true,reason='';try{request();}catch(error){valid=false;reason=error.message;}
        if(!busy&&!valid)status('generation-status',mode()==='practice'&&vocabulary&&!vocabulary.binyanim.length?'Practice needs X marks beside learned combinations in your workbook. Choose Learn to introduce a pattern without X marks.':reason);
        $('generate').disabled=busy||!valid;$('generate').textContent=busy?'Building your worksheet…':'Build worksheet';
    }
    async function loadWorkbook(getFile){
        const version=++uploadVersion;vocabulary=null;pairs=[];dirty();updatePicker();renderPairs();$('vocabulary-details').hidden=true;
        status('upload-status','Opening workbook…');
        try{
            const file=await getFile();
            if(!file)throw new Error('Choose an Excel workbook to begin.');
            if(!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Please upload an Excel Workbook (.xlsx).');
            if(file.size>5*1024*1024)throw new Error('Please upload a workbook smaller than 5 MB.');
            const parsed=await VocabularyUpload.readExcel(await file.arrayBuffer(),ExcelJS);
            if(!parsed.verbs.length)throw new Error('This workbook contains no mastered roots. Add roots in column A to build conjugation practice.');
            // Validate roots now, before a teacher spends time configuring a worksheet.
            core.validateRequest({mode:'learn',vocabulary:parsed,pairs:['פעל שלם|עבר'],count:6});
            if(version!==uploadVersion)return;
            vocabulary=parsed;
            status('upload-status',`${file.name}: ${parsed.verbs.length} roots · ${parsed.binyanim.length} learned combinations · ${parsed.nouns.length} nouns · ${parsed.adjs.length} adjectives`);
            $('roots').textContent=parsed.verbs.join('  ·  ');$('vocabulary-details').hidden=false;
            updatePicker();dirty();renderPairs();
        }catch(error){if(version===uploadVersion)status('upload-status',error.message,true);}
    }
    $('vocabulary').addEventListener('change',event=>loadWorkbook(async()=>event.target.files[0]));
    $('sample').addEventListener('click',()=>{
        $('vocabulary').value='';
        loadWorkbook(async()=>{
            const response=await fetch('/PeninaPlus-Reader/David_Mastered_Vocabulary.xlsx');
            if(!response.ok)throw new Error('The sample workbook could not be loaded. Please upload a workbook.');
            return new File([await response.blob()],'David_Mastered_Vocabulary.xlsx');
        });
    });
    document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',()=>{
        pairs=pairs.filter(pair=>eligiblePairs().includes(pair));updatePicker();dirty();renderPairs();
    }));
    $('group').addEventListener('change',()=>{updateTenses();dirty();renderPairs();});
    $('tense').addEventListener('change',()=>{dirty();renderPairs();});
    $('mix-patterns').addEventListener('change',()=>{
        if(mixing()&&!pairs.length&&eligiblePairs().includes(currentPair()))pairs=[currentPair()];
        dirty();renderPairs();
    });
    $('add-pair').addEventListener('click',()=>{
        const pair=`${$('group').value}|${$('tense').value}`;
        if(pairs.includes(pair)){status('pair-status','That combination is already selected.');return;}
        if(!eligiblePairs().includes(pair)||pairs.length>=8)return;
        pairs.push(pair);dirty();renderPairs();
    });
    $('count').addEventListener('change',()=>{dirty();if(selectedPairs().length>Number($('count').value))status('generation-status','Choose at least as many questions as selected combinations.',true);});
    $('title').addEventListener('input',dirty);
    const header=(title,r,key=false)=>`<div class="worksheet-heading"><p class="eyebrow">PENINAPLUS BINYAN BUILDER${key?' · ANSWER KEY':''}</p><h2>${esc(title)}</h2><p>${esc(r.request.mode==='learn'?'Learn a new pattern':'Practice learned patterns')} · ${r.questions.length} questions</p><p>${r.request.pairs.map(p=>`<bdi>${esc(pairLabel(p))}</bdi>`).join(' / ')}</p>${key?'':'<div class="name-line"><span>Name: ____________________</span><span>Date: ______________</span></div>'}</div>`;
    function renderWorksheet(r,title){
        $('empty-preview').hidden=true;$('output').hidden=false;
        $('student-sheet').innerHTML=header(title,r)+r.lessons.map(lesson=>`<section class="lesson"><h3><bdi>${esc(pairLabel(lesson.pair))}</bdi></h3><p>Model root: <bdi class="hebrew">${esc(lesson.root)}</bdi> — ${esc(lesson.meaning)}</p><p>${esc(lesson.explanation)}</p><table class="model-table"><thead><tr><th>Person / form</th><th>Model conjugation</th></tr></thead><tbody>${lesson.forms.map(row=>`<tr><td dir="rtl" lang="he">${esc(core.people[row.person])}</td><td dir="rtl" lang="he">${esc(row.answer)}</td></tr>`).join('')}</tbody></table></section>`).join('')+
            `<h3>Your turn</h3><p>Write the vowelled Hebrew form for each root and pattern.${r.request.mode==='learn'?' Use the model tables and hints to help.':''}</p>`+
            r.questions.map(q=>`<div class="question"><div class="question-top"><span class="question-number">${q.number}.</span><bdi>${esc(pairLabel(q.pair))}</bdi><span>${esc(q.meaning)}</span></div><div class="question-prompt"><span>Root: <bdi class="hebrew" lang="he">${esc(q.root)}</bdi> · <bdi class="hebrew" lang="he">${esc(core.people[q.person])}</bdi></span><span class="answer-line" aria-label="Write your answer"></span></div>${r.request.mode==='learn'?`<p class="hint">Hint: ${esc(q.hint)}</p>`:''}</div>`).join('');
        $('answer-sheet').innerHTML=header(title,r,true)+r.questions.map(q=>`<div class="question"><div class="question-top"><b>${q.number}.</b><bdi>${esc(pairLabel(q.pair))}</bdi><span>${esc(q.meaning)}</span></div><div class="question-prompt"><span><bdi class="hebrew" lang="he">${esc(q.root)} · ${esc(core.people[q.person])}</bdi></span><bdi class="key-answer" lang="he">${esc(q.answer)}</bdi></div></div>`).join('');
        $('show-key').checked=false;$('answer-sheet').hidden=true;
        $('preview-label').textContent='Ready to review';
    }
    $('generate').addEventListener('click',async()=>{
        let input;try{input=request();}catch(error){status('generation-status',error.message,true);return;}
        const version=++generationVersion;controller?.abort();const active=new AbortController();controller=active;busy=true;updateButton();
        const title=$('title').value.trim()||'Hebrew conjugation practice';
        status('generation-status','Building and checking your worksheet. This may take about a minute.');
        const timeout=setTimeout(()=>active.abort(),70000);
        try{
            const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,action:'binyan-worksheet'}),signal:active.signal});
            let data;try{data=await response.json();}catch{throw new Error('The worksheet service is unavailable or took too long. Please try again.');}
            if(!response.ok)throw new Error(data.error||'The worksheet could not be built. Please try again.');
            core.validateResult(data,input);
            if(version!==generationVersion)return;
            result={...data,request:input};renderWorksheet(result,title);
            status('generation-status','Worksheet ready. Review the model forms and answer key, then print.');
            if(window.innerWidth<801)$('preview-heading').scrollIntoView({behavior:'smooth'});
        }catch(error){if(version===generationVersion)status('generation-status',error.name==='AbortError'?'The request took too long. Please try fewer questions.':error.message,true);}
        finally{clearTimeout(timeout);if(version===generationVersion){busy=false;controller=null;updateButton();}}
    });
    $('show-key').addEventListener('change',()=>{$('answer-sheet').hidden=!$('show-key').checked;});
    $('font').addEventListener('change',()=>document.documentElement.style.setProperty('--hebrew-font',`"${$('font').value}"`));
    document.body.dataset.print='student';
    $('print-target').addEventListener('change',()=>{document.body.dataset.print=$('print-target').value;});
    $('print').addEventListener('click',()=>{document.body.dataset.print=$('print-target').value;window.print();});
    updatePicker();renderPairs();
})();

'use strict';
// Render only the blank student worksheet; never serialize the teacher's quiz or key.
(function(root,factory){
    if(typeof module==='object' && module.exports)module.exports=factory(require('../custom/scoring'),require('../picture'));
    else root.QuizPrint=factory(root.QuizScoring,QuizPicture);
})(typeof globalThis!=='undefined'?globalThis:this,function(scoring,picture){
    const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const names={text:'Written response',choice:'Multiple choice',multi:'Multiple answers',gaps:'Fill in the blanks',match:'Matching',order:'Put in order'};
    function letter(index){let label='';for(index++;index;index=Math.floor((index-1)/26))label=String.fromCharCode(65+(index-1)%26)+label;return label;}
    function shuffled(values,random){
        const copy=[...values];
        for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
        return copy;
    }
    const lines=count=>`<div class="qp-lines" aria-label="Space for your answer">${'<div class="qp-line"></div>'.repeat(count)}</div>`;
    function bank(choices,labelled=false){
        return `<section class="qp-bank"><h3>Word bank</h3><ul>${choices.map((value,i)=>`<li>${labelled?`<b dir="ltr">${letter(i)}.</b> `:''}<span dir="auto">${escape(value)}</span></li>`).join('')}</ul></section>`;
    }
    function question(q,index,random){
        const choices=shuffled(q.choices || [],random),direction=q.direction==='rtl'?'rtl':'ltr';
        let instruction='',response='';
        if(q.type==='text'){
            instruction='Write your answer clearly. Use the lines below.';
            response=q.pictureResponseMode==='markers' && q.image?.markers?.length?q.image.markers.map((_,i)=>`<div class="qp-marker-answer"><h3>Marker ${i+1}</h3>${lines(2)}</div>`).join(''):lines(4);
        }else if(q.type==='choice' || q.type==='multi'){
            instruction=q.type==='choice'?'Circle one answer.':'Check all correct answers.';
            response=`<ul class="qp-choices" dir="${direction}">${choices.map((value,i)=>`<li><span class="qp-choice-label ${q.type==='multi'?'qp-checkbox':''}" dir="ltr">${q.type==='multi'?'':letter(i)}</span><span dir="auto">${escape(value)}</span></li>`).join('')}</ul>`;
        }else if(q.type==='gaps'){
            instruction=q.wordBank===false?'Write the missing word or words in each blank.':'Fill each blank using the word bank. You may use a word more than once; some words may not be needed.';
            response=q.wordBank===false?'':bank(choices);
        }else if(q.type==='match'){
            const count=scoring.responseCount(q);
            instruction=`Write the matching word-bank letter on each line. Make ${count} match${count===1?'':'es'}. Letters may be used more than once. Leave unmatched terms blank.`;
            response=bank(choices,true)+`<ol class="qp-matches" dir="${direction}">${(q.items || []).map(value=>`<li><span class="qp-short-line" aria-label="Answer"></span><span dir="auto">${escape(value)}</span></li>`).join('')}</ol>`;
        }else if(q.type==='order'){
            instruction='Write the items in the correct order on the numbered lines. Use each item once.';
            response=bank(choices)+`<ol class="qp-order" dir="${direction}">${choices.map(()=>'<li><span class="qp-order-line"></span></li>').join('')}</ol>`;
        }
        const prompt=q.type==='gaps'?escape(q.prompt).split('___').join('<span class="qp-blank" aria-label="Blank">&#160;</span>'):escape(q.prompt);
        const points=scoring.maxPoints(q);
        return `<article class="qp-question" aria-label="Question ${index+1}"><div class="qp-question-head"><span class="qp-number">${index+1}</span><span class="qp-kind">${escape(names[q.type] || 'Question')}${q.extraCredit?' · Extra credit':''}</span><span class="qp-points">${points} ${points===1?'point':'points'}</span></div><p class="qp-instruction">${instruction}</p><h2 class="qp-prompt" dir="${direction}">${prompt || 'Question not entered yet.'}</h2>${picture.render(q)}${response}</article>`;
    }
    function render(quiz,random=Math.random){
        const questions=quiz.questions || [];
        if(!questions.length)throw Error('Add at least one question before printing.');
        const total=questions.filter(q=>!q.extraCredit).reduce((sum,q)=>sum+scoring.maxPoints(q),0);
        const extra=questions.filter(q=>q.extraCredit).reduce((sum,q)=>sum+scoring.maxPoints(q),0);
        return `<div class="qp-paper"><header class="qp-cover"><div class="qp-brand">PENINA <span>CLASSROOM QUIZ</span></div><h1 dir="auto">${escape(quiz.title?.trim() || 'Classroom quiz')}</h1><p class="qp-meta">${questions.length} question${questions.length===1?'':'s'} <span>·</span> ${total} ${total===1?'point':'points'}${extra?` <span>·</span> ${extra} extra-credit ${extra===1?'point':'points'}`:''}${quiz.durationMinutes?` <span>·</span> ${Number(quiz.durationMinutes)} minutes`:''}</p><div class="qp-student"><div class="qp-name">Name <span></span></div><div>Date <span></span></div><div>Class <span></span></div></div><p class="qp-directions"><strong>Before you begin</strong> Read each question carefully. Write neatly, and check your work when you finish.</p></header>${questions.map((q,i)=>question(q,i,random)).join('')}<p class="qp-finish">You’re finished! Check that you’ve answered every required question.</p></div>`;
    }
    let previousTitle='',previousScroll=0,returnFocus=null,active=false;
    function close(){
        if(!active)return;
        active=false;
        document.body.classList.remove('quiz-print-open');
        document.getElementById('quizPrint').hidden=true;
        document.title=previousTitle;
        window.scrollTo(0,previousScroll);
        returnFocus?.focus({preventScroll:true});
    }
    async function ready(section){
        await Promise.all([...section.querySelectorAll('img')].map(img=>img.decode()));
        if(document.fonts)await document.fonts.ready;
    }
    function open(quiz){
        const markup=render(quiz);
        let section=document.getElementById('quizPrint');
        if(!section){section=document.createElement('section');section.id='quizPrint';section.setAttribute('aria-label','Printable quiz');document.body.append(section);}
        previousTitle=document.title;previousScroll=window.scrollY;returnFocus=document.activeElement;active=true;
        section.innerHTML=`<div class="qp-toolbar"><div><strong>Print preview</strong><p>A blank student copy, ready for paper.</p></div><div class="qp-toolbar-actions"><button type="button" id="closeQuizPrint" class="secondary">Back to quiz</button><button type="button" id="printQuizPaper">Print / Save PDF</button></div><p class="qp-print-status" role="status">For a clean copy, turn off Headers and footers in the print dialog.</p></div>${markup}`;
        section.hidden=false;document.body.classList.add('quiz-print-open');
        document.title=(quiz.title?.trim() || 'Classroom quiz')+' — Student copy';
        section.querySelector('#closeQuizPrint').onclick=close;
        const button=section.querySelector('#printQuizPaper'),status=section.querySelector('.qp-print-status');
        button.onclick=async()=>{
            button.disabled=true;
            try{await ready(section);window.print();}
            catch(_){status.textContent='A picture could not load. Go back to the quiz, check the picture, and try again.';}
            finally{button.disabled=false;}
        };
        window.scrollTo(0,0);button.focus({preventScroll:true});
    }
    if(typeof document!=='undefined')document.addEventListener('keydown',event=>{if(active && event.key==='Escape'){event.preventDefault();close();}});
    return {render,open,close};
});

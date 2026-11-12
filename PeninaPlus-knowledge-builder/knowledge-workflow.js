/* Teacher practice/share tools and the student practice view. */
(() => {
    'use strict';
    const {validChoices, practiceCards} = window.PeninaKnowledgeCards;
    const byId = id => document.getElementById(id);
    const make = (tag, className, text) => {
        const node = document.createElement(tag); if (className) node.className = className;
        if (text !== undefined) node.textContent = text; return node;
    };
    const safePageUrl = url => typeof url === 'string' && /^\/(?!\/)/.test(url) ? url : null;
    const copy = value => JSON.parse(JSON.stringify(value));
    async function request(url, body, signal) {
        const response = await fetch(url, {method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
            ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}), signal});
        let data; try {data = await response.json();} catch (_) {throw Error('The service could not be reached. Please try again.');}
        if (!response.ok) throw Error(data.error || 'The request could not be completed.');
        return data;
    }
    function mount({getDeck, changed, setStage, renderQuestion, studentMode}) {
        let language = 'english', rows = [], sourceKey = '', dirty = false, busy = false, controller, generation = 0;
        let pages = [], loadingPages = false, pagesLoaded = false, publishing = false;
        let quiz = [], quizIndex = 0, score = 0, answered = false;
        const status = (id, text, error = false) => {byId(id).textContent = text; byId(id).classList.toggle('error', error);};
        const signature = () => JSON.stringify(getDeck().cards.map(card => [card.id, card.question, card.answer, card.distractors]));
        function resetRows() {
            rows = getDeck().cards.map(card => ({id: card.id, question: card.question, answer: card.answer, answers: [...(card.distractors?.[language] || ['', '', '', ''])]}));
            sourceKey = signature(); dirty = false;
        }
        function refreshPractice() {
            byId('practice-editor').setAttribute('aria-busy', busy);
            byId('practice-editor').querySelectorAll('input, textarea, button, select').forEach(node => {node.disabled = busy;});
            byId('practice-cancel').disabled = false;
            byId('practice-cancel').hidden = !dirty && !busy;
            byId('preview-practice').disabled = !practiceCards(getDeck(), language).length || busy;
            byId('practice-language').value = language;
        }
        function renderRows() {
            byId('practice-rows').replaceChildren(...rows.map((row, i) => {
                const section = make('section', 'distractor-card');
                const title = make('h3', '', `${i + 1}. ${row.question}`); title.dir = 'auto'; section.append(title);
                const answerLabel = make('label', '', 'Correct answer');
                const answer = make('textarea'); answer.rows = 2; answer.dir = 'auto'; answer.value = row.answer;
                answer.id = `correct-${i}`; answerLabel.htmlFor = answer.id; answer.maxLength = 2000;
                answer.addEventListener('input', () => {row.answer = answer.value; dirty = true; refreshPractice();});
                section.append(answerLabel, answer);
                const choices = make('div', 'distractor-choices');
                row.answers.forEach((value, slot) => {
                    const cell = make('div');
                    const label = make('label', '', `Incorrect answer ${slot + 1}`);
                    const input = make('textarea'); input.rows = 2; input.dir = 'auto'; input.maxLength = 500; input.value = value;
                    input.id = `distractor-${i}-${slot}`; label.htmlFor = input.id;
                    input.addEventListener('input', () => {row.answers[slot] = input.value; dirty = true; refreshPractice();});
                    const regenerate = make('label', 'regenerate-choice');
                    const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.dataset.row = i; checkbox.dataset.slot = slot;
                    regenerate.append(checkbox, document.createTextNode('Regenerate this answer'));
                    cell.append(label, input, regenerate); choices.append(cell);
                });
                section.append(choices); return section;
            }));
            refreshPractice();
        }
        function enterPractice() {
            if (!dirty && sourceKey !== signature()) {resetRows(); renderRows();}
            if (!rows.length) {resetRows(); renderRows();}
        }
        function saveAnswers() {
            if (busy) {status('practice-status', 'Wait for generation to finish, or discard the pending changes.', true); return false;}
            if (!dirty) return true;
            for (const row of rows) {
                if (!row.answer.trim()) {status('practice-status', 'Enter a correct answer for every question.', true); return false;}
                const filled = row.answers.some(value => value.trim());
                if (filled && !validChoices(row.answer, row.answers)) {
                    status('practice-status', 'Use four different incorrect answers for each completed question. None may match its correct answer. Leave all four empty to skip a question.', true); return false;
                }
            }
            for (const row of rows) {
                const card = getDeck().cards.find(value => value.id === row.id);
                if (!card || card.question !== row.question) {status('practice-status', 'A question changed. Discard these changes and reopen practice.', true); return false;}
            }
            rows.forEach(row => {
                const card = getDeck().cards.find(value => value.id === row.id);
                if (card.answer !== row.answer.trim()) card.distractors = {};
                card.answer = row.answer.trim(); card.distractors ||= {};
                card.distractors[language] = row.answers.map(value => value.trim());
            });
            dirty = false; sourceKey = signature(); changed(); refreshPractice();
            status('practice-status', 'Answers saved. You can preview practice or continue to Share.'); return true;
        }
        async function generate(selected, requestedLanguage = language) {
            if (busy) return;
            if (requestedLanguage !== language) {
                if (!saveAnswers()) return;
                language = requestedLanguage; resetRows(); renderRows();
            }
            const selectedSlots = [...byId('practice-rows').querySelectorAll('input:checked')];
            const requests = rows.map((row, i) => ({id: i, term: row.question, definition: row.answer,
                answers: [...row.answers], slots: [0,1,2,3].filter(slot => selected
                    ? selectedSlots.some(input => +input.dataset.row === i && +input.dataset.slot === slot)
                    : !row.answers[slot].trim())})).filter(row => row.slots.length);
            if (!requests.length) {status('practice-status', selected ? 'Check the answers you want to regenerate.' : 'All cells are filled. Select answers to regenerate, or edit them directly.'); return;}
            if (requests.some(row => !row.definition.trim() || row.definition.length > 2000 || row.term.length > 4000)) {
                status('practice-status', 'Generation supports questions up to 4,000 characters and correct answers up to 2,000 characters. You can enter distractors manually for longer cards.', true); return;
            }
            busy = true; controller = new AbortController(); const run = ++generation; refreshPractice();
            const results = [];
            try {
                for (let start = 0; start < requests.length; start += 8) {
                    status('practice-status', `Generating ${requestedLanguage === 'hebrew' ? 'Hebrew' : 'English'} distractors for questions ${start + 1}–${Math.min(start + 8, requests.length)} of ${requests.length}…`);
                    const timer = setTimeout(() => controller.abort(), 100000);
                    let data;
                    try {data = await request('/api/flashcard-sets', {kind: 'knowledge', action: 'generate-distractors', language, rows: requests.slice(start, start + 8)}, controller.signal);}
                    finally {clearTimeout(timer);}
                    if (run !== generation) return;
                    results.push(...data.rows);
                }
                const source = rows.map((row, id) => ({id, term: row.question, definition: row.answer, answers: row.answers}));
                const merged = window.PeninaPracticeExercises.mergeGeneration(source, requests, results, language);
                rows.forEach((row, i) => {row.answers = merged[i].answers;}); dirty = true; renderRows();
                status('practice-status', 'Distractors generated. Review them, make any edits, then Save Answers.');
            } catch (error) {
                if (run === generation) status('practice-status', error.name === 'AbortError' ? 'Generation timed out. Your existing answers are unchanged; you can retry or enter them manually.' : error.message, true);
            } finally {if (run === generation) {busy = false; refreshPractice();}}
        }
        byId('generate-english').onclick = () => generate(false, 'english');
        byId('generate-hebrew').onclick = () => generate(false, 'hebrew');
        byId('regenerate-selected').onclick = () => generate(true);
        byId('save-answers').onclick = saveAnswers;
        byId('practice-language').onchange = event => {
            if (!saveAnswers()) {event.target.value = language; return;}
            language = event.target.value; resetRows(); renderRows(); status('practice-status', 'Enter four incorrect answers for each question, or use Generate to fill empty cells.');
        };
        byId('practice-cancel').onclick = () => {generation++; controller?.abort(); busy = false; resetRows(); renderRows(); status('practice-status', 'Unsaved changes discarded.');};
        byId('preview-practice').onclick = () => {if (saveAnswers()) {byId('quiz-language').value = language; setStage('quiz');}};
        byId('continue-share').onclick = () => setStage('share');

        function updatePageLinks() {
            const select = byId('publish-card-grade');
            const page = pages.find(value => value.id === select.value);
            const url = safePageUrl(page?.url);
            byId('selected-page-link').hidden = !url;
            byId('selected-page-link').href = url || '#';
            byId('selected-page-link').textContent = page ? `Open ${page.name} ↗` : '';
            byId('publish-knowledge').disabled = !page || publishing || loadingPages;
        }
        async function loadPages() {
            if (studentMode || loadingPages) return;
            loadingPages = true; updatePageLinks(); byId('retry-pages').hidden = true;
            status('pages-status', 'Loading your class pages…');
            try {
                const data = await request('/api/vocabulary-pages');
                const selected = byId('publish-card-grade').value;
                pages = data.pages.filter(page => safePageUrl(page.url)).sort((a,b) => a.name.localeCompare(b.name));
                byId('publish-card-grade').replaceChildren(...pages.map(page => {
                    const option = make('option', '', page.name); option.value = page.id; return option;
                }));
                if (pages.some(page => page.id === selected)) byId('publish-card-grade').value = selected;
                byId('published-page-links').replaceChildren(...pages.map(page => {
                    const link = make('a', '', page.name); link.href = page.url; link.target = '_blank'; link.rel = 'noopener'; return link;
                }));
                pagesLoaded = true; status('pages-status', pages.length ? '' : 'No class pages yet. Use Add webpage to create one.');
            } catch (error) {pages = []; byId('publish-card-grade').replaceChildren(); status('pages-status', error.message, true); byId('retry-pages').hidden = false;}
            finally {loadingPages = false; updatePageLinks();}
        }
        byId('retry-pages').onclick = loadPages;
        byId('publish-card-grade').onchange = () => {status('publish-status', ''); updatePageLinks();};
        byId('add-webpage-form').onsubmit = async event => {
            event.preventDefault(); const button = byId('create-webpage'); button.disabled = true;
            try {
                const result = await request('/api/vocabulary-pages', {name: byId('new-page-name').value.trim()});
                await loadPages(); byId('publish-card-grade').value = result.page.id; status('publish-status', ''); updatePageLinks();
                byId('add-webpage-form').reset(); byId('add-webpage').open = false;
                status('pages-status', `“${result.page.name}” was created and selected.`);
            } catch (error) {status('pages-status', error.message, true);} finally {button.disabled = false;}
        };
        byId('publish-knowledge').onclick = async () => {
            if (publishing) return;
            const deck = copy(getDeck());
            if (!deck.title.trim()) {status('publish-status', 'Enter a set title in Add & Edit Cards before publishing.', true); return;}
            if (!byId('publish-card-grade').value) return;
            publishing = true; updatePageLinks(); status('publish-status', 'Publishing flashcards, the knowledge sheet, and saved practice activities…');
            try {
                const body = {kind: 'knowledge', action: 'publish', grade: byId('publish-card-grade').value, deck};
                if (new Blob([JSON.stringify(body)]).size > 3500000) throw Error('This set is too large to publish. Use smaller picture files or split it into smaller sets. Your full draft is still available to download.');
                const data = await request('/api/flashcard-sets', body);
                status('publish-status', `“${deck.title}” was published successfully. `);
                if (safePageUrl(data.page?.url)) {const link = make('a', '', 'Open the class webpage →'); link.href = data.page.url; link.target = '_blank'; link.rel = 'noopener'; byId('publish-status').append(link);}
            } catch (error) {status('publish-status', error.message, true);} finally {publishing = false; updatePageLinks();}
        };
        async function spreadsheet() {
            const button = byId('download-spreadsheet'); button.disabled = true;
            try {
                if (!window.ExcelJS) await new Promise((resolve,reject) => {
                    const script = make('script'); script.src = '/PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js';
                    script.onload = resolve; script.onerror = () => {script.remove(); reject(Error('The spreadsheet tools could not be loaded. Try again.'));}; document.head.append(script);
                });
                const deck = getDeck(), workbook = new window.ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('Knowledge Cards');
                const headers = ['Question','Answer','Additional Information','Picture','Picture Description','Target X (%)','Target Y (%)', ...['English','Hebrew'].flatMap(lang => [1,2,3,4].map(n => `${lang} Distractor ${n}`))];
                sheet.columns = headers.map((header, i) => ({header, width: i < 3 ? 42 : i === 3 ? 24 : 25}));
                sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}}; sheet.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF0056B3'}};
                for (const card of deck.cards) {
                    const row = sheet.addRow([card.question,card.answer,card.additionalInformation,'',card.picture?.alt || '',
                        card.picture?.target ? Math.round(card.picture.target.x * 10000) / 100 : '',card.picture?.target ? Math.round(card.picture.target.y * 10000) / 100 : '',
                        ...(card.distractors?.english || ['', '', '', '']),...(card.distractors?.hebrew || ['', '', '', ''])]);
                    row.alignment = {vertical:'top',wrapText:true}; row.height = card.picture ? 120 : 75;
                    if (card.picture) {
                        const image = new Image(); image.src = card.picture.src; await image.decode();
                        const canvas = document.createElement('canvas'); const ratio = Math.min(600 / image.naturalWidth, 400 / image.naturalHeight, 1);
                        canvas.width = Math.max(1,Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1,Math.round(image.naturalHeight * ratio));
                        const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0,canvas.width,canvas.height);
                        if (card.picture.target) {ctx.beginPath(); ctx.arc(card.picture.target.x * canvas.width,card.picture.target.y * canvas.height,10,0,Math.PI*2); ctx.strokeStyle='#d92323';ctx.lineWidth=3;ctx.stroke();}
                        const id = workbook.addImage({base64:canvas.toDataURL('image/png'),extension:'png'});
                        const scale = Math.min(155/canvas.width,145/canvas.height);
                        sheet.addImage(id,{tl:{col:3,row:row.number-1},ext:{width:canvas.width*scale,height:canvas.height*scale}});
                    }
                }
                sheet.views = [{state:'frozen',ySplit:1}]; sheet.autoFilter = {from:{row:1,column:1},to:{row:1,column:headers.length}};
                const buffer = await workbook.xlsx.writeBuffer();
                const url = URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
                const link=make('a');link.href=url;link.download=`${(deck.title || 'Knowledge Cards').replace(/[\\/:*?"<>|]/g,'').slice(0,80)}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
                status('share-status','Spreadsheet downloaded, including pictures and saved distractors.');
            } catch(error) {status('share-status',error.message,true);} finally {button.disabled=false;}
        }
        byId('download-spreadsheet').onclick = spreadsheet;

        function renderQuiz() {
            byId('quiz-prompt').replaceChildren(); byId('quiz-options').replaceChildren(); byId('quiz-information').hidden = true;
            byId('quiz-next').hidden = true; answered = false;
            if (!quiz.length) {status('quiz-status','This language does not yet have questions with four saved distractors.');return;}
            if (quizIndex >= quiz.length) {
                status('quiz-status',`Practice complete — ${score} of ${quiz.length} correct.`); byId('quiz-next').hidden=false;byId('quiz-next').textContent='Try Again';return;
            }
            const card = quiz[quizIndex];
            status('quiz-status',`Question ${quizIndex + 1} of ${quiz.length} · ${score} correct`);
            byId('quiz-prompt').append(renderQuestion(card));
            const choices = [card.answer,...card.distractors[byId('quiz-language').value]];
            for(let i=choices.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
            choices.forEach(value => {
                const button = make('button','',value);button.type='button';button.dir='auto';
                button.onclick=()=>{
                    if(answered)return;answered=true;const correct=value===card.answer;if(correct)score++;
                    byId('quiz-options').querySelectorAll('button').forEach(option=>{option.disabled=true;option.classList.toggle('correct-choice',option.textContent===card.answer);});
                    status('quiz-status',correct?'Correct!':`The correct answer is: ${card.answer}`);
                    byId('quiz-information').hidden=!card.additionalInformation.trim();byId('quiz-information-text').textContent=card.additionalInformation;
                    byId('quiz-next').textContent=quizIndex===quiz.length-1?'See Results':'Next Question';byId('quiz-next').hidden=false;
                }; byId('quiz-options').append(button);
            });
        }
        function startQuiz() {quiz=practiceCards(getDeck(),byId('quiz-language').value);quizIndex=0;score=0;renderQuiz();}
        byId('quiz-language').onchange=startQuiz;
        byId('quiz-next').onclick=()=>{if(quizIndex>=quiz.length)startQuiz();else{quizIndex++;renderQuiz();}};
        return {
            enter(stage) {
                if(stage==='practice')enterPractice();
                if(stage==='share' && !pagesLoaded)loadPages();
                if(stage==='quiz')startQuiz();
            },
            leave(stage) {return stage !== 'practice' || saveAnswers();},
            reset() {generation++;controller?.abort();busy=false;dirty=false;sourceKey='';rows=[];renderRows();for(const id of ['practice-status','share-status','publish-status'])status(id,'');},
            hasPractice() {return ['english','hebrew'].some(lang=>practiceCards(getDeck(),lang).length);}
        };
    }
    window.PeninaKnowledgeWorkflow = {mount};
})();

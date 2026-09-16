(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PeninaPracticeExercises = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const languages = { english: 'English', hebrew: 'Hebrew' };
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
        .replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
    const clean = value => typeof value === 'string' && value.trim().toUpperCase() !== 'N' ? value.trim() : '';

    function sourceRows(rows, language) {
        return rows.map((row, id) => {
            const term = clean(row.item?.hebrew) || clean(row.cleanHebrew);
            const english = clean(row.item?.english);
            const hebrew = clean(row.modernHebrewTranslation);
            const definition = (language === 'english' ? english : hebrew) || english || hebrew;
            const saved = row.alternativeAnswers?.[language];
            const answers = saved?.term === term && saved?.definition === definition
                && Array.isArray(saved.answers) && saved.answers.length === 4
                ? saved.answers.map(clean) : ['', '', '', ''];
            return { id, term, definition, answers };
        });
    }

    function validateAnswers(row, answers, language) {
        if (!Array.isArray(answers) || answers.length !== 4) throw new Error('Each term needs four alternate answers.');
        const seen = new Set();
        answers.forEach(answer => {
            if (typeof answer !== 'string' || !normalize(answer) || answer.length > 500) {
                throw new Error('Enter an alternate answer of 1–500 characters in every cell.');
            }
            const key = normalize(answer);
            if (key === normalize(row.definition) || key === normalize(row.term) || seen.has(key)) {
                throw new Error(`Use four different incorrect answers for “${row.term}”, distinct from the term and definition.`);
            }
            if (language === 'hebrew' ? !/[א-ת]/.test(answer) : (!/[a-z]/i.test(answer) || /[א-ת]/.test(answer))) {
                throw new Error(`Write every alternate answer in ${languages[language]}.`);
            }
            seen.add(key);
        });
    }

    // Validate the entire response before changing anything, including across client batches.
    function mergeGeneration(rows, requests, result, language) {
        if (!Array.isArray(result) || result.length !== requests.length) throw new Error('AI returned an incomplete set. Please try again.');
        const output = rows.map(row => ({ ...row, answers: row.answers.slice() }));
        const seen = new Set();
        result.forEach(item => {
            const request = item && requests.find(row => row.id === item.id);
            if (!request || seen.has(item.id) || !Array.isArray(item.cells) || item.cells.length !== request.slots.length) {
                throw new Error('AI returned unexpected cells. Please try again.');
            }
            seen.add(item.id);
            const row = output.find(row => row.id === item.id);
            const slots = new Set();
            item.cells.forEach(cell => {
                if (!cell || !request.slots.includes(cell.slot) || slots.has(cell.slot) || typeof cell.answer !== 'string') {
                    throw new Error('AI returned unexpected cells. Please try again.');
                }
                if (request.answers.some(answer => normalize(answer) && normalize(cell.answer) === normalize(answer))) {
                    throw new Error('AI repeated a selected answer. Please regenerate again.');
                }
                slots.add(cell.slot);
                row.answers[cell.slot] = cell.answer.trim();
            });
            // Unselected manual cells may still need work. Validate generated values without
            // rejecting or changing unrelated cells, while checking collisions against all cells.
            item.cells.forEach(({ answer }) => {
                if (!normalize(answer) || answer.length > 500 || normalize(answer) === normalize(row.definition)
                    || normalize(answer) === normalize(row.term)
                    || row.answers.filter(other => normalize(other) === normalize(answer)).length > 1
                    || (language === 'hebrew' ? !/[א-ת]/.test(answer) : (!/[a-z]/i.test(answer) || /[א-ת]/.test(answer)))) {
                    throw new Error('AI returned duplicate, correct, or wrong-language answers. Please try again.');
                }
            });
        });
        return output;
    }

    function createSession(source) {
        return {
            source, language: null, locked: false, rows: [], selected: new Set(),
            choose(language) {
                if (!Object.hasOwn(languages, language) || this.locked) return false;
                this.language = language;
                this.rows = sourceRows(this.source, language);
                this.selected.clear();
                return true;
            },
            edit(id, slot, value) {
                this.locked = true;
                this.rows.find(row => row.id === id).answers[slot] = value;
            },
            select(id, slot, checked) {
                this.locked = true;
                const key = `${id}:${slot}`;
                if (checked) this.selected.add(key); else this.selected.delete(key);
            },
            requests(emptyOnly = false) {
                return this.rows.map(row => ({ ...row, answers: row.answers.slice(), slots: [0, 1, 2, 3].filter(slot =>
                    emptyOnly ? !row.answers[slot].trim() : this.selected.has(`${row.id}:${slot}`)) }))
                    .filter(row => row.slots.length);
            },
            submit() {
                if (!this.language || !this.rows.length) throw new Error('Choose a language first.');
                this.rows.forEach(row => {
                    if (!row.term || !row.definition) throw new Error('Each term needs a correct definition in the vocabulary table first.');
                    validateAnswers(row, row.answers, this.language);
                });
                return this.rows.map(row => ({ version: 1, term: row.term, definition: row.definition,
                    answers: row.answers.map(answer => answer.trim()) }));
            }
        };
    }

    function mount({ button, getRows, onSubmit, document: doc = document, fetchImpl = (...args) => fetch(...args) }) {
        const dialog = doc.createElement('dialog');
        dialog.id = 'practice-exercises-dialog';
        dialog.setAttribute('aria-labelledby', 'practice-title');
        dialog.setAttribute('aria-describedby', 'practice-help');
        dialog.innerHTML = `
            <h2 id="practice-title">Create Additional Practice Exercises</h2>
            <p id="practice-help">Choose a language to generate alternative answers immediately. Review the answers, then Submit to save them. Use Submit or Cancel before choosing another language.</p>
            <div class="practice-choices" role="group" aria-label="Alternate answer language">
                <button type="button" data-language="english" aria-pressed="false">Generate Alternative English Answers</button>
                <button type="button" data-language="hebrew" aria-pressed="false">Generate Alternative Hebrew Answers</button>
            </div>
            <p id="practice-lock" role="status"></p>
            <form id="practice-form" hidden>
                <p>Review the correct definition and the four generated incorrect answers. You can edit any answer. The language button above fills any empty cells, including when retrying failed generation. Check individual cells to replace them with Regenerate. Review AI suggestions before submitting.</p>
                <div class="practice-table-scroll" role="region" aria-label="Alternate answers table; scroll horizontally for all four answers" tabindex="0">
                    <table dir="ltr"><caption id="practice-caption"></caption><thead><tr>
                        <th scope="col">Term</th><th scope="col">Definition</th>
                        <th scope="col">Alternate Answer 1</th><th scope="col">Alternate Answer 2</th>
                        <th scope="col">Alternate Answer 3</th><th scope="col">Alternate Answer 4</th>
                    </tr></thead><tbody></tbody></table>
                </div>
                <div class="practice-actions">
                    <button type="button" id="practice-regenerate">Regenerate</button>
                    <button type="submit" id="practice-submit">Submit</button>
                </div>
            </form>
            <p id="practice-status" role="status" aria-live="polite" aria-atomic="true"></p>
            <p id="practice-error" role="alert"></p>
            <button type="button" id="practice-cancel">Cancel</button>`;
        doc.body.appendChild(dialog);
        const find = selector => dialog.querySelector(selector);
        const form = find('form'), tbody = find('tbody');
        const choices = [...dialog.querySelectorAll('[data-language]')];
        let session, busy = false, controller, run = 0;
        const status = message => { find('#practice-status').textContent = message; };
        const error = message => { find('#practice-error').textContent = message; };
        function refresh() {
            choices.forEach(choice => {
                choice.disabled = busy || (session.locked && session.language !== choice.dataset.language);
                choice.setAttribute('aria-pressed', String(session.language === choice.dataset.language));
            });
            find('#practice-lock').textContent = session.locked
                ? `${languages[session.language]} is locked for this session. Submit to keep your answers or Cancel to discard changes.`
                : 'Language choice is unlocked.';
            form.hidden = !session.language;
            form.setAttribute('aria-busy', String(busy));
            form.querySelectorAll('input, textarea, button').forEach(control => { control.disabled = busy; });
        }
        function renderRows() {
            tbody.replaceChildren();
            find('#practice-caption').textContent = `${languages[session.language]} alternate answers — ${session.rows.length} terms`;
            session.rows.forEach(row => {
                const tr = doc.createElement('tr');
                [row.term, row.definition || 'Missing definition — Cancel and add a definition to the vocabulary table.'].forEach((text, index) => {
                    const cell = doc.createElement(index ? 'td' : 'th');
                    if (!index) cell.scope = 'row';
                    cell.dir = 'auto'; cell.textContent = text; tr.appendChild(cell);
                });
                row.answers.forEach((answer, slot) => {
                    const td = doc.createElement('td');
                    const label = doc.createElement('label');
                    const checkbox = doc.createElement('input');
                    checkbox.type = 'checkbox'; checkbox.checked = session.selected.has(`${row.id}:${slot}`);
                    checkbox.setAttribute('aria-label', `Regenerate alternate answer ${slot + 1} for ${row.term}, row ${row.id + 1}`);
                    checkbox.addEventListener('change', () => { session.select(row.id, slot, checkbox.checked); refresh(); });
                    label.append(checkbox, doc.createTextNode(' Regenerate this answer'));
                    const input = doc.createElement('textarea');
                    input.value = answer; input.rows = 3; input.maxLength = 500;
                    input.dir = session.language === 'hebrew' ? 'rtl' : 'ltr';
                    input.lang = session.language === 'hebrew' ? 'he' : 'en';
                    input.setAttribute('aria-label', `Alternate answer ${slot + 1} for ${row.term}, row ${row.id + 1}`);
                    input.addEventListener('input', () => { session.edit(row.id, slot, input.value); error(''); refresh(); });
                    td.append(label, input); tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }
        function cancel() {
            run++; controller?.abort(); busy = false;
            session = null; dialog.close(); button.focus();
        }
        async function generate(emptyOnly) {
            if (busy) return;
            error('');
            const requests = session.requests(emptyOnly);
            if (!requests.length) { status(emptyOnly ? 'All cells are filled.' : 'Check at least one alternate-answer cell to regenerate.'); return; }
            if (requests.some(row => !row.term || !row.definition)) {
                error('Cancel and add a correct definition for each term in the vocabulary table first.'); return;
            }
            session.locked = true; busy = true; controller = new AbortController();
            const requestController = controller;
            const signal = requestController.signal, currentRun = ++run;
            refresh();
            let timeout;
            try {
                const results = [];
                for (let offset = 0; offset < requests.length; offset += 8) {
                    status(`Generating ${languages[session.language]} answers for terms ${offset + 1}–${Math.min(offset + 8, requests.length)} of ${requests.length}…`);
                    timeout = setTimeout(() => requestController.abort(), 100000);
                    const response = await fetchImpl('/api/vocabulary-alternatives', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
                        body: JSON.stringify({ language: session.language, rows: requests.slice(offset, offset + 8) })
                    });
                    if (currentRun !== run) return;
                    const data = await response.json();
                    clearTimeout(timeout);
                    if (currentRun !== run) return;
                    if (!response.ok) throw new Error(data.error || 'Generation failed. Please try again.');
                    if (!Array.isArray(data.rows)) throw new Error('AI returned an incomplete set. Please try again.');
                    results.push(...data.rows);
                }
                session.rows = mergeGeneration(session.rows, requests, results, session.language);
                renderRows();
                status(`${requests.reduce((count, row) => count + row.slots.length, 0)} answers generated. Review and edit them, then Submit. Checked cells stay selected for another regeneration.`);
            } catch (err) {
                if (currentRun !== run) return;
                status('Your existing answers are unchanged.');
                error(err.name === 'AbortError' ? 'Generation timed out. Please try again.' : err.message);
            } finally {
                clearTimeout(timeout);
                if (currentRun === run) { busy = false; refresh(); }
            }
        }
        button.addEventListener('click', () => {
            session = createSession(getRows());
            if (!session.source.length) return;
            busy = false; error(''); status(''); tbody.replaceChildren(); refresh(); dialog.showModal(); choices[0].focus();
        });
        choices.forEach(choice => choice.addEventListener('click', () => {
            if (busy) return;
            if (session.language === choice.dataset.language || session.choose(choice.dataset.language)) {
                error(''); status(''); renderRows(); refresh(); return generate(true);
            }
        }));
        find('#practice-cancel').addEventListener('click', cancel);
        dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
        find('#practice-regenerate').addEventListener('click', () => generate(false));
        form.addEventListener('submit', event => {
            event.preventDefault(); if (busy) return;
            try { const saved = session.submit(); onSubmit(session.language, saved); cancel(); }
            catch (err) { error(err.message); }
        });
        return { dialog };
    }
    return { createSession, sourceRows, validateAnswers, mergeGeneration, mount };
});

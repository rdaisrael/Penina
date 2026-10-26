(function () {
    'use strict';

    const grade = document.body.dataset.grade || new URLSearchParams(window.location.search).get('page') || '';
    const status = document.getElementById('status');
    const setsElement = document.getElementById('sets');
    const search = document.getElementById('search');
    const combineCount = document.getElementById('combine-count');
    const viewCombinedButton = document.getElementById('view-combined');
    const downloadCombinedButton = document.getElementById('download-combined');
    const manageTrigger = document.getElementById('manage-trigger');
    const management = document.getElementById('management');
    const removeButton = document.getElementById('remove-sets');
    removeButton.textContent = 'Remove selected wordlists';
    const removalChoices = document.createElement('fieldset');
    removalChoices.className = 'teacher-choices';
    const teacherDialog = document.createElement('dialog');
    teacherDialog.className = 'input-dialog teacher-dialog';
    teacherDialog.setAttribute('aria-labelledby', 'teacher-tools-title');
    teacherDialog.innerHTML = '<div class="teacher-dialog-heading"><h2 id="teacher-tools-title">Teacher tools</h2><button type="button" class="combine-action" id="close-teacher-tools">Close</button></div>';
    document.body.appendChild(teacherDialog);
    teacherDialog.appendChild(management);
    const setChoices = document.createElement('fieldset');
    setChoices.className = 'teacher-choices';
    management.querySelector('span').remove();
    management.appendChild(setChoices);
    const gameChoices = document.createElement('fieldset');
    gameChoices.className = 'teacher-choices';
    const gameCatalog = [['quiz','Quick Quiz'],['lines','Connect the Words'],['cards','Match the Cards'],['asteroids','Vocabulary Asteroids'],['flappy','Flappy Vocab'],['chomp','Chomp & Charge'],['snowblaster','Snowblaster!']];
    gameChoices.innerHTML = '<legend>Included exercises and games</legend><p>Checked activities are included. Uncheck any activity to exclude it, then save.</p>' + gameCatalog.map(([id,name]) => `<label><input type="checkbox" value="${id}" class="game-remove-select"><span>${name}</span></label>`).join('');
    management.appendChild(gameChoices);
    const saveGames = document.createElement('button');
    saveGames.type = 'button'; saveGames.className = 'combine-action primary'; saveGames.textContent = 'Save exercises and games';
    management.appendChild(saveGames);
    const gameStatus = document.createElement('p'); gameStatus.setAttribute('role','status'); management.appendChild(gameStatus);
    let disabledGames = [], excludedWordlists = [];
    function renderTeacherChoices() {
        removalChoices.innerHTML = '<legend>Choose wordlists to remove from this webpage</legend>' + sets.map(set => `<label><input type="checkbox" class="delete-select" value="${escapeHtml(set.pathname)}"><span>${escapeHtml(set.title)}</span></label>`).join('');
        removeButton.disabled = !sets.length;
        setChoices.innerHTML = '<legend>Included wordlists</legend>' + sets.map(set => `<label><input type="checkbox" class="remove-select" value="${escapeHtml(set.pathname)}" ${excludedWordlists.includes(set.pathname) ? '' : 'checked'}><span>${escapeHtml(set.title)}</span></label>`).join('');
        gameChoices.querySelectorAll('input').forEach(input => { input.checked = !disabledGames.includes(input.value); });
        classGamify.hidden = !sets.some(set => set.hasGames) || disabledGames.length === gameCatalog.length;
    }
    saveGames.addEventListener('click', async () => {
        saveGames.disabled = true; gameStatus.textContent = 'Saving…';
        try {
            const selected = Array.from(gameChoices.querySelectorAll('input:not(:checked)'), input => input.value);
            const response = await fetch('/api/flashcard-sets', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({grade, action:'game-settings', disabledGames:selected}) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Game choices could not be saved.');
            disabledGames = data.disabledGames;
            classGamify.hidden = !sets.some(set => set.hasGames) || disabledGames.length === gameCatalog.length; gameStatus.textContent = 'Game choices saved. Students will see the updated menu when they open Gamify.';
        } catch(error) { gameStatus.textContent = error.message || 'Game choices could not be saved.'; }
        finally { saveGames.disabled = false; }
    });
    document.getElementById('close-teacher-tools').onclick = () => teacherDialog.close();
    teacherDialog.addEventListener('close', () => {
        managementMode = false; management.hidden = true; manageTrigger.hidden = false; gameStatus.textContent = ''; render();
    });
    manageTrigger.textContent = '●';
    manageTrigger.setAttribute('aria-label', 'Open teacher tools');
    const joinLive = document.createElement('a');
    joinLive.className = 'set-action live-join-action';
    joinLive.textContent = 'Join Live Game';
    joinLive.href = '/PeninaPlus-vocab-builder/flash-cards/live/';
    document.querySelector('.toolbar').before(joinLive);
    const startLive = document.createElement('button');
    startLive.type = 'button';startLive.className = 'combine-action primary';startLive.textContent = 'Start Live Game';
    startLive.addEventListener('click', openLiveSetup);management.prepend(startLive);
    const scoreEmailControls = document.createElement('div');
    scoreEmailControls.className = 'score-email-controls';
    scoreEmailControls.innerHTML = '<label class="score-email-choice"><input type="checkbox" id="send-scores-to-teacher"><span>Send scores to teacher</span></label><input type="email" id="teacher-score-email" placeholder="Enter teacher email" aria-label="Teacher email for scores" autocomplete="email" maxlength="254" disabled>';
    const adjustMusic = document.createElement('button');
    adjustMusic.type = 'button'; adjustMusic.className = 'combine-action'; adjustMusic.textContent = 'Adjust Lobby Music';
    const liveActions = document.createElement('div');
    liveActions.className = 'teacher-live-actions';
    adjustMusic.onclick = async () => {
        try {
        if (!window.PeninaMusic) await new Promise((resolve, reject) => { const script=document.createElement('script');script.src='/PeninaPlus-vocab-builder/flash-cards/live/music.js';script.onload=resolve;script.onerror=reject;document.head.append(script); });
        window.PeninaMusic.openSettings();
        } catch(error) { showMessage('Music settings', 'Music settings could not load. Please try again.'); }
    };
    liveActions.append(startLive, adjustMusic);
    const sendScoresToTeacher = scoreEmailControls.querySelector('#send-scores-to-teacher');
    const teacherScoreEmail = scoreEmailControls.querySelector('#teacher-score-email');
    sendScoresToTeacher.addEventListener('change', () => {
        teacherScoreEmail.disabled = !sendScoresToTeacher.checked;
        teacherScoreEmail.required = sendScoresToTeacher.checked;
        if (sendScoresToTeacher.checked) teacherScoreEmail.focus();
    });
    function teacherSection(id, title, controls) {
        const section = document.createElement('section');
        section.className = 'teacher-tool-section';
        section.setAttribute('aria-labelledby', id);
        const heading = document.createElement('h3');
        heading.id = id;
        heading.textContent = title;
        section.append(heading, ...controls);
        return section;
    }
    management.append(
        teacherSection('teacher-live-heading', 'Start Live Game', [setChoices, scoreEmailControls, liveActions]),
        teacherSection('teacher-wordlists-heading', 'Remove Wordlists', [removalChoices, removeButton]),
        teacherSection('teacher-games-heading', 'Student Exercises and Games', [gameChoices, saveGames, gameStatus])
    );
    const lockTools = document.createElement('button');lockTools.type = 'button';lockTools.className = 'combine-action';lockTools.textContent = 'Lock teacher tools';
    lockTools.onclick = () => teacherDialog.close();
    management.append(lockTools);
    const classGamify = document.createElement('a');
    classGamify.className = 'set-action gamify-action';
    classGamify.textContent = 'Gamify! — All class terms';
    classGamify.href = `/api/flashcard-sets?grade=${encodeURIComponent(grade)}&games=1#gamify`;
    classGamify.target = '_blank';
    classGamify.rel = 'noopener';
    classGamify.hidden = true;
    document.querySelector('.toolbar').before(classGamify);
    let sets = [];
    const selectedForCombination = new Set();
    let managementMode = false;

    const inputDialog = document.createElement('dialog');
    inputDialog.className = 'input-dialog';
    inputDialog.innerHTML = '<form class="input-dialog-form"><h2 id="input-dialog-title"></h2><p id="input-dialog-message"></p><label id="input-dialog-label"><span></span><input id="input-dialog-value"></label><div class="input-dialog-actions"><button id="input-dialog-cancel" class="input-dialog-button" type="button">Cancel</button><button id="input-dialog-confirm" class="input-dialog-button primary" type="submit">Continue</button></div></form>';
    document.body.appendChild(inputDialog);
    const inputDialogForm = inputDialog.querySelector('form');
    const inputDialogTitle = document.getElementById('input-dialog-title');
    const inputDialogMessage = document.getElementById('input-dialog-message');
    const inputDialogLabel = document.getElementById('input-dialog-label');
    const inputDialogLabelText = inputDialogLabel.querySelector('span');
    const inputDialogValue = document.getElementById('input-dialog-value');
    const inputDialogCancel = document.getElementById('input-dialog-cancel');
    const inputDialogConfirm = document.getElementById('input-dialog-confirm');
    let finishDialog = null;

    function closeInputDialog(value) {
        if (!finishDialog) return;
        const resolve = finishDialog;
        finishDialog = null;
        inputDialog.close();
        resolve(value);
    }

    function openInputDialog(options) {
        const settings = options || {};
        inputDialogTitle.textContent = settings.title || '';
        inputDialogMessage.textContent = settings.message || '';
        inputDialogMessage.hidden = !settings.message;
        inputDialogLabel.hidden = !settings.input;
        inputDialogLabelText.textContent = settings.label || '';
        inputDialogValue.type = settings.type || 'text';
        inputDialogValue.value = settings.defaultValue || '';
        inputDialogCancel.hidden = settings.cancel === false;
        inputDialogConfirm.textContent = settings.confirmText || 'Continue';
        inputDialogConfirm.className = `input-dialog-button ${settings.destructive ? 'destructive' : 'primary'}`;
        inputDialog.showModal();
        if (settings.input) {
            inputDialogValue.focus();
            inputDialogValue.select();
        } else {
            inputDialogConfirm.focus();
        }
        return new Promise(resolve => { finishDialog = resolve; });
    }

    inputDialogForm.addEventListener('submit', event => {
        event.preventDefault();
        closeInputDialog(inputDialogLabel.hidden ? true : inputDialogValue.value);
    });
    inputDialogCancel.addEventListener('click', () => closeInputDialog(null));
    inputDialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeInputDialog(null);
    });

    function showMessage(title, message) {
        return openInputDialog({ title, message, cancel: false, confirmText: 'OK' });
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function render() {
        const query = search.value.trim().toLowerCase();
        const visible = sets.filter(set => set.title.toLowerCase().includes(query));
        status.hidden = true;
        setsElement.innerHTML = visible.map(set => {
            const date = new Date(set.publishedAt);
            const readableDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            const combineChecked = selectedForCombination.has(set.pathname) ? ' checked' : '';
            const combineCheckbox = `<input class="combine-select" type="checkbox" value="${escapeHtml(set.pathname)}"${combineChecked} aria-label="Include ${escapeHtml(set.title)} in a combined set">`;
            const removeCheckbox = '';
            return `<article class="set"><div class="set-heading">${combineCheckbox}${removeCheckbox}<h2>${escapeHtml(set.title)}</h2></div><time>${escapeHtml(readableDate)}</time>
                <div class="set-actions">
                    <section class="set-action-group" aria-label="Flashcards">
                        <h3>Flashcards</h3>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.url)}" aria-label="View Flashcards">View</a>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.downloadUrl || set.url)}" download aria-label="Download Flashcards">Download</a>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.printUrl || set.url + '#print')}" aria-label="Print Flashcards">Print</a>
                    </section>
                    ${set.sheetUrl ? `<section class="set-action-group" aria-label="Sheets">
                        <h3>Sheets</h3>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.sheetUrl)}" aria-label="View Sheets">View</a>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.sheetDownloadUrl)}" aria-label="Download Sheets (PDF)">Download PDF</a>
                        <a class="set-action" target="_blank" rel="noopener" href="${escapeHtml(set.sheetPrintUrl)}" aria-label="Print Sheets">Print</a>
                    </section>` : ''}
                </div></article>`;
        }).join('');
        if (!visible.length) {
            status.textContent = query ? 'No vocabulary sets match that search.' : 'No vocabulary sets have been published yet.';
            status.hidden = false;
        }
        updateCombineControls();
        renderTeacherChoices();
    }

    async function load() {
        try {
            const response = await fetch(`/api/flashcard-sets?grade=${encodeURIComponent(grade)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load vocabulary sets.');
            if (data.page) {
                document.title = data.page.name;
                document.querySelector('h1').textContent = data.page.name;
            }
            sets = Array.isArray(data.sets) ? data.sets : [];
            disabledGames = data.disabledGames || [];
            excludedWordlists = data.excludedWordlists || [];
            classGamify.hidden = !sets.some(set => set.hasGames);
            render();
        } catch (error) {
            status.textContent = error && error.message ? error.message : 'Unable to load vocabulary sets.';
        }
    }

    function selectedPathnames() {
        return Array.from(document.querySelectorAll('.remove-select:checked')).map(checkbox => checkbox.value);
    }

    function updateCombineControls() {
        const count = selectedForCombination.size;
        combineCount.textContent = `${count} set${count === 1 ? '' : 's'} selected`;
        viewCombinedButton.disabled = count === 0;
        downloadCombinedButton.disabled = count === 0;
    }

    function selectedSets() {
        return sets.filter(set => selectedForCombination.has(set.pathname));
    }

    function cardsFromHtml(html) {
        const documentCopy = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const cardData = documentCopy.getElementById('peninaCardData');
        if (cardData) return JSON.parse(cardData.textContent || '[]');
        const legacyMatch = String(html || '').match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
        if (!legacyMatch) throw new Error('One selected set is not a compatible Penina flashcard file.');
        return JSON.parse(legacyMatch[1]);
    }

    async function buildCombinedSet() {
        const chosen = selectedSets();
        if (!chosen.length) throw new Error('Select at least one flashcard set to combine.');
        const cardGroups = await Promise.all(chosen.map(async set => {
            const response = await fetch(set.url);
            if (!response.ok) throw new Error(`Unable to load “${set.title}.”`);
            return cardsFromHtml(await response.text());
        }));
        const cards = cardGroups.flat().map((card, index) => ({ ...card, n: index + 1 }));
        const defaultTitle = chosen.map(set => set.title).join(' + ');
        const title = await openInputDialog({
            title: 'Combine flashcard sets',
            message: 'This combined set is temporary and will not be added to this page.',
            label: 'Name the combined set',
            input: true,
            defaultValue: defaultTitle,
            confirmText: 'Continue'
        });
        if (title === null) return null;
        return { title: title.trim() || defaultTitle, html: PeninaOfflineStudyCards.makeApp(title.trim() || defaultTitle, cards, { hideGames: true, homeUrl: window.location.href, leaderboardUrl: new URL('/api/game-scores?game=asteroids&grade='+encodeURIComponent(grade),window.location.href).href }) };
    }

    async function withCombinedSet(button, action) {
        const originalText = button.textContent;
        viewCombinedButton.disabled = true;
        downloadCombinedButton.disabled = true;
        button.textContent = 'Combining...';
        try {
            const combined = await buildCombinedSet();
            if (combined) action(combined);
        } catch (error) {
            await showMessage('Unable to combine sets', error && error.message ? error.message : 'The selected sets could not be combined.');
        } finally {
            button.textContent = originalText;
            updateCombineControls();
        }
    }

    function viewCombinedSet() {
        withCombinedSet(viewCombinedButton, combined => {
            const url = URL.createObjectURL(new Blob([combined.html], { type: 'text/html;charset=utf-8' }));
            window.location.assign(url);
        });
    }

    function downloadCombinedSet() {
        withCombinedSet(downloadCombinedButton, combined => {
            const url = URL.createObjectURL(new Blob([combined.html], { type: 'text/html;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${combined.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Combined Vocabulary'} - Flashcards.html`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        });
    }

    async function openLiveSetup() {
        if (sendScoresToTeacher.checked && !teacherScoreEmail.reportValidity()) return;
        const scoreEmail = sendScoresToTeacher.checked ? teacherScoreEmail.value.trim() : '';
        const selected = new Set(selectedPathnames());
        const eligible = sets.filter(set => set.hasGames && selected.has(set.pathname));
        if (!selected.size) { await showMessage('Choose wordlists', 'Check at least one wordlist to include.'); return; }
        if (!eligible.length) { await showMessage('No game-ready sets', 'Choose a wordlist with teacher-approved answer choices first.'); return; }
        const pathnames = eligible.map(set => set.pathname);
        const dialog = document.createElement('dialog');
        dialog.className = 'input-dialog live-setup';
        dialog.innerHTML = `<form class="input-dialog-form"><h2>Start Live Game</h2><p>Students join with a game code.</p><div class="live-wordlist-summary"><h3>Included wordlists</h3><ul>${eligible.map(set => `<li>${escapeHtml(set.title)}</li>`).join('')}</ul><p>These wordlists are selected for this game. To change them, cancel and return to Start Live Game.</p></div><label>Answer language<select name="language"><option value="english">English</option><option value="hebrew">Hebrew</option></select></label><label>Questions<select name="count"><option>5</option><option selected>10</option><option>15</option><option>20</option></select></label><label>Question pacing<select name="seconds"><option value="0">Manual — teacher advances</option><option value="5">5 seconds</option><option value="7">7 seconds</option><option value="10" selected>10 seconds</option></select></label><label>Show correct answer for<select name="revealSeconds"><option value="5" selected>5 seconds</option><option value="7">7 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option></select></label><p>Students see right/wrong feedback when the answer is revealed.</p><p>100 points per correct answer.</p><p class="live-setup-error" role="alert"></p><div class="input-dialog-actions"><button type="button" class="input-dialog-button" data-cancel>Cancel</button><button type="submit" class="input-dialog-button primary">Open lobby →</button></div></form>`;
        document.body.appendChild(dialog);dialog.showModal();
        let creating = false;
        dialog.addEventListener('cancel', event => { if (creating) event.preventDefault(); });
        dialog.addEventListener('close', () => dialog.remove());
        dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
        dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault();if (creating) return;
            const form = event.currentTarget;
            const note = form.querySelector('.live-setup-error');
            if (!pathnames.length) { note.textContent = 'Choose at least one vocabulary set.'; return; }
            creating = true;note.textContent = 'Opening the lobby…';form.querySelectorAll('button').forEach(button => { button.disabled = true; });
            try {
                const response = await fetch('/api/game-scores?game=live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', grade, pathnames, language: form.elements.language.value, count: Number(form.elements.count.value), seconds: Number(form.elements.seconds.value), revealSeconds: Number(form.elements.revealSeconds.value), sendScoresToTeacher: !!scoreEmail, teacherEmail: scoreEmail, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
                const data = await response.json();if (!response.ok) throw new Error(data.error || 'Unable to open a lobby.');
                sessionStorage.setItem('penina-live-host-' + data.code, data.hostToken);
                window.location.assign('/PeninaPlus-vocab-builder/flash-cards/live/?host=1&code=' + data.code);
            } catch (error) { note.textContent = error.message;creating = false;form.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
        };
    }

    async function enterManagementMode() {
        if (manageTrigger.disabled) return;
        manageTrigger.disabled = true;
        try {
            const response = await fetch('/api/flashcard-sets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grade, action: 'authenticate' })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Sign in with the teacher account that owns this webpage.');
            disabledGames = data.disabledGames || [];
            excludedWordlists = data.excludedWordlists || [];

            managementMode = true;
            selectedForCombination.clear();
            manageTrigger.hidden = true;
            management.hidden = false;
            render();
            teacherDialog.showModal();
        } catch (error) {
            await showMessage('Unable to unlock teacher tools', error && error.message ? error.message : 'Sign in with the teacher account that owns this webpage.');
        } finally {
            manageTrigger.disabled = false;
        }
    }

    async function removeSelectedSets() {
        const selected = new Set(Array.from(removalChoices.querySelectorAll('input:checked'), input => input.value));
        const chosen = sets.filter(set => selected.has(set.pathname));
        if (!chosen.length) {
            await showMessage('Nothing selected', 'Choose at least one wordlist in Remove Wordlists.');
            return;
        }
        const confirmed = await openInputDialog({
            title: 'Remove selected wordlists?',
            message: `Remove these wordlists from this webpage: ${chosen.map(set => set.title).join(', ')}? This permanently deletes their published copies and cannot be undone.`,
            confirmText: 'Remove', destructive: true
        });
        if (!confirmed) return;
        removeButton.disabled = true;
        removeButton.textContent = 'Removing…';
        try {
            const response = await fetch('/api/flashcard-sets', {
                method: 'DELETE', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({grade, pathnames: chosen.map(set => set.pathname)})
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'The selected wordlists could not be removed.');
            const removed = new Set(data.removed || []);
            sets = sets.filter(set => !removed.has(set.pathname));
            removed.forEach(pathname => selectedForCombination.delete(pathname));
            render();
        } catch (error) {
            await showMessage('Unable to remove wordlists', error.message || 'Please try again.');
        } finally {
            removeButton.disabled = !sets.length;
            removeButton.textContent = 'Remove selected wordlists';
        }
    }
    removeButton.addEventListener('click', removeSelectedSets);

    search.addEventListener('input', render);
    setsElement.addEventListener('change', event => {
        if (!event.target.classList.contains('combine-select')) return;
        event.target.checked ? selectedForCombination.add(event.target.value) : selectedForCombination.delete(event.target.value);
        updateCombineControls();
    });
    viewCombinedButton.addEventListener('click', viewCombinedSet);
    downloadCombinedButton.addEventListener('click', downloadCombinedSet);
    manageTrigger.addEventListener('click', enterManagementMode);
    load();
})();

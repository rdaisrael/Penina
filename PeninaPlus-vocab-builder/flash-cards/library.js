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
    const lockTools = document.createElement('button');lockTools.type = 'button';lockTools.className = 'combine-action';lockTools.textContent = 'Lock teacher tools';
    lockTools.onclick = () => { managementMode = false;managementPassword = '';management.hidden = true;manageTrigger.hidden = false;render(); };
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
    let managementPassword = '';

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
            const combineCheckbox = managementMode ? '' : `<input class="combine-select" type="checkbox" value="${escapeHtml(set.pathname)}"${combineChecked} aria-label="Include ${escapeHtml(set.title)} in a combined set">`;
            const removeCheckbox = managementMode ? `<input class="remove-select" type="checkbox" value="${escapeHtml(set.pathname)}" aria-label="Select ${escapeHtml(set.title)} for removal">` : '';
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
        const eligible = sets.filter(set => set.hasGames);
        if (!eligible.length) { await showMessage('No game-ready sets', 'Publish a set with teacher-approved answer choices first.'); return; }
        const selected = new Set(selectedPathnames());
        const dialog = document.createElement('dialog');
        dialog.className = 'input-dialog live-setup';
        dialog.innerHTML = `<form class="input-dialog-form"><h2>Start Live Game</h2><p>Students join with a game code. You reveal each answer and control the pace.</p><fieldset><legend>Vocabulary sets</legend>${eligible.map(set => `<label class="live-set"><input type="checkbox" name="sets" value="${escapeHtml(set.pathname)}" ${!selected.size || selected.has(set.pathname) ? 'checked' : ''}><span>${escapeHtml(set.title)}</span></label>`).join('')}</fieldset><label>Answer language<select name="language"><option value="english">English</option><option value="hebrew">Hebrew</option></select></label><label>Questions<select name="count"><option>5</option><option selected>10</option><option>15</option><option>20</option></select></label><label>Question pacing<select name="seconds"><option value="0">Manual — teacher advances</option><option value="5">5 seconds</option><option value="7">7 seconds</option><option value="10">10 seconds</option></select></label><p>Timed games reveal the answer for 2 seconds, then advance automatically.</p><p>100 points per correct answer. Fewer questions are used if the selected sets have fewer approved terms.</p><p class="live-setup-error" role="alert"></p><div class="input-dialog-actions"><button type="button" class="input-dialog-button" data-cancel>Cancel</button><button type="submit" class="input-dialog-button primary">Open lobby →</button></div></form>`;
        document.body.appendChild(dialog);dialog.showModal();
        let creating = false;
        dialog.addEventListener('cancel', event => { if (creating) event.preventDefault(); });
        dialog.addEventListener('close', () => dialog.remove());
        dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
        dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault();if (creating) return;
            const form = event.currentTarget, pathnames = [...form.querySelectorAll('input[name="sets"]:checked')].map(input => input.value);
            const note = form.querySelector('.live-setup-error');
            if (!pathnames.length) { note.textContent = 'Choose at least one vocabulary set.'; return; }
            creating = true;note.textContent = 'Opening the lobby…';form.querySelectorAll('button').forEach(button => { button.disabled = true; });
            try {
                const response = await fetch('/api/game-scores?game=live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', grade, password: managementPassword, pathnames, language: form.elements.language.value, count: Number(form.elements.count.value), seconds: Number(form.elements.seconds.value) }) });
                const data = await response.json();if (!response.ok) throw new Error(data.error || 'Unable to open a lobby.');
                sessionStorage.setItem('penina-live-host-' + data.code, data.hostToken);
                window.location.assign('/PeninaPlus-vocab-builder/flash-cards/live/?host=1&code=' + data.code);
            } catch (error) { note.textContent = error.message;creating = false;form.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
        };
    }

    async function enterManagementMode() {
        const password = await openInputDialog({
            title: 'Teacher tools',
            label: 'Class editing code',
            input: true,
            type: 'password',
            confirmText: 'Unlock'
        });
        if (!password) return;
        manageTrigger.disabled = true;
        try {
            const response = await fetch('/api/flashcard-sets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grade, action: 'authenticate', password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'The password could not be verified.');
            managementPassword = password;
            managementMode = true;
            selectedForCombination.clear();
            manageTrigger.hidden = true;
            management.hidden = false;
            render();
        } catch (error) {
            await showMessage('Unable to unlock teacher tools', error && error.message ? error.message : 'The password could not be verified.');
        } finally {
            manageTrigger.disabled = false;
        }
    }

    async function removeSelectedSets() {
        const pathnames = selectedPathnames();
        if (!pathnames.length) {
            await showMessage('Nothing selected', 'Select at least one flashcard set to remove.');
            return;
        }
        const confirmed = await openInputDialog({
            title: 'Remove selected sets?',
            message: `Remove ${pathnames.length} selected flashcard set${pathnames.length === 1 ? '' : 's'}? This cannot be undone.`,
            confirmText: 'Remove',
            destructive: true
        });
        if (!confirmed) return;

        removeButton.disabled = true;
        removeButton.textContent = 'Removing...';
        try {
            const response = await fetch('/api/flashcard-sets', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grade, pathnames, password: managementPassword })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'The selected sets could not be removed.');
            const removed = new Set(data.removed || pathnames);
            sets = sets.filter(set => !removed.has(set.pathname));
            removed.forEach(pathname => selectedForCombination.delete(pathname));
            render();
        } catch (error) {
            await showMessage('Unable to remove sets', error && error.message ? error.message : 'The selected sets could not be removed.');
        } finally {
            removeButton.disabled = false;
            removeButton.textContent = 'Remove';
        }
    }

    search.addEventListener('input', render);
    setsElement.addEventListener('change', event => {
        if (!event.target.classList.contains('combine-select')) return;
        event.target.checked ? selectedForCombination.add(event.target.value) : selectedForCombination.delete(event.target.value);
        updateCombineControls();
    });
    viewCombinedButton.addEventListener('click', viewCombinedSet);
    downloadCombinedButton.addEventListener('click', downloadCombinedSet);
    manageTrigger.addEventListener('click', enterManagementMode);
    removeButton.addEventListener('click', removeSelectedSets);
    load();
})();

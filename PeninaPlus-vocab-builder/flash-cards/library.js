(function () {
    'use strict';

    const grade = document.body.dataset.grade;
    const status = document.getElementById('status');
    const setsElement = document.getElementById('sets');
    const search = document.getElementById('search');
    const combineCount = document.getElementById('combine-count');
    const viewCombinedButton = document.getElementById('view-combined');
    const downloadCombinedButton = document.getElementById('download-combined');
    const manageTrigger = document.getElementById('manage-trigger');
    const management = document.getElementById('management');
    const removeButton = document.getElementById('remove-sets');
    manageTrigger.textContent = '⚙';
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
            return `<article class="set"><div class="set-heading">${combineCheckbox}${removeCheckbox}<h2>${escapeHtml(set.title)}</h2></div><time>${escapeHtml(readableDate)}</time><div class="set-actions"><a class="set-action primary" href="${escapeHtml(set.url)}">View Notecards</a><a class="set-action" href="${escapeHtml(set.downloadUrl || set.url)}" download>Download Notecards</a></div></article>`;
        }).join('');
        if (!visible.length) {
            status.textContent = query ? 'No vocabulary sets match that search.' : 'No vocabulary sets have been published yet.';
            status.hidden = false;
        }
        updateCombineControls();
    }

    async function load() {
        try {
            const response = await fetch(`/api/notecard-sets?grade=${encodeURIComponent(grade)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load vocabulary sets.');
            sets = Array.isArray(data.sets) ? data.sets : [];
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
        if (!legacyMatch) throw new Error('One selected set is not a compatible Penina notecard file.');
        return JSON.parse(legacyMatch[1]);
    }

    async function buildCombinedSet() {
        const chosen = selectedSets();
        if (!chosen.length) throw new Error('Select at least one notecard set to combine.');
        const cardGroups = await Promise.all(chosen.map(async set => {
            const response = await fetch(set.url);
            if (!response.ok) throw new Error(`Unable to load “${set.title}.”`);
            return cardsFromHtml(await response.text());
        }));
        const cards = cardGroups.flat().map((card, index) => ({ ...card, n: index + 1 }));
        const defaultTitle = chosen.map(set => set.title).join(' + ');
        const title = await openInputDialog({
            title: 'Combine notecard sets',
            message: 'This combined set is temporary and will not be added to this page.',
            label: 'Name the combined set',
            input: true,
            defaultValue: defaultTitle,
            confirmText: 'Continue'
        });
        if (title === null) return null;
        return { title: title.trim() || defaultTitle, html: PeninaOfflineStudyCards.makeApp(title.trim() || defaultTitle, cards) };
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
            link.download = `${combined.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Combined Vocabulary'} - Notecards.html`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        });
    }

    async function enterManagementMode() {
        const password = await openInputDialog({
            title: 'Manage notecard sets',
            label: 'Publishing password',
            input: true,
            type: 'password',
            confirmText: 'Unlock'
        });
        if (!password) return;
        manageTrigger.disabled = true;
        try {
            const response = await fetch('/api/notecard-sets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Penina-Publish-Key': password },
                body: JSON.stringify({ grade, action: 'authenticate' })
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
            await showMessage('Unable to unlock management', error && error.message ? error.message : 'The password could not be verified.');
        } finally {
            manageTrigger.disabled = false;
        }
    }

    async function removeSelectedSets() {
        const pathnames = selectedPathnames();
        if (!pathnames.length) {
            await showMessage('Nothing selected', 'Select at least one notecard set to remove.');
            return;
        }
        const confirmed = await openInputDialog({
            title: 'Remove selected sets?',
            message: `Remove ${pathnames.length} selected notecard set${pathnames.length === 1 ? '' : 's'}? This cannot be undone.`,
            confirmText: 'Remove',
            destructive: true
        });
        if (!confirmed) return;

        removeButton.disabled = true;
        removeButton.textContent = 'Removing...';
        try {
            const response = await fetch('/api/notecard-sets', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-Penina-Publish-Key': managementPassword },
                body: JSON.stringify({ grade, pathnames })
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

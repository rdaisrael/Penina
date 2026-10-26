(() => {
    const body = document.body;
    const exportButton = document.getElementById('export-vocabulary-workbook-btn');
    const generateButton = document.getElementById('generate-btn');
    const table = document.getElementById('vocab-tbody');
    const guidance = document.getElementById('workflow-guidance');
    const status = document.getElementById('workflow-generation-status');
    const buttons = [...document.querySelectorAll('[data-go-stage]')];
    let ready = false;

    function showStage(stage, focus = true) {
        if (stage !== 'add' && !ready) return;
        body.dataset.workflowStage = stage;
        document.dispatchEvent?.(new CustomEvent('vocabulary-stage-changed', { detail: { stage } }));
        buttons.forEach(button => {
            if (button.closest('.workflow-nav') && button.dataset.goStage === stage) {
                button.setAttribute('aria-current', 'step');
            } else {
                button.removeAttribute('aria-current');
            }
        });
        if (focus) {
            const heading = document.getElementById(`${stage}-stage-title`);
            heading.focus({ preventScroll: true });
            document.querySelector('.workflow-nav').scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    function sync() {
        const wasReady = ready;
        ready = !exportButton.disabled;
        buttons.forEach(button => { button.disabled = button.dataset.goStage !== 'add' && !ready; });
        guidance.textContent = ready
            ? 'Move between steps at any time. Your edits and settings stay with this list.'
            : 'Start by uploading your words. Review, Practice Activities, and Share will become available when your list is ready.';
        if (ready && !wasReady) showStage('review');
        else if (!ready && body.dataset.workflowStage !== 'add') showStage('add');
        const generating = generateButton.textContent.includes('Generating');
        const error = !ready && table.textContent.trim().startsWith('Error:') ? table.textContent.trim() : '';
        status.textContent = generating ? 'Preparing your vocabulary list… Review will open when it is ready.' : error;
        status.style.color = error ? '#8a2525' : '';
    }

    document.addEventListener('vocabulary-draft-restored', () => {
        sync();
        // A replacement draft can be ready while the previous list was also ready.
        // Always open its saved rows, without requiring a readiness transition.
        showStage(ready ? 'review' : 'add');
    });

    buttons.forEach(button => button.addEventListener('click', () => showStage(button.dataset.goStage)));
    // Existing import, reset, and generation paths already update export availability.
    // Observe that shared state so navigation follows all of those paths.
    const observer = new MutationObserver(sync);
    observer.observe(exportButton, { attributes: true, attributeFilter: ['disabled'] });
    observer.observe(generateButton, { childList: true, characterData: true, subtree: true });
    observer.observe(table, { childList: true, characterData: true, subtree: true });
    sync();
})();

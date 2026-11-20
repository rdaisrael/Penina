'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const panel = $('page-code-panel'), select = $('code-page'), status = $('code-status');
    let revision = null, requestNumber = 0;
    function clearCode() {
        revision = null;
        $('class-access-code').textContent = '';
        $('code-controls').hidden = true;
    }
    function display(result) {
        revision = result.version;
        $('class-access-code').textContent = result.code || '';
        $('code-display').hidden = !result.code;
        $('code-create').hidden = !!result.code;
        $('code-revoke').hidden = $('code-replace').hidden = !result.code;
        $('code-controls').hidden = false;
        status.textContent = result.code ? '' : 'No active code for this page.';
    }
    async function request(operation, pageId, version) {
        const response = await fetch('/api/vocabulary-pages', {method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'page-access', operation, pageId, version})});
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Page access codes could not be loaded.');
        return result;
    }
    async function loadPages() {
        const current = ++requestNumber;
        clearCode();
        select.replaceChildren(new Option('Choose a class page', ''));
        status.textContent = 'Loading pages…';
        try {
            const {pages} = await request('list');
            if (current !== requestNumber) return;
            for (const page of pages) select.add(new Option(page.name, page.id));
            status.textContent = pages.length ? '' : 'There are no class pages yet.';
        } catch (error) { if (current === requestNumber) status.textContent = error.message; }
    }
    async function change(operation) {
        const pageId = select.value, expected = revision;
        if (['replace','revoke'].includes(operation) && !window.confirm((operation === 'replace' ? 'Replace' : 'Revoke') + ' the code for ' + select.selectedOptions[0].text + '? Anyone using it will lose access.')) return;
        const current = ++requestNumber;
        clearCode();
        status.textContent = '';
        if (!pageId) return;
        status.textContent = operation === 'show' ? 'Checking code…' : 'Saving…';
        try {
            const result = await request(operation, pageId, expected);
            if (current !== requestNumber) return;
            display(result);
            if (operation === 'revoke') status.textContent = 'Code revoked.';
        } catch (error) { if (current === requestNumber) status.textContent = error.message; }
    }
    function reset() {
        ++requestNumber;
        clearCode();
        select.replaceChildren(new Option('Choose a class page', ''));
        status.textContent = '';
    }
    window.PeninaPageCodes = {
        show() { panel.hidden = false; },
        hide() { panel.hidden = true; panel.open = false; reset(); }
    };
    panel.ontoggle = () => { if (panel.open && !panel.hidden) loadPages(); else reset(); };
    $('code-copy').onclick = async () => {
        const current = requestNumber;
        const code = $('class-access-code').textContent;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            if (current === requestNumber) status.textContent = 'Code copied.';
        } catch (_) {
            if (current === requestNumber) status.textContent = 'Select the code and copy it.';
        }
    };
    $('code-refresh').onclick = loadPages;
    select.onchange = () => change('show');
    for (const operation of ['create','replace','revoke']) $('code-' + operation).onclick = () => change(operation);
})();

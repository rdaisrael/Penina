(function () {
    'use strict';
    const dropdown = document.getElementById('publish-card-grade');
    const form = document.getElementById('add-webpage-form');
    const nameInput = document.getElementById('new-page-name');
    const createButton = document.getElementById('create-webpage-btn');
    const status = document.getElementById('vocabulary-pages-status');
    const retryButton = document.getElementById('retry-vocabulary-pages');

    const pageLinks = document.getElementById('published-page-links');
    const selectedLink = document.getElementById('selected-page-link');
    function updateLinks() {
        const selectedPageId = dropdown.value;
        const sortedOptions = Array.from(dropdown.options).sort((a, b) =>
            a.textContent.localeCompare(b.textContent, undefined, { sensitivity: 'base', numeric: true })
        );
        sortedOptions.forEach(option => dropdown.appendChild(option));
        dropdown.value = selectedPageId;
        pageLinks.replaceChildren();
        Array.from(dropdown.options).forEach(option => {
            if (!option.dataset.url) return;
            const link = document.createElement('a');
            link.href = option.dataset.url; link.textContent = option.textContent;
            link.target = '_blank'; link.rel = 'noopener';
            pageLinks.appendChild(link);
        });
        const selected = dropdown.options[dropdown.selectedIndex];
        selectedLink.href = selected?.dataset.url || '#';
        selectedLink.textContent = selected ? 'Open '+selected.textContent+' ↗' : '';
        selectedLink.hidden = !selected?.dataset.url;
    }
    updateLinks();

    function showStatus(message, error = false, url = null) {
        status.textContent = message;
        status.style.color = error ? '#721c24' : '#285b2a';
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank'; link.rel = 'noopener';
            link.textContent = ' Open webpage →';
            status.appendChild(link);
        }
    }

    function addOption(page) {
        let option = Array.from(dropdown.options).find(item => item.value === page.id);
        if (!option) {
            option = document.createElement('option');
            option.value = page.id;
            dropdown.appendChild(option);
        }
        option.textContent = page.name;
        option.dataset.url = page.url;
    }

    async function loadPages() {
        retryButton.hidden = true;
        try {
            const response = await fetch('/api/vocabulary-pages', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load webpages.');
            const selected = dropdown.value;
            dropdown.replaceChildren();
            data.pages.forEach(addOption);
            if (data.pages.some(page => page.id === selected)) dropdown.value = selected;
            updateLinks();
            showStatus(data.pages.length ? '' : 'No webpages are assigned to your teacher number yet.');
        } catch (error) {
            dropdown.replaceChildren(); updateLinks();
            showStatus(error.message || 'Saved webpages could not be loaded.', true);
            retryButton.hidden = false;
        }
    }

    document.getElementById('claim-webpage-form').addEventListener('submit', async event => {
        event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
        try {
            const url=new URL(document.getElementById('claim-page-url').value);
            const pageId=url.searchParams.get('page') || url.pathname.match(/\/(sixth|seventh|eighth)-grade\//)?.[1];
            if(!pageId)throw Error('Enter a vocabulary webpage link.');
            const response=await fetch('/api/vocabulary-pages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim',pageId,password:document.getElementById('claim-page-password').value})});
            const data=await response.json();if(!response.ok)throw Error(data.error);
            event.target.reset();await loadPages();showStatus('The webpage is now in your list.');
        }catch(error){showStatus(error.message,true);}finally{button.disabled=false;}
    });
    let loadingPages = loadPages();
    retryButton.addEventListener('click', () => { loadingPages = loadPages(); });
    dropdown.addEventListener('change', updateLinks);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (createButton.disabled) return;
        const name = nameInput.value.trim();
        if (!name) { showStatus('Enter a page name.', true); nameInput.focus(); return; }
        createButton.disabled = true;
        createButton.textContent = 'Creating…';
        try {
            await loadingPages;
            const normalizePageName = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
            const duplicate = Array.from(dropdown.options).some(option =>
                normalizePageName(option.textContent) === normalizePageName(name)
            );
            if (duplicate) {
                showStatus('A page with that name already exists. Choose another name.', true);
                nameInput.focus();
                return;
            }
            showStatus('Creating your webpage…');
            const response = await fetch('/api/vocabulary-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'The webpage could not be created.');
            }
            addOption(data.page);
            dropdown.value = data.page.id;
            updateLinks();
            form.reset();
            document.getElementById('add-webpage').open = false;
            showStatus(`“${data.page.name}” was created and selected. It belongs to your signed-in teacher account.`, false, data.page.url);
            dropdown.focus();
        } catch (error) {
            showStatus(error.message || 'The webpage could not be created. Please try again.', true);
        } finally {
            createButton.disabled = false;
            createButton.textContent = 'Create webpage';
        }
    });
})();

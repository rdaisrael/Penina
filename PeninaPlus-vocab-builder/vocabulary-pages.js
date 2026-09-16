(function () {
    'use strict';
    const dropdown = document.getElementById('publish-card-grade');
    const publishPassword = document.getElementById('publish-card-password');
    const form = document.getElementById('add-webpage-form');
    const creationPasswordInput = document.getElementById('page-creation-password');
    const nameInput = document.getElementById('new-page-name');
    const passwordInput = document.getElementById('new-page-password');
    const createButton = document.getElementById('create-webpage-btn');
    const status = document.getElementById('vocabulary-pages-status');
    const retryButton = document.getElementById('retry-vocabulary-pages');

    const pageLinks = document.getElementById('published-page-links');
    const selectedLink = document.getElementById('selected-page-link');
    function updateLinks() {
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
            data.pages.forEach(addOption);
            updateLinks();
            showStatus('');
        } catch (_error) {
            showStatus('Saved webpages could not be loaded. Retry to see all publishing destinations.', true);
            retryButton.hidden = false;
        }
    }

    let loadingPages = loadPages();
    retryButton.addEventListener('click', () => { loadingPages = loadPages(); });
    dropdown.addEventListener('change', () => { publishPassword.value = ''; updateLinks(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (createButton.disabled) return;
        const creationPassword = creationPasswordInput.value;
        if (!creationPassword) {
            showStatus('Enter the webpage creation password.', true);
            creationPasswordInput.focus();
            return;
        }
        const name = nameInput.value.trim();
        const password = passwordInput.value;
        if (!name || !password.trim()) {
            showStatus('Enter a page name and publishing password.', true);
            (!name ? nameInput : passwordInput).focus();
            return;
        }
        createButton.disabled = true;
        createButton.textContent = 'Creating…';
        try {
            await loadingPages;
            showStatus('Creating your webpage…');
            const response = await fetch('/api/vocabulary-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password, creationPassword })
            });
            const data = await response.json();
            if (!response.ok) {
                if (response.status === 401) {
                    creationPasswordInput.value = '';
                    creationPasswordInput.focus();
                }
                throw new Error(data.error || 'The webpage could not be created.');
            }
            addOption(data.page);
            dropdown.value = data.page.id;
            updateLinks();
            publishPassword.value = password;
            form.reset();
            document.getElementById('add-webpage').open = false;
            showStatus(`“${data.page.name}” was created and selected. Save its publishing password for future use.`, false, data.page.url);
            dropdown.focus();
        } catch (error) {
            showStatus(error.message || 'The webpage could not be created. Please try again.', true);
        } finally {
            createButton.disabled = false;
            createButton.textContent = 'Create webpage';
        }
    });
})();

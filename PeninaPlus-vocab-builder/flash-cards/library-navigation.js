/* Shared section bookmarks for custom class pages and the original grade pages. */
(() => {
    'use strict';
    const vocabulary = document.getElementById('sets');
    if (!vocabulary) return;

    const sections = [
        { id: 'vocabulary-lists-heading', target: 'knowledge-lists-heading', label: 'Knowledge Cards', arrow: '↓' },
        { id: 'knowledge-lists-heading', target: 'vocabulary-lists-heading', label: 'Vocabulary Cards', arrow: '↑' }
    ];
    const controls = new Map();
    let pendingHash = location.hash;

    function jump(id, smooth, focus) {
        const heading = document.getElementById(id);
        if (!heading || !heading.getClientRects().length) return false;
        if (focus) heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
        return true;
    }

    function addControl(section, heading) {
        const row = document.createElement('div');
        row.className = 'library-section-title';
        const link = document.createElement('a');
        link.className = 'library-section-jump';
        link.href = '#' + section.target;
        link.innerHTML = `<span>${section.label}</span><span aria-hidden="true">${section.arrow}</span>`;
        heading.before(row);
        row.append(heading, link);
        heading.tabIndex = -1;
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            pendingHash = '';
            if (location.hash !== link.hash) history.pushState(history.state, '', link.hash);
            jump(section.target, true, true);
        });
        const control = { row, link };
        controls.set(section.id, control);
        return control;
    }

    function sync() {
        const knowledge = document.querySelector('.knowledge-library .sets');
        const bothVisible = vocabulary.childElementCount && knowledge?.childElementCount;
        sections.forEach(section => {
            const heading = document.getElementById(section.id);
            if (!heading) return;
            const { row, link } = controls.get(section.id) || addControl(section, heading);
            row.hidden = heading.hidden;
            link.hidden = !bothVisible;
        });
        // Wait for both responses so a late vocabulary list cannot push the bookmarked
        // knowledge heading off screen after its initial scroll.
        const bookmarked = sections.find(section => pendingHash === '#' + section.id);
        const loaded = vocabulary.dataset.loaded === 'true' && knowledge?.dataset.loaded === 'true';
        if (bookmarked && loaded && jump(bookmarked.id, false, false)) pendingHash = '';
    }

    window.addEventListener('hashchange', () => { pendingHash = location.hash; sync(); });
    window.addEventListener('penina-library-rendered', sync);
    sync();
})();

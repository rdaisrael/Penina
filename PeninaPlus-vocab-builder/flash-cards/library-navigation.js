/* Shared section bookmarks for custom class pages and the original grade pages. */
(() => {
    'use strict';
    const shell = document.querySelector('.shell');
    const vocabulary = document.getElementById('sets');
    if (!shell || !vocabulary) return;

    const sections = [
        { id: 'vocabulary-lists-heading', label: 'Vocabulary Cards', jump: 'Back to Vocabulary Cards', arrow: '↑' },
        { id: 'knowledge-lists-heading', label: 'Knowledge Cards', jump: 'Go to Knowledge Cards', arrow: '↓' }
    ];
    const nav = document.createElement('nav');
    nav.className = 'library-navigation';
    nav.setAttribute('aria-label', 'Jump to card section');
    nav.hidden = true;
    nav.innerHTML = '<div class="library-navigation-links">' + sections.map(section =>
        `<a class="library-navigation-link" href="#${section.id}"><span class="library-navigation-arrow" aria-hidden="true"></span><span class="library-navigation-label">${section.label}</span></a>`
    ).join('') + '</div>';
    document.querySelector('.intro').after(nav);
    const links = [...nav.querySelectorAll('a')];
    let pendingHash = location.hash;
    let frame = 0;

    function select(id) {
        sections.forEach((section, index) => {
            const current = section.id === id;
            const link = links[index];
            if (current) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
            link.querySelector('.library-navigation-label').textContent = current ? section.label : section.jump;
            link.querySelector('.library-navigation-arrow').textContent = current ? '' : section.arrow;
        });
    }

    function updateOffset() {
        shell.style.setProperty('--library-navigation-offset', `${nav.hidden ? 16 : nav.offsetHeight + 16}px`);
    }

    function updateActive() {
        frame = 0;
        if (nav.hidden) return;
        const heading = document.getElementById(sections[1].id);
        const vocabularyTop = document.getElementById(sections[0].id).getBoundingClientRect().top;
        const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        const knowledgeAtBottom = atBottom && (vocabularyTop < nav.offsetHeight || location.hash === '#' + sections[1].id);
        select(heading.getBoundingClientRect().top <= nav.offsetHeight + 32 || knowledgeAtBottom ? sections[1].id : sections[0].id);
    }

    function scheduleActive() {
        if (!frame) frame = requestAnimationFrame(updateActive);
    }

    function jump(id, smooth, focus) {
        const heading = document.getElementById(id);
        if (!heading || !heading.getClientRects().length) return false;
        updateOffset();
        if (focus) heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
        select(id);
        return true;
    }

    function sync() {
        const knowledge = document.querySelector('.knowledge-library .sets');
        nav.hidden = !(vocabulary.childElementCount && knowledge?.childElementCount);
        sections.forEach(section => {
            const heading = document.getElementById(section.id);
            if (heading) heading.tabIndex = -1;
        });
        updateOffset();
        // Wait for both responses so a late vocabulary list cannot push the bookmarked
        // knowledge heading off screen after its initial scroll.
        const bookmarked = sections.find(section => pendingHash === '#' + section.id);
        const loaded = vocabulary.dataset.loaded === 'true' && knowledge?.dataset.loaded === 'true';
        if (bookmarked && loaded && jump(bookmarked.id, false, false)) pendingHash = '';
        else scheduleActive();
    }

    links.forEach((link, index) => link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        pendingHash = '';
        if (location.hash !== link.hash) history.pushState(history.state, '', link.hash);
        jump(sections[index].id, true, true);
    }));
    window.addEventListener('hashchange', () => { pendingHash = location.hash; sync(); });
    window.addEventListener('penina-library-rendered', sync);
    window.addEventListener('scroll', scheduleActive, { passive: true });
    window.addEventListener('resize', sync);
    new ResizeObserver(updateOffset).observe(nav);
    sync();
})();

'use strict';
(() => {
    const path = location.pathname.toLowerCase();
    const pageType = document.querySelector('meta[name="penina-page-type"]')?.content?.toLowerCase()
        || document.body?.dataset.peninaPageType?.toLowerCase();
    const classGradeOrStudentRoute = /(?:^|[\/_-])(?:class(?:es|room)?|grade|student)(?:s)?(?:$|[\/_-])/.test(path);
    const studentPage = pageType === 'student' || pageType === 'class' || pageType === 'grade'
        || !!document.querySelector('[data-penina-page-type="student"], #googleLogin, #studentIdentity, form#quiz');
    if (location.protocol === 'file:' || path === '/' || path === '/index.html'
        || document.getElementById('return-to-penina') || classGradeOrStudentRoute || studentPage
        || path.includes('/flash-cards/')) return;
    const link = document.createElement('a');
    link.id = 'return-to-penina';
    link.href = '/';
    link.setAttribute('aria-label', 'Return to Penina Suite');
    link.title = 'Return to Penina Suite';
    link.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:fit-content;min-width:78px;padding:5px 8px 6px;margin:6px 0 10px 8px;border:1px solid #d8c79d;border-radius:8px;background:rgba(255,255,255,.96);color:#302c25;text-decoration:none;font:10px/1.2 Arial,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.1);position:relative;z-index:10000';
    const printStyles = document.createElement('style');
    printStyles.textContent = '@media print { #return-to-penina { display: none !important; } }';
    document.head.appendChild(printStyles);
    if (location.pathname.startsWith('/coming-soon/')) {
        link.style.position = 'fixed';
        link.style.top = '8px';
        link.style.left = '8px';
    }
    link.innerHTML = '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/><path d="M2 10 12 2l10 8"/></svg><span>Return to Penina Suite</span>';
    document.body.insertBefore(link, document.body.firstChild);
})();

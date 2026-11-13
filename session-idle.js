'use strict';
(() => {
    const idleLimit = 60 * 60 * 1000;
    const activityCookie = 'penina_activity';
    const productionDomain = location.hostname === 'penina-hebrew.org' || location.hostname.endsWith('.penina-hebrew.org');
    const hostPage = location.hostname === 'www.penina-hebrew.org';
    const homepage = location.pathname === '/' || location.pathname === '/index.html';
    let lastActivity = 0;
    let lastHeartbeat = 0;
    let lastWrite = 0;
    let ending = false;
    let heartbeatStopped = false;
    let heartbeatPending = false;
    const readSharedActivity = () => {
        const match = document.cookie.split('; ').find(item => item.startsWith(activityCookie + '='));
        const value = Number(match?.slice(activityCookie.length + 1)) || 0;
        // The login cookie uses the server clock; allow the same small skew as the API.
        return value > Date.now() + 60_000 ? 0 : Math.min(value, Date.now());
    };
    function syncActivity() {
        const shared = readSharedActivity();
        let local = 0;
        try { local = Number(localStorage.getItem(activityCookie)) || 0; } catch (_) {}
        if (local > Date.now()) local = 0;
        lastActivity = Math.max(lastActivity, shared, local);
    }
    function writeSharedActivity(time) {
        if (productionDomain) document.cookie = `${activityCookie}=${time}; Domain=penina-hebrew.org; Path=/; Max-Age=3600; Secure; SameSite=Lax`;
        try { localStorage.setItem('penina_activity', String(time)); } catch (_) {}
    }
    if (hostPage && new URLSearchParams(location.search).get('session') === 'expired') {
        // A suspended tab may arrive here after another tab has signed in again.
        syncActivity();
        if (lastActivity && Date.now() - lastActivity < idleLimit) { location.replace('/'); return; }
        if (productionDomain) document.cookie = `${activityCookie}=; Domain=penina-hebrew.org; Path=/; Max-Age=0; Secure; SameSite=Lax`;
        try { localStorage.removeItem('penina_activity'); } catch (_) {}
        fetch('/api/game-scores?game=quiz-account&action=logout', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',keepalive:true})
            .finally(() => location.replace('/'));
        return;
    }
    function finishSession() {
        if (ending) return;
        // pageshow can run before the storage event after restoring a frozen tab.
        syncActivity();
        if (Date.now() - lastActivity < idleLimit) return;
        ending = true;
        if (productionDomain) document.cookie = `${activityCookie}=; Domain=penina-hebrew.org; Path=/; Max-Age=0; Secure; SameSite=Lax`;
        try { localStorage.removeItem('penina_activity'); } catch (_) {}
        if (hostPage) {
            const studentQuiz = location.pathname.startsWith('/Penina-Quizzes/') && /^[a-f0-9]{32}$/.test(new URLSearchParams(location.search).get('class') || '');
            const destination = studentQuiz ? location.pathname + location.search : '/';
            fetch('/api/game-scores?game=quiz-account&action=logout', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',keepalive:true})
            .finally(() => location.replace(destination));
        } else location.replace('https://www.penina-hebrew.org/?session=expired');
    }
    function recordActivity() {
        const now = Date.now();
        lastActivity = now;
        if (now - lastWrite > 5000) { writeSharedActivity(now); lastWrite = now; }
    }
    syncActivity();
    if (!lastActivity) recordActivity();
    else if (Date.now() - lastActivity >= idleLimit) finishSession();
    for (const eventName of ['pointerdown','keydown','touchstart','wheel','click','input','scroll'])
        addEventListener(eventName, recordActivity, {passive:true});
    addEventListener('mousemove', () => { if (Date.now() - lastWrite >= 10000) recordActivity(); }, {passive:true});
    addEventListener('pageshow', () => { syncActivity(); if (Date.now() - lastActivity >= idleLimit) finishSession(); });
    addEventListener('storage', event => {
        if (event.key !== 'penina_activity') return;
        const value = Number(event.newValue) || 0;
        if (value > lastActivity && value <= Date.now()) lastActivity = value;
    });
    document.addEventListener('timeupdate', event => {
        if (event.target instanceof HTMLMediaElement && !event.target.paused) recordActivity();
    }, true);
    setInterval(() => {
        syncActivity();
        if (Date.now() - lastActivity >= idleLimit) { finishSession(); return; }
        // The homepage already checks sign-in and shows this account element only on success.
        // The activity cookie alone is not proof of sign-in: anonymous activity also writes it.
        const signedIn = !homepage || document.getElementById('signed-in-account')?.hidden === false;
        if (hostPage && signedIn && !ending && !heartbeatStopped && !heartbeatPending && Date.now() - lastHeartbeat >= 60_000) {
            lastHeartbeat = Date.now();
            heartbeatPending = true;
            fetch('/api/game-scores?game=quiz-account&action=activity', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'})
                .then(response => { if (response.status === 401) heartbeatStopped = true; })
                .catch(() => {})
                .finally(() => { heartbeatPending = false; });
        }
    }, 5000);
})();

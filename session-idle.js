'use strict';
(() => {
    const idleLimit = 60 * 60 * 1000;
    const activityCookie = 'penina_activity';
    const productionDomain = location.hostname === 'penina-hebrew.org' || location.hostname.endsWith('.penina-hebrew.org');
    const hostPage = location.hostname === 'www.penina-hebrew.org';
    let lastActivity = 0;
    let lastHeartbeat = 0;
    let lastWrite = 0;
    let ending = false;
    const readSharedActivity = () => {
        const match = document.cookie.split('; ').find(item => item.startsWith(activityCookie + '='));
        const value = Number(match?.slice(activityCookie.length + 1)) || 0;
        return value > Date.now() ? 0 : value;
    };
    function writeSharedActivity(time) {
        if (productionDomain) document.cookie = `${activityCookie}=${time}; Domain=penina-hebrew.org; Path=/; Max-Age=3600; Secure; SameSite=Lax`;
        try { localStorage.setItem('penina_activity', String(time)); } catch (_) {}
    }
    if (hostPage && new URLSearchParams(location.search).get('session') === 'expired') {
        if (productionDomain) document.cookie = `${activityCookie}=; Domain=penina-hebrew.org; Path=/; Max-Age=0; Secure; SameSite=Lax`;
        try { localStorage.removeItem('penina_activity'); } catch (_) {}
        fetch('/api/game-scores?game=quiz-account&action=logout', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',keepalive:true})
            .finally(() => location.replace('/'));
        return;
    }
    function finishSession() {
        if (ending) return;
        ending = true;
        if (productionDomain) document.cookie = `${activityCookie}=; Domain=penina-hebrew.org; Path=/; Max-Age=0; Secure; SameSite=Lax`;
        try { localStorage.removeItem('penina_activity'); } catch (_) {}
        if (hostPage) {
            fetch('/api/game-scores?game=quiz-account&action=logout', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',keepalive:true})
            .finally(() => location.replace('/'));
        } else location.replace('https://www.penina-hebrew.org/?session=expired');
    }
    function recordActivity() {
        const now = Date.now();
        lastActivity = now;
        if (now - lastWrite > 5000) { writeSharedActivity(now); lastWrite = now; }
    }
    const initialActivity = readSharedActivity();
    const initialLocal = (() => { try { return Number(localStorage.getItem('penina_activity')) || 0; } catch (_) { return 0; } })();
    lastActivity = Math.max(initialActivity, initialLocal);
    if (!lastActivity) recordActivity();
    else if (Date.now() - lastActivity >= idleLimit) finishSession();
    for (const eventName of ['pointerdown','keydown','touchstart','wheel','click','input','scroll'])
        addEventListener(eventName, recordActivity, {passive:true});
    addEventListener('mousemove', () => { if (Date.now() - lastWrite >= 10000) recordActivity(); }, {passive:true});
    addEventListener('pageshow', () => { if (Date.now() - lastActivity >= idleLimit) finishSession(); });
    addEventListener('storage', event => {
        if (event.key !== 'penina_activity') return;
        const value = Number(event.newValue) || 0;
        if (value > lastActivity) lastActivity = value;
    });
    document.addEventListener('timeupdate', event => {
        if (event.target instanceof HTMLMediaElement && !event.target.paused) recordActivity();
    }, true);
    setInterval(() => {
        const shared = readSharedActivity();
        if (shared > lastActivity) lastActivity = shared;
        const local = (() => { try { return Number(localStorage.getItem('penina_activity')) || 0; } catch (_) { return 0; } })();
        if (local > lastActivity) lastActivity = local;
        if (Date.now() - lastActivity >= idleLimit) { finishSession(); return; }
        if (hostPage && Date.now() - lastHeartbeat >= 60_000) {
            lastHeartbeat = Date.now();
            fetch('/api/game-scores?game=quiz-account&action=activity', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'}).catch(() => {});
        }
    }, 5000);
})();

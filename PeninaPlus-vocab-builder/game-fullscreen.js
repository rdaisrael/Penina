// Also embedded in downloadable games, which run without any external scripts.
function mountGameFullscreen(button, surface) {
    const doc = surface.ownerDocument;
    const dialog = surface.closest('dialog');
    const nativeElement = () => doc.fullscreenElement || doc.webkitFullscreenElement;
    const request = surface.requestFullscreen || surface.webkitRequestFullscreen;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    let expandedInPage = false;
    let pending = false;

    function sync() {
        const active = nativeElement() === surface || expandedInPage;
        surface.classList.toggle('game-fullscreen', active);
        button.textContent = active ? (button.dataset?.exitLabel || 'Exit full screen') : 'Full screen';
    }

    async function leave() {
        expandedInPage = false;
        if (nativeElement() === surface) {
            try { await exit.call(doc); } catch { /* The browser may already be exiting. */ }
        }
        sync();
    }

    // Older WebKit reports a refused request via an event instead of a promise.
    surface.addEventListener('webkitfullscreenerror', () => {
        if (!dialog || dialog.open) {
            expandedInPage = true;
            sync();
        }
    });
    button.addEventListener('click', async () => {
        if (pending) return;
        if (surface.classList.contains('game-fullscreen')) {
            await leave();
            return;
        }
        pending = true;
        try {
            if (request && exit && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) !== false) {
                await request.call(surface);
            } else {
                expandedInPage = true;
            }
        } catch {
            expandedInPage = true;
        } finally {
            pending = false;
            if (dialog && !dialog.open) await leave();
            else sync();
        }
    });
    doc.addEventListener('fullscreenchange', sync);
    doc.addEventListener('webkitfullscreenchange', sync);
    if (dialog) {
        dialog.addEventListener('cancel', event => {
            if (surface.classList.contains('game-fullscreen')) {
                event.preventDefault();
                leave();
            }
        });
        dialog.addEventListener('close', leave);
    } else {
        doc.addEventListener('keydown', event => {
            if (event.key === 'Escape' && expandedInPage) leave();
        });
    }
    button.hidden = false;
}

if (typeof module !== 'undefined' && module.exports) module.exports = mountGameFullscreen;

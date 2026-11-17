'use strict';

// Reader opts in after authentication through the existing app gateway.
// Older callers retain the JSON/status-code contract. Keep progress flowing
// while generation/repair runs; the final event contains only checked output.
function createReaderResponse(req, res, {heartbeatMs = 15000} = {}) {
    const streaming = String(req.headers?.accept || '').split(',').some(value => value.trim() === 'text/event-stream');
    const controller = new AbortController();
    let started = false, closed = false, timer;
    const stopTimer = () => {clearInterval(timer); timer = undefined;};
    const disconnect = () => {closed = true; stopTimer(); controller.abort();};
    function progress(stage) {
        if (!streaming || closed) return;
        if (!started) {
            started = true;
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'private, no-store, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.on('close', disconnect);
            res.flushHeaders?.();
            timer = setInterval(() => {if (!closed) res.write(': keep-alive\n\n');}, heartbeatMs);
            timer.unref?.();
        }
        res.write('data: ' + JSON.stringify({type: 'progress', stage}) + '\n\n');
    }
    function send(status, data) {
        if (closed) return;
        if (!started) return res.status(status).json(data);
        stopTimer();
        closed = true;
        res.removeListener('close', disconnect);
        return res.end('data: ' + JSON.stringify({type: 'result', status, data}) + '\n\n');
    }
    function dispose() {
        stopTimer();
        if (started) res.removeListener('close', disconnect);
    }
    return {progress, send, dispose, signal: streaming ? controller.signal : undefined};
}

module.exports = {createReaderResponse};

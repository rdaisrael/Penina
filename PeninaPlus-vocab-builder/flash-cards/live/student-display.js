// The toolbar and reader stay mounted while the shared game replaces its stage.
function mountLiveCardReader(stage, host) {
    const shell = stage.closest('.live-shell');
    const read = document.getElementById('read-card');
    const reader = document.getElementById('card-reader');
    const pages = reader.querySelector('.reader-pages');
    const previous = reader.querySelector('[data-prev]');
    const next = reader.querySelector('[data-next]');
    const clock = reader.querySelector('[data-reader-clock]');
    let page = 0;

    shell.classList.add(host ? 'teacher-view' : 'student-view');

    function turnPage(index) {
        if (!reader.open || !pages.clientWidth) return;
        const count = Math.max(1, Math.ceil((pages.scrollWidth - 1) / pages.clientWidth));
        page = Math.max(0, Math.min(index, count - 1));
        pages.scrollLeft = page * pages.clientWidth;
        previous.disabled = page === 0;
        next.disabled = page === count - 1;
        reader.querySelector('[role=status]').textContent = (page + 1) + ' / ' + count;
    }

    function measureCard() {
        const fields = stage.querySelectorAll('.live-round .question-content,.live-round .answer .text');
        read.hidden = !Array.from(fields).some(field =>
            field.scrollHeight > field.clientHeight + 1 || field.scrollWidth > field.clientWidth + 1);
    }

    function resetReader() {
        if (reader.open) reader.close();
        read.hidden = true;
    }

    read.onclick = () => {
        const question = stage.querySelector('.question-content');
        if (!question) return;
        const choices = Array.from(stage.querySelectorAll('.answer'), answer => {
            const line = document.createElement('p');
            const wording = document.createElement('bdi');
            wording.textContent = answer.querySelector('.text').textContent;
            line.append(answer.querySelector('.letter span').textContent + '. ', wording);
            return line;
        });
        pages.replaceChildren(...Array.from(question.children, child => child.cloneNode(true)), ...choices);
        clock.textContent = stage.querySelector('[data-clock]')?.textContent || '';
        reader.showModal();
        turnPage(0);
        reader.querySelector('[data-done]').focus();
    };
    previous.onclick = () => turnPage(page - 1);
    next.onclick = () => turnPage(page + 1);
    reader.querySelector('[data-done]').onclick = () => reader.close();
    reader.addEventListener('keydown', event => {
        if (event.key === 'Escape') event.stopPropagation();
    });
    reader.addEventListener('close', () => { if (!reader.open) pages.replaceChildren(); });
    stage.addEventListener('load', measureCard, true);
    pages.addEventListener('load', () => turnPage(page), true);
    const resize = new ResizeObserver(() => { measureCard(); turnPage(page); });
    resize.observe(stage);
    resize.observe(pages);
    document.fonts?.ready.then(measureCard);
    return {measureCard, resetReader, updateClock(text) { if (reader.open && clock.textContent !== text) clock.textContent = text; }};
}

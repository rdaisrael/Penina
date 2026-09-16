/* Lay out actual rendered words and notes together at the printable Letter size. */
(function(root) {
    function paginate(output, notes, englishFont) {
        const title = output.querySelector('.story-title');
        const source = output.querySelector('.story-body');
        if (!source) return;
        const footer = output.querySelector('.penina-footer');
        const noteById = new Map(notes.map(note => [String(note.id), note]));
        const units = [];
        for (const node of Array.from(source.childNodes)) {
            if (node.nodeType === 1 && node.matches('.reader-token, .heb-word:not(.footnote-marker)')) units.push([]);
            if (!units.length) units.push([]);
            units[units.length - 1].push(node);
        }
        output.replaceChildren();
        output.classList.add('paginated');
        let offset = 0, first = true;
        do {
            const page = document.createElement('section');
            page.className = 'reader-page';
            page.setAttribute('aria-label', `Page ${output.children.length + 1}`);
            const content = document.createElement('div');
            content.className = 'reader-page-content';
            if (first && title) content.append(title);
            const body = source.cloneNode(false);
            content.append(body);
            const noteBox = document.createElement('div');
            noteBox.className = 'generated-footnotes';
            noteBox.style.fontFamily = englishFont;
            const credit = footer ? footer.cloneNode(true) : document.createElement('div');
            page.append(content, noteBox, credit);
            output.append(page);
            const renderNotes = () => {
                const ids = new Set(Array.from(content.querySelectorAll('.footnote-marker'))
                    .filter(marker => marker.style.display !== 'none').map(marker => marker.dataset.fn));
                noteBox.replaceChildren();
                noteBox.hidden = ids.size === 0;
                if (!ids.size) return;
                const heading = document.createElement('strong');
                heading.textContent = 'Footnotes:';
                const list = document.createElement('div');
                list.className = 'footnote-columns';
                for (const id of ids) {
                    const note = noteById.get(id);
                    if (!note) continue;
                    const row = document.createElement('div');
                    row.className = 'footnote-entry';
                    row.dataset.noteId = id;
                    row.textContent = `${note.id}. ${note.word} — ${note.translation}`;
                    list.append(row);
                }
                noteBox.append(heading, list);
            };
            // Flex gaps and the credit are included in the measured occupied height.
            const fits = () => page.scrollHeight <= page.clientHeight + 1;
            let end = offset, preferred = offset;
            renderNotes();
            while (end < units.length) {
                body.append(...units[end]);
                renderNotes();
                if (!fits()) {
                    units[end].forEach(node => node.remove());
                    renderNotes();
                    break;
                }
                end++;
                const unit = units[end - 1];
                if (unit.some(node => node.nodeName === 'BR' || /[.!?׃][\s”"׳״’]*$/.test(node.textContent || ''))) preferred = end;
            }
            // Prefer a complete sentence/paragraph when it does not leave most of the page empty.
            if (end < units.length && preferred > offset && preferred >= offset + (end - offset) * 0.6) {
                while (end > preferred) units[--end].forEach(node => node.remove());
                renderNotes();
            }
            if (end === offset && end < units.length) {
                // A very large title/gloss must still advance; let this exceptional page flow
                // onto additional printed pages instead of clipping or dropping any content.
                body.append(...units[end++]);
                renderNotes();
                page.classList.add('reader-page-overflow');
            }
            offset = end;
            first = false;
        } while (offset < units.length);
    }
    root.ReaderPagination = {paginate};
})(typeof globalThis !== 'undefined' ? globalThis : this);

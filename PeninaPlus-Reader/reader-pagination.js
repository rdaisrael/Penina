/* Lay out actual rendered words and notes together at the printable Letter size. */
(function(root) {
    function paginate(output, notes, englishFont) {
        const title = output.querySelector('.story-title');
        const source = output.querySelector('.story-body');
        if (!source) return;
        const footer = output.querySelector('.penina-footer');
        const noteById = new Map(notes.map(note => [String(note.id), note]));
        const units = [];
        // Preserve paragraph/question containers while allowing long passages to wrap.
        function addWords(nodes, wrapper = null) {
            let unit;
            for (const node of nodes) {
                if (!unit || (node.nodeType === 1 && node.matches('.reader-token, .heb-word:not(.footnote-marker)'))) {
                    unit = {nodes: [], wrapper}; units.push(unit);
                }
                unit.nodes.push(node);
            }
        }
        for (const node of Array.from(source.childNodes)) {
            if (node.nodeType === 1 && node.matches('.worksheet-reading-section')) {
                addWords(Array.from(node.childNodes), node);
            } else if (node.nodeType === 1 && node.matches('.section-questions')) {
                Array.from(node.querySelectorAll('.worksheet-question')).forEach((question, i) => {
                    const gap = question.nextElementSibling;
                    units.push({nodes: gap?.matches('.worksheet-question-gap') ? [question, gap] : [question], wrapper: node, question: true,
                        followsReading: i === 0 && units.length > 0 && !units[units.length - 1].question});
                });
            } else {
                // Plain story nodes must be grouped together before tokenizing.
                let nodes = units[units.length - 1];
                if (!nodes || nodes.wrapper || (node.nodeType === 1 && node.matches('.reader-token, .heb-word:not(.footnote-marker)'))) {
                    nodes = {nodes: [], wrapper: null}; units.push(nodes);
                }
                nodes.nodes.push(node);
            }
        }
        let groupStart = 0, lastReading = null;
        units.forEach((unit, i) => {
            if (unit.wrapper?.matches('.worksheet-reading-section') && unit.wrapper !== lastReading) {
                groupStart = i; lastReading = unit.wrapper;
            }
            unit.groupStart = groupStart;
        });
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
            const wrappers = new Map();
            const appendUnit = unit => {
                let target = body;
                if (unit.wrapper) {
                    if (!wrappers.has(unit.wrapper)) {
                        const clone = unit.wrapper.cloneNode(false);
                        body.append(clone); wrappers.set(unit.wrapper, clone);
                    }
                    target = wrappers.get(unit.wrapper);
                    if (!target.isConnected) body.append(target);
                }
                target.append(...unit.nodes);
            };
            const removeUnit = unit => {
                unit.nodes.forEach(node => node.remove());
                const wrapper = wrappers.get(unit.wrapper);
                if (wrapper && !wrapper.childNodes.length) wrapper.remove();
            };
            let end = offset, preferred = offset;
            renderNotes();
            while (end < units.length) {
                appendUnit(units[end]);
                renderNotes();
                if (!fits()) {
                    removeUnit(units[end]);
                    renderNotes();
                    break;
                }
                end++;
                const unit = units[end - 1].nodes;
                if (unit.some(node => node.nodeName === 'BR' || /[.!?׃][\s”"׳״’]*$/.test(node.textContent || ''))) preferred = end;
            }
            // Move a passage and its questions together when they fit on a fresh page.
            // If a group itself exceeds a page, fall back to sentence-level wrapping.
            if (end < units.length && units[end].groupStart > offset) {
                const boundary = units[end].groupStart;
                while (end > boundary) removeUnit(units[--end]);
                preferred = end;
                renderNotes();
            }
            // Prefer a complete sentence/paragraph when it does not leave most of the page empty.
            if (end < units.length && preferred > offset && preferred >= offset + (end - offset) * 0.6) {
                while (end > preferred) removeUnit(units[--end]);
                renderNotes();
            }
            // Keep the first question with the final sentence of its passage.
            if (end < units.length && units[end].followsReading && end > offset + 1) {
                let start = end - 1;
                while (start > offset && units[start - 1].wrapper === units[end - 1].wrapper &&
                    !units[start - 1].nodes.some(node => /[.!?׃][\s”"׳״’]*$/.test(node.textContent || ''))) start--;
                if (start > offset) {
                    while (end > start) removeUnit(units[--end]);
                    renderNotes();
                }
            }
            if (end === offset && end < units.length) {
                // A very large title/gloss must still advance; let this exceptional page flow
                // onto additional printed pages instead of clipping or dropping any content.
                appendUnit(units[end++]);
                renderNotes();
                page.classList.add('reader-page-overflow');
            }
            offset = end;
            first = false;
        } while (offset < units.length);
    }
    root.ReaderPagination = {paginate};
})(typeof globalThis !== 'undefined' ? globalThis : this);

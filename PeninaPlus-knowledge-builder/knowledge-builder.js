/* Flashcard authoring, review, and printable layouts. */
(() => {
    'use strict';
    const {FORMAT, normalizeDeck, hasInformation, printSheets, pictureTargets} = window.PeninaKnowledgeCards;
    const byId = id => document.getElementById(id);
    const embedded = byId('peninaKnowledgeData');
    const studentMode = Boolean(embedded);
    let workflow;
    let deck = {format: FORMAT, version: 1, title: '', cards: []};
    let editingId = null, picture = null, activeTarget = 0, dirty = false, stage = 'edit';
    let order = [], index = 0, showingAnswer = false, ratings = {};
    let db = null, saveTimer, uploadVersion = 0, uploading = false, pictureDisplayWidth = 0, pictureAspectRatio = 1, pictureTrigger = null, pictureZoomStep = 0;
    const pictureZoomSteps = [1.5, 2, 3];
    const app = document.querySelector('.app');
    const make = (tag, className, value) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (value !== undefined) element.textContent = value;
        return element;
    };
    function message(value, error = false) {
        byId('editor-message').textContent = value;
        byId('editor-message').classList.toggle('error', error);
    }
    function storageMessage(value, error = false) {
        byId('save-status').textContent = value;
        byId('save-status').classList.toggle('error', error);
    }
    function editorSnapshot() {
        return {editingId, question: byId('question').value, answer: byId('answer').value,
            additionalInformation: byId('additional-information').value,
            picture: picture ? {...picture, alt: byId('picture-alt').value} : null, dirty};
    }
    function persist() {
        clearTimeout(saveTimer);
        if (studentMode || !db) return;
        try {
            const transaction = db.transaction('drafts', 'readwrite');
            transaction.objectStore('drafts').put({deck, editor: editorSnapshot()}, 'current');
            transaction.oncomplete = () => storageMessage('Saved in this browser. Save a draft to keep a copy.');
            transaction.onerror = () => storageMessage('Browser storage is full or unavailable. Save your draft to keep your work.', true);
        } catch (_) {
            storageMessage('Could not save in this browser. Save your draft to keep your work.', true);
        }
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 350);
    }
    async function confirmAction(text, confirmLabel = 'Continue') {
        const dialog = byId('confirm-dialog');
        byId('confirm-message').textContent = text;
        dialog.querySelector('[value="confirm"]').textContent = confirmLabel;
        dialog.returnValue = 'cancel';
        return new Promise(resolve => {
            dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true});
            dialog.showModal();
        });
    }
    function addMarkers(parent, value, selected = -1) {
        const targets = pictureTargets(value);
        targets.forEach((target, i) => {
            const labeled = targets.length > 1;
            const marker = make('span', `target-marker${labeled ? ' labeled-target' : ''}${i === selected && labeled ? ' selected-target' : ''}`, labeled ? 'ABCDE'[i] : '');
            marker.style.left = `${target.x * 100}%`;
            marker.style.top = `${target.y * 100}%`;
            marker.setAttribute('role', 'img');
            marker.setAttribute('aria-label', labeled ? `Target ${'ABCDE'[i]}` : 'Marked location');
            parent.append(marker);
        });
    }
    function pictureImage(value) {
        const image = make('img');
        image.src = value.src;
        image.alt = value.alt || (pictureTargets(value).length ? 'Card picture with target markers' : 'Card picture');
        return image;
    }
    function renderEditorPicture() {
        const surface = byId('target-surface');
        surface.replaceChildren();
        byId('picture-editor').hidden = !picture;
        byId('remove-picture').hidden = !picture;
        const targets = pictureTargets(picture);
        activeTarget = Math.max(0, Math.min(activeTarget, targets.length - 1));
        byId('remove-target').hidden = !targets.length;
        byId('remove-target').textContent = targets.length > 1 ? `Remove Target ${'ABCDE'[activeTarget]}` : 'Remove Target';
        byId('add-target').disabled = targets.length >= 5;
        byId('target-select-label').hidden = targets.length < 2;
        byId('target-select').replaceChildren(...targets.map((_, i) => {
            const option = make('option', '', 'ABCDE'[i]); option.value = i; return option;
        }));
        byId('target-select').value = activeTarget;
        if (picture) {
            surface.append(pictureImage(picture));
            addMarkers(surface, picture, activeTarget);
        }
    }

    function reusePicture(source) {
        uploadVersion++;
        uploading = false;
        byId('save-card').disabled = false;
        byId('picture-file').value = '';
        picture = {src: source.src, alt: source.alt || '', target: null};
        activeTarget = 0;
        byId('picture-alt').value = picture.alt;
        dirty = true;
        renderEditorPicture();
        persist();
        byId('reuse-pictures').open = false;
        byId('reuse-pictures').querySelector('summary').focus();
        message('Picture reused. Add up to 5 targets for this question if needed.');
    }
    function renderReusablePictures() {
        const seen = new Set(), choices = [];
        deck.cards.forEach((card, number) => {
            if (!card.picture || seen.has(card.picture.src)) return;
            seen.add(card.picture.src);
            const button = make('button', 'reuse-picture');
            button.type = 'button';
            button.setAttribute('aria-label', `Reuse picture from card ${number + 1}: ${card.question}`);
            const thumbnail = pictureImage(card.picture);
            thumbnail.alt = '';
            thumbnail.loading = 'lazy';
            const label = make('span', '', `Card ${number + 1}: ${card.question}`);
            label.dir = 'auto';
            button.append(thumbnail, label);
            button.addEventListener('click', () => reusePicture(card.picture));
            choices.push(button);
        });
        byId('reusable-pictures').replaceChildren(...choices);
        byId('reuse-pictures').hidden = !choices.length;
        if (!choices.length) byId('reuse-pictures').open = false;
    }
    function openEditor(card = null) {
        uploadVersion++;
        uploading = false;
        byId('save-card').disabled = false;
        editingId = card?.id || null;
        picture = card?.picture ? structuredClone(card.picture) : null;
        activeTarget = 0;
        byId('question').value = card?.question || '';
        byId('answer').value = card?.answer || '';
        byId('additional-information').value = card?.additionalInformation || '';
        byId('picture-alt').value = picture?.alt || '';
        byId('picture-file').value = '';
        byId('reuse-pictures').open = false;
        byId('editor-title').textContent = card ? `Edit Card ${deck.cards.indexOf(card) + 1}` : 'Add a Card';
        byId('save-card').textContent = card ? 'Save Card' : 'Add Card';
        byId('delete-card').hidden = !card;
        dirty = false;
        message('');
        renderEditorPicture();
        renderList();
    }
    function renderList() {
        renderReusablePictures();
        byId('card-count').textContent = deck.cards.length;
        byId('empty-list').hidden = deck.cards.length > 0;
        byId('card-list').replaceChildren(...deck.cards.map((card, number) => {
            const li = make('li'), button = make('button');
            button.type = 'button';
            if (card.id === editingId) button.setAttribute('aria-current', 'true');
            const label = make('span', 'list-question', card.question.length > 110 ? `${card.question.slice(0, 110)}…` : card.question);
            label.dir = 'auto';
            button.append(make('span', 'list-number', String(number + 1)), label);
            button.addEventListener('click', () => {
                if (commitEditor()) {openEditor(deck.cards.find(value => value.id === card.id)); persist();}
            });
            li.append(button);
            return li;
        }));
        document.querySelectorAll('[data-stage]').forEach(button => {
            button.disabled = button.dataset.stage !== 'edit' && !deck.cards.length;
        });
    }
    function commitEditor() {
        if (uploading) {message('Please wait for the picture to finish loading.', true); return false;}
        if (!dirty) return true;
        if (!byId('card-form').reportValidity()) return false;
        const question = byId('question').value.trim(), answer = byId('answer').value.trim();
        if (!question || !answer) {message('Enter both a question and an answer.', true); return false;}
        if (!editingId && deck.cards.length >= 500) {message('A set can contain up to 500 cards.', true); return false;}
        const previous = deck.cards.find(value => value.id === editingId);
        const card = {id: editingId || crypto.randomUUID(), question, answer,
            distractors: previous?.question === question && previous?.answer === answer ? (previous.distractors || {}) : {},
            additionalInformation: byId('additional-information').value.trim(),
            picture: picture ? {...picture, alt: byId('picture-alt').value.trim()} : null};
        const existingIndex = deck.cards.findIndex(value => value.id === editingId);
        if (existingIndex >= 0) deck.cards[existingIndex] = card;
        else deck.cards.push(card);
        editingId = card.id;
        dirty = false;
        byId('save-card').textContent = 'Save Card';
        byId('editor-title').textContent = `Edit Card ${deck.cards.indexOf(card) + 1}`;
        byId('delete-card').hidden = false;
        renderList();
        persist();
        return true;
    }
    function setStage(nextStage) {
        if (studentMode && !['study','print','sheet','quiz'].includes(nextStage)) return;
        if (workflow && !workflow.leave(stage)) return;
        if (stage === 'edit' && !commitEditor()) return;
        if (nextStage !== 'edit' && !deck.cards.length) return;
        stage = nextStage;
        for (const name of ['edit', 'study', 'print', 'practice', 'share', 'sheet', 'quiz']) byId(`${name}-stage`).hidden = name !== stage;
        document.querySelectorAll('[data-stage]').forEach(button => {
            if (button.dataset.stage === stage) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
        if (stage === 'study') {
            order = deck.cards.map(card => card.id);
            index = 0;
            showingAnswer = false;
            renderStudy();
        }
        if (stage === 'print') renderPrint();
        if (stage === 'sheet') renderSheet();
        workflow?.enter(stage);
    }
    function studyCard() {return deck.cards.find(card => card.id === order[index]);}
    function cardContent(card, back, paper = false) {
        const content = make('div', `card-content${!back && card.picture ? ' has-picture' : ''}`);
        if (!back && card.picture) {
            const holder = make(paper ? 'div' : 'button', paper ? 'paper-image' : 'picture-button');
            holder.append(pictureImage(card.picture));
            addMarkers(holder, card.picture);
            if (!paper) {
                holder.type = 'button';
                holder.setAttribute('aria-label', 'Enlarge picture');
                holder.addEventListener('click', event => {event.stopPropagation(); openPicture(card.picture, holder);});
            }
            content.append(holder);
        }
        const copy = make('p', 'card-text', back ? card.answer : card.question);
        copy.dir = 'auto';
        content.append(copy);
        return content;
    }
    function renderStudy() {
        const card = studyCard();
        if (!card) return;
        byId('study-title').textContent = deck.title || 'Untitled knowledge set';
        byId('study-count').textContent = `${deck.cards.length} card${deck.cards.length === 1 ? '' : 's'}`;
        byId('position').textContent = `${index + 1} / ${order.length}`;
        const progress = Math.round((index + 1) / order.length * 100);
        byId('progress-bar').style.width = `${progress}%`;
        document.querySelector('.progress').setAttribute('aria-valuenow', progress);
        byId('card-number').textContent = `Card #${deck.cards.indexOf(card) + 1}`;
        byId('side-number').textContent = showingAnswer ? '2 / 2' : '1 / 2';
        byId('flashcard').setAttribute('aria-label', `${showingAnswer ? 'Answer' : 'Question'} side of flashcard. Press Space or Enter to flip.`);
        const content = cardContent(card, showingAnswer);
        if (studentMode) {
            const main=make('div', `main student-card-main${!showingAnswer && card.picture ? ' has-picture' : ''}`);
            const copy=make('div','student-question-copy');copy.append(content.querySelector('.card-text'));
            const picture=content.querySelector('.picture-button');if(picture)main.append(picture);
            main.append(copy);byId('card-content').replaceChildren(main);
        } else {
            byId('card-content').className = content.className;
            byId('card-content').replaceChildren(...content.childNodes);
        }
        byId('additional-panel').hidden = !showingAnswer || !hasInformation(card);
        byId('additional-text').textContent = card.additionalInformation;
        if(studentMode)fitStudentStudy();
        for (const rating of ['known', 'almost', 'learning']) {
            byId(`${rating}-count`).textContent = deck.cards.filter(item => ratings[item.id] === rating).length;
        }
    }
    function fitStudentStudy() {
        if(!studentMode || stage!=='study')return;
        const text=byId('card-content').querySelector('.card-text');
        if(text)window.PeninaStudyLayout.fitText(text);
        window.PeninaStudyLayout.fitText(byId('additional-text'));
    }
    if(studentMode) {
        window.addEventListener('resize',fitStudentStudy);
        if(document.fonts)document.fonts.ready.then(fitStudentStudy);
    }
    function move(amount) {
        if (!order.length) return;
        index = (index + amount + order.length) % order.length;
        showingAnswer = false;
        renderStudy();
    }
    function flip() {if (studyCard()) {showingAnswer = !showingAnswer; renderStudy();}}
    async function openPicture(value, trigger) {
        const source = trigger.querySelector('img');
        pictureTrigger = trigger;
        pictureZoomStep = 0;
        pictureDisplayWidth = source.getBoundingClientRect().width || source.naturalWidth;
        pictureAspectRatio = source.naturalWidth / source.naturalHeight || 1;
        const container = byId('enlarged-picture'), dialog = byId('picture-dialog');
        const image = pictureImage(value);
        container.replaceChildren(image);
        addMarkers(container, value);
        fitPicture();
        dialog.showModal();
        container.focus({preventScroll: true});
        try {await image.decode();} catch (_) {
            if (dialog.open && container.firstElementChild === image) {dialog.close(); message('This picture could not be opened.', true);}
            return;
        }
        if (dialog.open && container.firstElementChild === image) {
            pictureAspectRatio = image.naturalWidth / image.naturalHeight;
            fitPicture();
        }
    }
    function fitPicture() {
        const width = Math.max(1, (window.visualViewport?.width || innerWidth) - 32);
        const height = Math.max(1, (window.visualViewport?.height || innerHeight) - 112);
        const limit = Math.min(width, height * pictureAspectRatio);
        const renderedWidth = Math.min(pictureDisplayWidth * pictureZoomSteps[pictureZoomStep], limit);
        const canEnlarge = pictureZoomStep < pictureZoomSteps.length - 1 && renderedWidth < limit - 1;
        const container = byId('enlarged-picture');
        container.style.width = `${renderedWidth}px`;
        container.classList.toggle('zoom-limit', !canEnlarge);
        container.setAttribute('aria-disabled', String(!canEnlarge));
        container.setAttribute('aria-label', canEnlarge ? 'Enlarge picture further' : 'Picture at maximum size');
        byId('picture-zoom-hint').hidden = !canEnlarge;
        return canEnlarge;
    }
    function fitPrint() {
        let overflow = false;
        document.querySelectorAll('.paper-card:not(.paper-empty)').forEach(card => {
            const content = card.querySelector('.paper-content');
            const text = card.querySelector('.card-text');
            const info = card.querySelector('.paper-information');
            const heading = info?.querySelector('h3');
            const style = getComputedStyle(card);
            const availableHeight = card.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            const availableWidth = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const image = card.querySelector('.paper-image img');
            if (image?.naturalWidth && image.naturalHeight) {
                const row = card.querySelector('.card-content');
                const columnWidth = (row.clientWidth - parseFloat(getComputedStyle(row).columnGap)) / 2;
                const aspect = image.naturalWidth / image.naturalHeight;
                // Fill the picture column without cropping; keep space around the image and target.
                image.style.width = `${Math.min(columnWidth, availableHeight * .94 * aspect)}px`;
            }
            const elements = [text, info, heading].filter(Boolean);
            elements.forEach(element => {element.style.fontSize = '';});
            const sizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
            const scaleTo = scale => elements.forEach((element, i) => {
                element.style.fontSize = `${Math.max(12, sizes[i] * scale)}px`;
            });
            const fits = () => content.scrollHeight <= availableHeight + 1
                && content.scrollWidth <= availableWidth + 1
                && text.scrollWidth <= text.clientWidth + 1;
            // Start at the generous size for this layout, then shrink only as much as needed.
            // Scale additional information proportionally so shrinking never makes it larger.
            if (!fits()) {
                scaleTo(0);
                if (fits()) {
                    let low = 0, high = 1;
                    for (let step = 0; step < 10; step++) {
                        const middle = (low + high) / 2;
                        scaleTo(middle);
                        if (fits()) low = middle;
                        else high = middle;
                    }
                    scaleTo(low);
                }
            }
            if (!fits()) overflow = true;
        });
        byId('print-warning').textContent = overflow ? 'Some content is too long for this layout. Choose fewer cards per page or shorten those cards before printing.' : '';
        byId('print-warning').classList.toggle('error', overflow);
        byId('print-now').disabled = overflow;
    }
    function renderPrint() {
        document.body.dataset.printLayout = 'cards';
        const count = Number(byId('cards-per-page').value);
        const pages = printSheets(deck.cards, count);
        const orientation = count === 2 ? 'portrait' : 'landscape';
        const flipEdge = orientation === 'landscape' ? 'short' : 'long';
        byId('print-pages').dataset.orientation = orientation;
        byId('print-page-style').textContent = `@page{size:letter ${orientation};margin:0}`;
        // Both settings turn the sheet around its vertical edge, matching the mirrored backs.
        byId('print-instructions').textContent = `Print double-sided, flip on the ${flipEdge} edge, use 100% scale, and turn off headers and footers. Cut along the dotted lines.`;
        byId('print-pages').replaceChildren();
        pages.forEach((page, pageIndex) => {
            const caption = make('p', 'sheet-caption', `Sheet ${Math.floor(pageIndex / 2) + 1} · ${page.side === 'front' ? 'Fronts' : 'Backs'} · ${count} per page · ${orientation === 'landscape' ? 'Landscape' : 'Portrait'}`);
            const sheet = make('section', 'paper-sheet');
            sheet.dataset.count = count;
            sheet.setAttribute('aria-label', caption.textContent);
            for (const card of page.cards) {
                const cell = make('article', `paper-card${card ? '' : ' paper-empty'}`);
                if (card) {
                    cell.append(make('span', 'paper-number', `#${deck.cards.indexOf(card) + 1}`));
                    const content = make('div', 'paper-content');
                    content.append(cardContent(card, page.side === 'back', true));
                    if (page.side === 'back' && hasInformation(card)) {
                        const info = make('section', 'paper-information');
                        const copy = make('p', '', card.additionalInformation); copy.dir = 'auto';
                        info.append(make('h3', '', 'Additional Information'), copy);
                        content.append(info);
                    }
                    cell.append(content);
                }
                sheet.append(cell);
            }
            byId('print-pages').append(caption, sheet);
        });
        for (const image of byId('print-pages').querySelectorAll('img')) image.addEventListener('load', fitPrint, {once: true});
        requestAnimationFrame(fitPrint);
    }
    byId('card-form').addEventListener('input', () => {dirty = true; scheduleSave();});
    byId('card-form').addEventListener('submit', event => {
        event.preventDefault();
        if (!dirty && !editingId) dirty = true;
        if (commitEditor()) message('Card saved. Add another card or open Electronic Flashcards.');
    });
    byId('set-title').addEventListener('input', () => {deck.title = byId('set-title').value; scheduleSave();});
    byId('new-list').addEventListener('click', async () => {
        if (studentMode || !await confirmAction('Clear the current draft and start a new list?', 'Start New')) return;
        deck = {format: FORMAT, version: 1, title: '', cards: []};
        ratings = {}; order = []; index = 0; showingAnswer = false;
        workflow.reset();
        byId('set-title').value = '';
        openEditor();
        persist();
        byId('set-title').focus();
    });
    byId('new-card').addEventListener('click', () => {if (commitEditor()) {openEditor(); persist(); byId('picture-file').focus();}});
    byId('delete-card').addEventListener('click', async () => {
        if (!await confirmAction('Delete this card from the set?')) return;
        deck.cards = deck.cards.filter(card => card.id !== editingId);
        delete ratings[editingId];
        openEditor();
        persist();
    });
    document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => setStage(button.dataset.stage)));
    byId('picture-file').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        const version = ++uploadVersion;
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 12 * 1024 * 1024) {
            message('Choose a PNG, JPEG, WebP, or GIF picture up to 12 MB.', true); event.target.value = ''; return;
        }
        uploading = true;
        byId('save-card').disabled = true;
        message('Loading picture…');
        try {
            const src = await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
            });
            const image = new Image(); image.src = src; await image.decode();
            if (version !== uploadVersion) return;
            if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Choose a picture with no more than 40 million pixels.');
            picture = {src, alt: byId('picture-alt').value, target: null};
            activeTarget = 0;
            dirty = true;
            renderEditorPicture();
            persist();
            message('Picture added. Click a spot on the picture if you want to add a target.');
        } catch (error) {
            if (version === uploadVersion) message(error.message || 'This picture could not be read. Try another image file.', true);
        } finally {
            if (version === uploadVersion) {uploading = false; byId('save-card').disabled = false; event.target.value = '';}
        }
    });
    function setTargets(targets) {
        if (!picture || targets.length > 5) return;
        picture.target = targets[0] || null;
        if (targets.length > 1) picture.targets = targets;
        else delete picture.targets;
        dirty = true;
        renderEditorPicture();
        persist();
    }
    function updateTarget(target) {
        const targets = pictureTargets(picture).map(value => ({...value}));
        targets[activeTarget] = target;
        setTargets(targets);
    }
    byId('target-select').addEventListener('change', event => {
        activeTarget = Number(event.target.value);
        renderEditorPicture();
    });
    byId('target-surface').addEventListener('click', event => {
        if (!picture) return;
        const box = byId('target-surface').querySelector('img').getBoundingClientRect();
        const hit = pictureTargets(picture).findIndex(target => Math.hypot(event.clientX - box.left - target.x * box.width, event.clientY - box.top - target.y * box.height) <= 16);
        if (hit >= 0) {activeTarget = hit; renderEditorPicture(); return;}
        updateTarget({x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))});
    });
    byId('target-surface').addEventListener('keydown', event => {
        if (!picture || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        const target = {...(pictureTargets(picture)[activeTarget] || {x: .5, y: .5})}, step = event.shiftKey ? .05 : .005;
        if (event.key === 'ArrowLeft') target.x -= step;
        if (event.key === 'ArrowRight') target.x += step;
        if (event.key === 'ArrowUp') target.y -= step;
        if (event.key === 'ArrowDown') target.y += step;
        target.x = Math.max(0, Math.min(1, target.x)); target.y = Math.max(0, Math.min(1, target.y));
        updateTarget(target);
    });
    byId('add-target').addEventListener('click', () => {
        const targets = pictureTargets(picture).map(target => ({...target}));
        if (!picture || targets.length >= 5) return;
        activeTarget = targets.length;
        const [x, y] = [[.5,.5],[.7,.5],[.3,.5],[.5,.3],[.5,.7]][activeTarget];
        setTargets([...targets, {x, y}]);
        byId('target-surface').focus();
    });
    byId('remove-target').addEventListener('click', () => {
        const targets = pictureTargets(picture).filter((_, i) => i !== activeTarget);
        setTargets(targets);
    });
    byId('remove-picture').addEventListener('click', () => {
        uploadVersion++; uploading = false; byId('save-card').disabled = false;
        picture = null; dirty = true; renderEditorPicture(); persist();
    });
    function downloadDraft() {
        if (!commitEditor() || !workflow.leave(stage)) return;
        const blob = new Blob([JSON.stringify(deck, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob), link = make('a');
        link.href = url;
        link.download = `${(deck.title || 'Penina-Knowledge-Cards').replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 80) || 'Penina-Knowledge-Cards'}.json`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    byId('download-draft').addEventListener('click', downloadDraft);
    byId('share-download-draft').addEventListener('click', downloadDraft);
    byId('upload-draft').addEventListener('click', () => byId('draft-file').click());
    byId('draft-file').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
            if (file.size > 60 * 1024 * 1024) throw new Error('Choose a draft smaller than 60 MB.');
            const next = normalizeDeck(JSON.parse(await file.text()));
            for (const card of next.cards) if (card.picture) {
                const image = new Image(); image.src = card.picture.src;
                try {await image.decode();} catch (_) {throw new Error('A picture in this draft could not be opened.');}
                if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('A picture in this draft is too large.');
            }
            if ((deck.cards.length || dirty) && !await confirmAction('Open this draft in place of the current set? Save the current draft first if you want to keep both.')) return;
            deck = next; ratings = {}; workflow.reset();
            byId('set-title').value = deck.title;
            openEditor(deck.cards[0] || null); persist();
            message(`Opened ${deck.cards.length} cards.`);
        } catch (error) {message(error.message || 'This draft could not be opened.', true);}
        finally {event.target.value = '';}
    });
    byId('previous').addEventListener('click', () => move(-1));
    byId('next').addEventListener('click', () => move(1));
    byId('flip').addEventListener('click', flip);
    byId('flashcard').addEventListener('click', flip);
    byId('flashcard').addEventListener('keydown', event => {
        if (event.target === byId('flashcard') && event.key === 'Enter') {event.preventDefault(); flip();}
    });
    byId('shuffle').addEventListener('click', () => {
        for (let i = order.length - 1; i > 0; i--) {const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
        index = 0; showingAnswer = false; renderStudy();
    });
    byId('reset-study').addEventListener('click', () => {ratings = {}; order = deck.cards.map(card => card.id); index = 0; showingAnswer = false; renderStudy();});
    byId('edit-current').addEventListener('click', () => {openEditor(studyCard()); setStage('edit');});
    document.querySelectorAll('[data-rating]').forEach(button => button.addEventListener('click', () => {
        if (studyCard()) {ratings[studyCard().id] = button.dataset.rating; move(1);}
    }));
    document.addEventListener('keydown', event => {
        if (stage !== 'study' || document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'ArrowLeft') {event.preventDefault(); move(-1);}
        if (event.key === 'ArrowRight') {event.preventDefault(); move(1);}
        if (event.key === ' ' && event.target.tagName !== 'BUTTON') {event.preventDefault(); flip();}
    });
    byId('close-picture').addEventListener('click', () => byId('picture-dialog').close());
    byId('enlarged-picture').addEventListener('click', () => {
        if (!fitPicture()) return;
        pictureZoomStep++;
        fitPicture();
    });
    byId('picture-dialog').addEventListener('click', event => {
        if (event.target === byId('picture-dialog')) byId('picture-dialog').close();
    });
    byId('picture-dialog').addEventListener('close', () => {
        if (pictureTrigger?.isConnected) pictureTrigger.focus({preventScroll: true});
        pictureTrigger = null;
    });
    const resizePicture = () => {if (byId('picture-dialog').open) fitPicture();};
    window.addEventListener('resize', resizePicture);
    window.visualViewport?.addEventListener('resize', resizePicture);
    byId('cards-per-page').addEventListener('change', renderPrint);
    byId('print-now').addEventListener('click', async () => {
        await Promise.all(Array.from(byId('print-pages').querySelectorAll('img'), image => image.decode().catch(() => {})));
        fitPrint();
        if (!byId('print-now').disabled) window.print();
    });
    byId('print-sheet-now').addEventListener('click', () => {renderSheet(); window.print();});
    window.addEventListener('beforeprint', () => {
        if (stage === 'sheet') {renderSheet(); return;}
        if (stage === 'edit') commitEditor();
        if (stage !== 'print') renderPrint();
        fitPrint();
    });
    function renderSheet() {
        document.body.dataset.printLayout = 'sheet';
        byId('print-page-style').textContent = '@page{size:letter portrait;margin:.4in}';
        const root = byId('knowledge-sheet'), title = make('h1', '', deck.title || 'Knowledge Sheet'); title.dir = 'auto';
        const table = make('table'), head = make('thead'), header = make('tr'), body = make('tbody');
        const includeInformation = deck.cards.some(hasInformation);
        for (const label of ['Question','Answer',...(includeInformation ? ['Additional Information'] : [])]) {const th=make('th','',label);th.scope='col';header.append(th);}
        head.append(header);
        for (const card of deck.cards) {
            const row=make('tr'), question=make('td'), answer=make('td','',card.answer);answer.dir='auto';
            question.append(cardContent(card,false,true));row.append(question,answer);
            if(includeInformation){const info=make('td','',card.additionalInformation);info.dir='auto';row.append(info);}
            body.append(row);
        }
        table.append(head,body);root.replaceChildren(title,table);
    }
    workflow = window.PeninaKnowledgeWorkflow.mount({
        getDeck: () => deck, studentMode, setStage, renderQuestion: card => cardContent(card,false),
        changed: () => {if(editingId)openEditor(deck.cards.find(card=>card.id===editingId));persist();}
    });
    async function initialize() {
        if (studentMode) {
            try {
                const saved=JSON.parse(embedded.textContent);deck=normalizeDeck(saved.deck);
                document.body.dataset.student='true';
                if(document.querySelector('.brand h1'))document.querySelector('.brand h1').textContent=deck.title;
                if(byId('student-practice'))byId('student-practice').hidden=!workflow.hasPractice();
                const nav=document.querySelector('.workflow-nav');nav.replaceChildren();
                for(const [name,label] of [['study','Flashcards'],['quiz','Practice'],['sheet','Knowledge Sheet'],['print','Paper Flashcards']]) {
                    if(name==='quiz' && !workflow.hasPractice())continue;
                    const button=make('button','',label);button.type='button';button.dataset.stage=name;button.onclick=()=>setStage(name);nav.append(button);
                }
                if(typeof saved.homeUrl==='string' && /^\/(?!\/)/.test(saved.homeUrl)){
                    const link=make('a','home-link');link.innerHTML=window.PeninaStudyLayout.classHomeButtonContent;link.target='_blank';link.rel='noopener';link.href='https://www.penina-hebrew.org'+saved.homeUrl;app.prepend(link);
                }
                const language=window.PeninaKnowledgeCards.practiceCards(deck,'english').length?'english':'hebrew';byId('quiz-language').value=language;
                setStage(['print','sheet','quiz'].includes(location.hash.slice(1))?location.hash.slice(1):'study');
            } catch (_) {byId('save-status').textContent='This knowledge set could not be opened.';byId('edit-stage').hidden=true;}
            return;
        }
        app.inert = true;
        try {
            db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('penina-knowledge-builder', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('drafts');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Storage blocked'));
            });
            const saved = await new Promise((resolve, reject) => {
                const request = db.transaction('drafts').objectStore('drafts').get('current');
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            if (saved) {
                deck = normalizeDeck(saved.deck);
                if (saved.deck.title === '') deck.title = '';
                byId('set-title').value = deck.title;
                const editor = saved.editor;
                openEditor(deck.cards.find(card => card.id === editor?.editingId) || null);
                if (editor?.dirty) {
                    byId('question').value = editor.question || '';
                    byId('answer').value = editor.answer || '';
                    byId('additional-information').value = editor.additionalInformation || '';
                    picture = editor.picture || null;
                    byId('picture-alt').value = picture?.alt || '';
                    dirty = true;
                    renderEditorPicture();
                }
                storageMessage('Restored your draft from this browser.');
            }
        } catch (_) {storageMessage('Browser saving is unavailable. Save your draft to keep your work.', true);}
        finally {app.inert = false; renderList();}
    }
    initialize();
})();

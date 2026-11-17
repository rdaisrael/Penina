(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./cards') : root.PeninaKnowledgeCards);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PeninaRichText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cards) {
    'use strict';
    const {normalizeTextFormat} = cards;
    function mountEditor(element) {
        const document = element.ownerDocument, toolbar = document.createElement('div');
        toolbar.className = 'text-format-toolbar'; toolbar.setAttribute('role','toolbar');
        toolbar.setAttribute('aria-label', `${element.getAttribute('aria-label') || element.id} formatting`);
        let savedRange = null;
        const block = node => node?.nodeType === 1 && (node.hasAttribute('data-rich-paragraph') || /^(DIV|P|LI|H[1-6])$/.test(node.tagName));
        const direction = node => ['rtl','ltr'].includes(node?.getAttribute?.('dir')) ? node.getAttribute('dir') : 'auto';
        const alignment = node => ['left','right','center'].includes(node?.style?.textAlign) ? node.style.textAlign : 'start';
        function get() {
            const paragraphs = []; let current = null;
            const start = style => current ||= {runs:[],direction:style.direction,align:style.align};
            const finish = () => {if (current) paragraphs.push(current); current = null;};
            function text(value, bold, style) {
                const parts = value.replace(/\r\n?/g,'\n').split('\n');
                parts.forEach((part,index) => {
                    if (index) {finish(); start(style);}
                    if (part) start(style).runs.push({text:part,bold});
                });
            }
            function walk(node, bold, style) {
                if (node.nodeType === 3) {text(node.textContent,bold,style); return;}
                if (node.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|SVG|IMG)$/.test(node.tagName)) return;
                if (node.tagName === 'BR') {
                    start(style);
                    if (node.parentNode.childNodes.length !== 1) {finish(); start(style);}
                    return;
                }
                const isBlock = block(node);
                if (isBlock) {finish(); style = {direction:direction(node),align:alignment(node)}; start(style);}
                const weight = node.style.fontWeight;
                const strong = weight ? weight === 'bold' || Number(weight) >= 600 : bold || /^(B|STRONG)$/.test(node.tagName);
                for (const child of node.childNodes) walk(child,strong,style);
                if (isBlock) finish();
            }
            const style = {direction:'auto',align:'start'};
            for (const child of element.childNodes) walk(child,false,style);
            finish();
            const value = paragraphs.map(p => p.runs.map(run => run.text).join('')).join('\n').trim();
            return {text:value, format:normalizeTextFormat(value,{paragraphs})};
        }
        function set(value, format) {
            const normalized = normalizeTextFormat(value,format);
            const paragraphs = normalized?.paragraphs || String(value || '').split('\n').map(text=>({runs:[{text,bold:false}],direction:'auto',align:'start'}));
            element.replaceChildren(...paragraphs.map(paragraph => {
                const node = document.createElement('div'); node.dataset.richParagraph = '';
                node.dir = paragraph.direction; node.style.textAlign = paragraph.align;
                for (const run of paragraph.runs) {
                    if (run.bold) {const bold=document.createElement('strong');bold.textContent=run.text;node.append(bold);}
                    else node.append(document.createTextNode(run.text));
                }
                if (!node.textContent) node.append(document.createElement('br'));
                return node;
            }));
            savedRange = null; update();
        }
        function remember() {
            const selection = document.getSelection();
            if (selection.rangeCount && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) savedRange = selection.getRangeAt(0).cloneRange();
        }
        function restore() {
            element.focus({preventScroll:true});
            const selection=document.getSelection();
            if (savedRange && element.contains(savedRange.startContainer) && element.contains(savedRange.endContainer)) {
                selection.removeAllRanges(); selection.addRange(savedRange);
            } else {const range=document.createRange();range.selectNodeContents(element);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
        }
        function selectedParagraphs() {
            // Browsers can leave text at the root after typing/paste. Wrap those nodes
            // without replacing them so an active text selection remains valid.
            const selection=document.getSelection(),range=selection.rangeCount?selection.getRangeAt(0):null;
            if (!range) return [];
            const startNode=range.startContainer,startOffset=range.startOffset,endNode=range.endContainer,endOffset=range.endOffset;
            let paragraph;
            for (const child of [...element.childNodes]) {
                if (block(child)) {paragraph=null; continue;}
                if (!paragraph) {paragraph=document.createElement('div');paragraph.dataset.richParagraph='';element.insertBefore(paragraph,child);}
                paragraph.append(child);
            }
            if (startNode.nodeType===3 && endNode.nodeType===3) {
                range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset);
                selection.removeAllRanges();selection.addRange(range);
            }
            const nodes=[...element.querySelectorAll('[data-rich-paragraph], div, p')].filter(node=>![...node.children].some(block));
            if (range.collapsed) {
                const anchor=range.startContainer===element ? element.childNodes[Math.min(range.startOffset,element.childNodes.length-1)] : range.startContainer;
                return nodes.filter(node=>node===anchor || node.contains(anchor));
            }
            return nodes.filter(node=>{
                if (!range.intersectsNode(node)) return false;
                const probe=document.createRange();probe.selectNodeContents(node);
                return range.compareBoundaryPoints(Range.END_TO_START,probe)<0 && range.compareBoundaryPoints(Range.START_TO_END,probe)>0;
            });
        }
        const controls = [
            ['bold','B','Bold selected text'], ['auto','Auto','Automatic paragraph direction'],
            ['ltr','LTR','Left-to-right paragraph'], ['rtl','RTL','Right-to-left paragraph'],
            ['left','Left','Align left'], ['center','Center','Align center'], ['right','Right','Align right']
        ];
        function update() {
            const selection=document.getSelection();
            const active=selection.rangeCount && element.contains(selection.anchorNode);
            let anchor=active ? selection.anchorNode : null;
            if (anchor===element) anchor=element.childNodes[Math.min(selection.anchorOffset,element.childNodes.length-1)];
            let paragraph=anchor?.nodeType===3 ? anchor.parentElement : anchor;
            while (paragraph && paragraph!==element && !block(paragraph)) paragraph=paragraph.parentElement;
            for (const button of toolbar.children) {
                const action=button.dataset.format;
                const pressed=active && (action==='bold' ? document.queryCommandState('bold') : ['auto','ltr','rtl'].includes(action) ? direction(paragraph)===action : alignment(paragraph)===action);
                button.setAttribute('aria-pressed',String(Boolean(pressed)));
            }
        }
        function apply(action) {
            restore();
            if (action==='bold') document.execCommand('bold',false);
            else for (const paragraph of selectedParagraphs()) {
                if (['ltr','rtl','auto'].includes(action)) paragraph.dir=action;
                else paragraph.style.textAlign=action;
            }
            remember(); update(); element.dispatchEvent(new Event('input',{bubbles:true}));
        }
        for (const [action,text,label] of controls) {
            const button=document.createElement('button');button.type='button';button.textContent=text;
            button.dataset.format=action;button.setAttribute('aria-label',label);button.title=label;
            button.addEventListener('mousedown',event=>{remember();event.preventDefault();});
            button.addEventListener('click',()=>apply(action));toolbar.append(button);
        }
        element.before(toolbar);
        document.addEventListener('selectionchange',()=>{remember();update();});
        element.addEventListener('keydown',event=>{
            if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='b') {event.preventDefault();remember();apply('bold');}
        });
        // Only plain text is accepted from the clipboard/drag source; the toolbar
        // creates the allowlisted formatting. Pasted HTML never runs or persists.
        element.addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
        element.addEventListener('drop',event=>{event.preventDefault();document.execCommand('insertText',false,event.dataTransfer.getData('text/plain'));});
        set('');
        return {get,set};
    }
    return {mountEditor};
});

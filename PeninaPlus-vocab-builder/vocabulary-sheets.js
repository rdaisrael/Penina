(function () {
    'use strict';
    const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const displayValue = value => String(value === undefined || value === null ? '' : value).trim().toLowerCase() === 'n' ? '' : String(value || '');

    function sanitizeCards(cards) {
        return (Array.isArray(cards) ? cards : []).map(card => ({
            ...card,
            term: displayValue(card.term),
            hebrew: displayValue(card.hebrew),
            english: displayValue(card.english),
            contextQuote: displayValue(card.contextQuote),
            sourceHebrew: displayValue(card.sourceHebrew),
            hebrewTranslation: displayValue(card.hebrewTranslation),
            englishTranslation: displayValue(card.englishTranslation),
            sourceEnglish: displayValue(card.sourceEnglish)
        }));
    }

    function renderPages(document, data) {
        const options = data.options || {};
        const cards = sanitizeCards(data.cards);
        const size = Math.max(10, Math.min(24, Number(options.fontSize) || 14));
        const scale = 3, margin = 44, width = 524, bottom = 742;
        const columns = options.context === false ? [140,384] : [100,144,280];
        const pages = [];
        let canvas, ctx, y;
        function newPage() {
            canvas = document.createElement('canvas');
            canvas.width = 612 * scale; canvas.height = 792 * scale;
            canvas.setAttribute('aria-hidden', 'true');
            ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
            ctx.fillStyle = '#fff'; ctx.fillRect(0,0,612,792);
            pages.push(canvas); y = 42;
            const titleLines = lines(data.title, width - 20, 18, true);
            const titleHeight = titleLines.length * 23 + 18;
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(margin,y,width,titleHeight);
            titleLines.forEach((line,index) => draw(line, margin+10, y+10+index*23, width-20, 18, true, '#fff'));
            y += titleHeight;
            let x = margin;
            ['Term','Translation','Context'].slice(0,columns.length).forEach((text,i) => {
                ctx.fillStyle='#f4efe6';ctx.fillRect(x,y,columns[i],26);
                draw(text,x+8,y+6,columns[i]-16,11,true);
                x += columns[i];
            });
            y += 26;
            draw('Generated with Penina-Hebrew Suite',margin,763,width-55,8,false,'#60666f');
            draw(String(pages.length),margin+width-35,763,35,8,false,'#60666f');
        }
        function font(fontSize,bold) {ctx.font=`${bold?'bold ':''}${fontSize}px Arial, sans-serif`;}
        function lines(value, available, fontSize, bold) {
            font(fontSize,bold);
            const result=[];
            for (const paragraph of String(value || '').split(/\r?\n/)) {
                let line='';
                for (const word of paragraph.split(/\s+/).filter(Boolean)) {
                    const candidate=line ? line+' '+word : word;
                    if(ctx.measureText(candidate).width <= available) {line=candidate;continue;}
                    if(line) {result.push(line);line='';}
                    // Split an unusually long token without dropping any characters.
                    const segments = typeof Intl.Segmenter === 'function'
                        ? Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word),part=>part.segment)
                        : Array.from(word);
                    for(const character of segments) {
                        if(line && ctx.measureText(line+character).width > available) {result.push(line);line='';}
                        line+=character;
                    }
                }
                result.push(line);
            }
            return result;
        }
        function draw(text,x,top,available,fontSize,bold,color='#222',direction) {
            font(fontSize,bold);ctx.fillStyle=color;ctx.textBaseline='top';
            const rtl=direction ? direction==='rtl' : /[\u0590-\u05ff]/.test(text);
            ctx.direction=rtl?'rtl':'ltr';ctx.textAlign=rtl?'right':'left';
            ctx.fillText(text,rtl?x+available:x,top);
        }
        function cell(blocks, available) {
            const result=[];
            blocks.filter(block=>block.text).forEach((block,index) => {
                if(index)result.push({text:'',height:10,size:10});
                lines(block.text,available-16,block.size,block.bold).forEach(text => {
                    result.push({...block,text,height:block.size*1.6});
                });
            });
            return result;
        }
        newPage();
        cards.forEach(card => {
            const definitions=[];
            if(options.hebrew!==false)definitions.push({text:card.hebrew,size,bold:false});
            if(options.english!==false)definitions.push({text:card.english,size:size*.86,bold:false});
            const context=[{text:card.contextQuote,size:size*.95}];
            if(options.hebrew!==false)context.push({text:card.hebrewTranslation,size:size*.86});
            if(options.english!==false)context.push({text:card.englishTranslation,size:size*.8});
            const cells=[cell([{text:card.term,size,bold:true}],columns[0]),cell(definitions,columns[1])];
            if(columns.length===3) {
                const items=cell(context,columns[2]);
                const citationWidth=(columns[2]-24)/2;
                const hebrew=card.sourceHebrew ? lines(card.sourceHebrew,citationWidth,9,false) : [];
                const english=options.english!==false && card.sourceEnglish ? lines(card.sourceEnglish,citationWidth,9,false) : [];
                const count=Math.max(hebrew.length,english.length);
                if(count)items.push({text:'',height:10,size:10});
                for(let i=0;i<count;i++)items.push({citation:true,hebrew:hebrew[i]||'',english:english[i]||'',height:12,size:9});
                cells.push(items);
            }
            const height=Math.max(30,...cells.map(items=>items.reduce((total,item)=>total+item.height,16)));
            if(y+height>bottom && height<=bottom-130) newPage();
            // An exceptionally long row continues across pages, keeping all its text.
            do {
                const available=bottom-y-16;
                const chunks=cells.map(items=>{
                    let used=0,count=0;
                    while(count<items.length && used+items[count].height<=available)used+=items[count++].height;
                    return {items:items.splice(0,count),height:used};
                });
                const rowHeight=Math.max(30,...chunks.map(chunk=>chunk.height+16));
                if(!chunks.some(chunk=>chunk.items.length) && cells.some(items=>items.length)) {newPage();continue;}
                let x=margin;
                chunks.forEach((chunk,index)=>{
                    ctx.strokeStyle='#c8c5bf';ctx.lineWidth=.5;ctx.strokeRect(x,y,columns[index],rowHeight);
                    let top=y+8;
                    const citationHeight=chunk.items.filter(item=>item.citation).reduce((sum,item)=>sum+item.height,0);
                    let citationTop=y+rowHeight-8-citationHeight;
                    chunk.items.forEach(item=>{
                        if(item.citation) {
                            const half=(columns[index]-24)/2;
                            draw(item.english,x+8,citationTop,half,item.size,false,'#666','ltr');
                            draw(item.hebrew,x+16+half,citationTop,half,item.size,false,'#666','rtl');
                            citationTop+=item.height;
                        } else {draw(item.text,x+8,top,columns[index]-16,item.size,item.bold);top+=item.height;}
                    });
                    x+=columns[index];
                });
                y+=rowHeight;
                if(cells.some(items=>items.length))newPage();
            }while(cells.some(items=>items.length));
        });
        return pages;
    }

    function renderTable(cards, options = {}) {
        const block = (value, language, className = '') => {
            const text = displayValue(value);
            return text ? `<p class="${className}" lang="${language}" dir="${language === 'he' ? 'rtl' : 'auto'}">${escapeHtml(text)}</p>` : '';
        };
        const rows = (Array.isArray(cards) ? cards : []).map(card => {
            const definitions = (options.hebrew !== false ? block(card.hebrew, 'he') : '')
                + (options.english !== false ? block(card.english, 'en') : '');
            const context = block(card.contextQuote, 'he')
                + (options.hebrew !== false ? block(card.hebrewTranslation, 'he') : '')
                + (options.english !== false ? block(card.englishTranslation, 'en') : '')
                + '<div class="citations">'
                + (options.english !== false ? block(card.sourceEnglish, 'en') : '')
                + block(card.sourceHebrew, 'he') + '</div>';
            return `<tr><td class="term">${block(card.term, 'he')}</td><td>${definitions}</td>${options.context !== false ? `<td class="context">${context}</td>` : ''}</tr>`;
        }).join('');
        return `<table><colgroup>${options.context !== false ? '<col style="width:20%"><col style="width:28%"><col style="width:52%">' : '<col style="width:28%"><col style="width:72%">'}</colgroup><thead><tr><th scope="col">Term</th><th scope="col">Translation</th>${options.context !== false ? '<th scope="col">Context</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    // Printing uses the flowing HTML table; canvas pages are created only for PDF downloads.
    async function start() {
        const status = document.getElementById('status');
        const print = document.getElementById('print');
        const download = document.getElementById('download');
        const printSheet = async () => {
            if (document.fonts) await document.fonts.ready;
            window.print();
        };
        print.onclick = printSheet;
        download.onclick = async () => {
            download.disabled = true;
            status.textContent = 'Preparing PDF…';
            try {
                if (!window.PDFLib) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = '/PeninaPlus-vocab-builder/vendor/pdf-lib.min.js';
                        script.onload = resolve;
                        script.onerror = () => { script.remove(); reject(new Error('PDF tools could not load. Please try again.')); };
                        document.head.appendChild(script);
                    });
                }
                if (document.fonts) await document.fonts.ready;
                const data = JSON.parse(document.getElementById('peninaSheetData').textContent);
                const pages = renderPages(document, data);
                const pdf = await window.PDFLib.PDFDocument.create();
                pdf.setTitle(data.title); pdf.setCreator('Penina-Hebrew Suite');
                for (const canvas of pages) {
                    const image = await pdf.embedPng(canvas.toDataURL('image/png'));
                    pdf.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
                }
                const url = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
                const link = document.createElement('a'); link.href = url;
                link.download = (String(data.title).replace(/[\\/:*?"<>|]+/g, '').trim() || 'Vocabulary') + ' - Sheets.pdf';
                document.body.appendChild(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                status.textContent = 'PDF downloaded. Use Print Sheets for scalable printing.';
            } catch (error) {
                status.textContent = error.message || 'The PDF could not be created. Please try again.';
            } finally { download.disabled = false; }
        };
        status.textContent = 'Use Print Sheets, then adjust Scale in your browser’s print dialog.';
        const action = new URLSearchParams(window.location.search).get('action');
        if (action === 'download') await download.onclick();
        if (action === 'print') await printSheet();
    }

    function makeSheet(title, cards, options = {}) {
        const data = JSON.stringify({ title, cards, options }).replace(/</g, '\\u003c');
        const fontSize = Math.max(10, Math.min(24, Number(options.fontSize) || 14));
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Vocabulary Sheets</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eeeae3;color:#263344;font:16px Arial,sans-serif}
.toolbar{max-width:900px;margin:20px auto;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:white;border-radius:12px}
button{padding:12px 18px;border:1px solid #b8bdc5;border-radius:8px;background:white;font:inherit;cursor:pointer}button.primary{background:#4353ff;color:white;border-color:#4353ff}#status{width:100%;margin:0;line-height:1.5}
.sheet{max-width:900px;margin:0 auto 24px;padding:32px;background:white;font-size:${fontSize}pt;line-height:1.5}h1{font-size:1.5em;line-height:1.3;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #c8c5bf;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#f4efe6;text-align:left;font-size:.85em}.term{width:20%;font-weight:bold}p{margin:0;white-space:pre-wrap}td p+p{margin-top:.65em}.context{font-size:.9em}.citations{display:flex;justify-content:space-between;gap:12px;font-size:.7em;color:#555;margin-top:10px}.citations p{flex:1;margin:0}footer{margin-top:20px;font-size:9pt;color:#60666f}
@page{size:letter;margin:.75in}
@media print{html,body{margin:0;background:white}.toolbar{display:none!important}.sheet{max-width:none;width:100%;padding:0;margin:0}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}h1{break-after:avoid}table{overflow:visible}th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="toolbar"><button id="print" class="primary" type="button">Print Sheets</button><button id="download" type="button">Download Sheets (PDF)</button><p id="status" role="status">Use Print Sheets, then adjust Scale in your browser’s print dialog.</p></div>
<main class="sheet"><h1>${escapeHtml(title)}</h1>${renderTable(cards, options)}<footer>Generated with Penina-Hebrew Suite</footer></main>
<script id="peninaSheetData" type="application/json">${data}</script><script>(() => { const displayValue = ${displayValue.toString()}; const sanitizeCards = ${sanitizeCards.toString()}; const renderPages = ${renderPages.toString()}; return (${start.toString()})(); })();</script></body></html>`;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { makeSheet, renderTable, renderPages };
})();

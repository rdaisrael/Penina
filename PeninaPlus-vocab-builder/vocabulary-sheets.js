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

    function makeSheet(title, cards, options = {}) {
        const data = JSON.stringify({title, cards, options}).replace(/</g, '\\u003c');
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Vocabulary Sheets</title>
<style>*{box-sizing:border-box}body{margin:0;background:#eeeae3;color:#263344;font:16px Arial,sans-serif}.toolbar{max-width:816px;margin:20px auto;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:white;border-radius:12px}h1{font-size:20px;margin:0;flex:1 1 100%}button{padding:12px 18px;border:1px solid #b8bdc5;border-radius:8px;background:white;font:inherit;cursor:pointer}button.primary{background:#4353ff;color:white;border-color:#4353ff}button:disabled{opacity:.6;cursor:wait}#status{width:100%;margin:0;line-height:1.5}.pages{max-width:816px;margin:auto}.pages canvas{display:block;width:100%;height:auto;background:white;margin:0 auto 24px;box-shadow:0 3px 16px #0002}.accessible-sheet{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@page{size:letter;margin:0}@media print{body{background:white}.toolbar,.accessible-sheet{display:none}.pages{max-width:none}.pages canvas{width:8.5in;height:11in;margin:0;box-shadow:none;break-after:page;page-break-after:always}.pages canvas:last-child{break-after:auto;page-break-after:auto}}</style></head><body>
<div class="toolbar"><h1>${escapeHtml(title)}</h1><button id="download" class="primary" disabled>Download Sheets (PDF)</button><button id="print" disabled>Print Sheets</button><p id="status" role="status">Preparing vocabulary sheets…</p></div><main id="pages" class="pages" aria-label="Vocabulary sheet preview"></main><div id="accessible-sheet" class="accessible-sheet"></div>
<script id="peninaSheetData" type="application/json">${data}</script><script src="/PeninaPlus-vocab-builder/vendor/pdf-lib.min.js"></script><script src="/PeninaPlus-vocab-builder/vocabulary-sheets.js"></script></body></html>`;
    }

    // Layout uses points; rendering at 3 pixels per point keeps preview, printing,
    // and downloaded PDFs identical and lets the browser shape Hebrew text.
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

    async function start() {
        const data = JSON.parse(document.getElementById('peninaSheetData').textContent);
        data.cards = sanitizeCards(data.cards);
        const status = document.getElementById('status');
        const download = document.getElementById('download');
        const print = document.getElementById('print');
        try {
            await document.fonts.ready;
            const pages = renderPages(document,data);
            pages.forEach(page => document.getElementById('pages').appendChild(page));
            document.getElementById('accessible-sheet').innerHTML='<h2>'+escapeHtml(data.title)+'</h2><table><caption>Vocabulary sheet text</caption>'+data.cards.map(card=>'<tr>'+[card.term,data.options.hebrew!==false?card.hebrew:'',data.options.english!==false?card.english:'',...(data.options.context!==false?[card.contextQuote,card.sourceHebrew,data.options.hebrew!==false?card.hebrewTranslation:'',data.options.english!==false?card.englishTranslation:'',data.options.english!==false?card.sourceEnglish:'']:[])].map(value=>'<td>'+escapeHtml(value)+'</td>').join('')+'</tr>').join('')+'</table>';
            const ready=`${pages.length} page${pages.length===1?'':'s'} ready.`;
            status.textContent=ready;download.disabled=false;print.disabled=false;
            download.onclick=async()=>{
                download.disabled=true;status.textContent='Preparing PDF…';
                try {
                    if(!window.PDFLib)throw new Error('PDF tools could not load. Reload this page and try again.');
                    const pdf=await PDFLib.PDFDocument.create();pdf.setTitle(data.title);pdf.setCreator('Penina-Hebrew Suite');
                    for(const canvas of pages) {
                        const png=await pdf.embedPng(canvas.toDataURL('image/png'));
                        pdf.addPage([612,792]).drawImage(png,{x:0,y:0,width:612,height:792});
                    }
                    const url=URL.createObjectURL(new Blob([await pdf.save()],{type:'application/pdf'}));
                    const link=document.createElement('a');link.href=url;
                    link.download=(String(data.title).replace(/[\\/:*?"<>|]+/g,'').trim()||'Vocabulary')+' - Sheets.pdf';
                    document.body.appendChild(link);link.click();link.remove();
                    setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent=ready;
                } catch(error) {status.textContent=error.message||'The PDF could not be created. Please try again.';}
                finally {download.disabled=false;}
            };
            print.onclick=()=>window.print();
            const action=new URLSearchParams(window.location.search).get('action');
            if(action==='download')await download.onclick();
            if(action==='print')requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
        } catch(error) {status.textContent='Unable to prepare the sheets. '+error.message;}
    }
    if(typeof module!=='undefined' && module.exports)module.exports={makeSheet,renderPages};
    if(typeof window!=='undefined' && document.getElementById('peninaSheetData'))start();
})();

/* Shared image presentation: marker coordinates are relative to the actual image. */
'use strict';
const QuizPicture = (() => {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function render(q, editable=false) {
        if (!q.image || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(q.image.src)) return '';
        const marker=q.image.marker;
        return `<figure class="quiz-picture"><div class="picture-frame" ${editable?'data-picture-target tabindex="0" role="button" aria-label="Place marker: click the picture or use arrow keys"':''}><img src="${escape(q.image.src)}" alt="${escape(q.image.alt || 'Question picture')}" draggable="false">${marker?`<span class="picture-marker" style="left:${Number(marker.x)*100}%;top:${Number(marker.y)*100}%" aria-label="Marked location">＋</span>`:''}</div>${marker?'<figcaption>Answer about the location marked with ＋.</figcaption>':''}</figure>`;
    }
    async function read(file) {
        if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Choose a JPG, PNG, or WebP picture.');
        if(file.size>15*1024*1024)throw Error('Choose a picture smaller than 15 MB.');
        const url=URL.createObjectURL(file);
        try {
            const img=new Image();img.src=url;await img.decode();
            const scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));
            const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
            const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
            let src=canvas.toDataURL('image/jpeg',0.85);
            for(const quality of [0.7,0.5,0.35]){if(src.length<=250000)break;src=canvas.toDataURL('image/jpeg',quality);}
            if(src.length>250000)throw Error('This picture is too detailed. Crop it or choose a smaller picture.');
            return {src,alt:'',marker:null};
        } finally {URL.revokeObjectURL(url);}
    }
    return {render,read};
})();

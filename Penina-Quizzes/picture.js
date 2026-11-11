/* Shared image presentation: marker coordinates are relative to the actual image. */
'use strict';
const QuizPicture = (() => {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function render(q, editable=false) {
        if (!q.image || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(q.image.src)) return '';
        const numbered=Array.isArray(q.image.markers), markers=numbered?q.image.markers:[q.image.marker];
        const active=q.markerIndex ?? 0;
        const label=numbered?`Move marker ${active+1}: click the picture or use arrow keys`:'Place marker: click the picture or use arrow keys';
        const pins=markers.map((marker,i)=>marker?`<span class="picture-marker ${numbered?'numbered '+(i===active?'active':'inactive'):''}" style="left:${Number(marker.x)*100}%;top:${Number(marker.y)*100}%" aria-label="${numbered?'Marker '+(i+1)+(i===active?', current question':''):'Marked location'}">${numbered?i+1:'＋'}</span>`:'').join('');
        return `<figure class="quiz-picture"><div class="picture-frame" ${editable?`data-picture-target tabindex="0" role="button" aria-label="${label}"`:''}><img src="${escape(q.image.src)}" alt="${escape(q.image.alt || 'Question picture')}" draggable="false">${pins}</div>${numbered?`<figcaption>Answer about marker <strong>${active+1}</strong> (highlighted).</figcaption>`:q.image.marker?'<figcaption>Answer about the location marked with ＋.</figcaption>':''}</figure>`;
    }
    function group(questions,q){return q.pictureGroup?questions.filter(item=>item.pictureGroup===q.pictureGroup):[q];}
    function addMarker(questions,q){
        if(!q.image)throw Error('Upload a picture first.');
        if(questions.length>=100)throw Error('Use up to 100 questions per quiz.');
        const markers=q.image.markers || [q.image.marker || {x:0.5,y:0.5}];
        if(markers.length>=20)throw Error('Use up to 20 markers per picture.');
        if(questions.reduce((n,item)=>n+(item.image?.src.length||0),0)+q.image.src.length>2500000)throw Error('Use a smaller picture or split this quiz into two quizzes.');
        q.pictureGroup ||= crypto.randomUUID();q.markerIndex ??= 0;
        const members=group(questions,q), next=[...markers,{x:0.2+0.15*(markers.length%5),y:0.25+0.15*Math.floor(markers.length/5)}];
        for(const item of members){item.image={...item.image,marker:null,markers:structuredClone(next)};}
        const added={type:'text',pictureQuestion:true,pictureGroup:q.pictureGroup,markerIndex:next.length-1,image:structuredClone(q.image),prompt:'',answer:'',points:q.points,allowHalfCredit:q.allowHalfCredit===true,extraCredit:q.extraCredit===true,scoringMode:'total',direction:q.direction};
        const last=Math.max(...members.map(item=>questions.indexOf(item)));questions.splice(last+1,0,added);return added;
    }
    function setMarker(questions,q,marker){
        if(!q.image.markers){q.image.marker=marker;return;}
        for(const item of group(questions,q))item.image.markers[q.markerIndex]=structuredClone(marker);
    }
    function removeQuestion(questions,q){
        const members=group(questions,q);
        if(q.image?.markers && q.pictureGroup){
            for(const item of members){if(item===q)continue;item.image.markers.splice(q.markerIndex,1);if(item.markerIndex>q.markerIndex)item.markerIndex--;}
        }
        questions.splice(questions.indexOf(q),1);
    }
    function copyQuestion(q){
        const copy=structuredClone(q);
        // A duplicated question is independent of the original picture group.
        if(copy.image?.markers){copy.image.marker=copy.image.markers[copy.markerIndex];delete copy.image.markers;delete copy.markerIndex;delete copy.pictureGroup;}
        return copy;
    }
    function replaceImage(questions,q,image){
        const members=group(questions,q);
        if(questions.reduce((n,item)=>n+(members.includes(item)?image.src.length:item.image?.src.length||0),0)>2500000)throw Error('Use smaller pictures or split this quiz into two quizzes.');
        for(const item of members)item.image={...structuredClone(image),...(q.image?.markers?{markers:structuredClone(q.image.markers)}:{})};
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
    return {render,read,group,addMarker,setMarker,removeQuestion,copyQuestion,replaceImage};
})();

if(typeof module!=='undefined')module.exports=QuizPicture;

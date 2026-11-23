'use strict';

// Compare dictionary paradigms with a named model, separately for each tense.
// These templates classify forms; they never create an otherwise unattested verb.
const models={
    'פעל שלם':['פעל','כתב',[0,1,2]],
    'פיעל שלם':['פיעל','סדר',[0,1,2]],
    'הפעיל שלם':['הפעיל','כתב',[0,1,2]],
    'התפעל שלם':['התפעל','כתב',[0,1,2]],
    'נפעל שלם':['נפעל','כתב',[0,1,2]],
    'פועל שלם':['פועל','ספר',[0,1,2]],
    'הופעל שלם':['הופעל','כנס',[0,1,2]],
    'פעל ל-ה':['פעל','בנה',[0,1]],
    'פעל ע"ו':['פעל','קומ',[0,2]],
    'פעל חפ"נ':['פעל','נפל',[1,2]],
    'פעל פ"י':['פעל','ישב',[1,2]],
    'פיעל ל-ה':['פיעל','נסה',[0,1]],
    'הפעיל ל-ה':['הפעיל','פנה',[0,1]],
    'הפעיל ע"ו':['הפעיל','קומ',[0,2]],
    'הפעיל פ"י':['הפעיל','ירד',[1,2]]
};
const final=c=>({'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'}[c]||c);
function clusters(word){
    const parts=word.normalize('NFD').replace(/[\u0591-\u05AF\u05BD]/g,'').replace(/\u05C7/g,'\u05B8').replace(/\u05BA/g,'\u05B9').match(/[א-ת][\u05B0-\u05C7]*/g)||[];
    const out=[];
    for(const part of parts){
        const base=final(part[0]),marks=[...part.slice(1)].filter(c=>!['\u05C1','\u05C2'].includes(c)).sort().join('');
        const last=out[out.length-1];
        // Pointed full/defective spellings have the same pattern.
        if(last&&base==='ו'&&marks==='\u05B9'){last.marks+='\u05B9';continue;}
        if(last&&base==='ו'&&marks==='\u05BC'&&!/[\u05B0-\u05BB]/.test(last.marks)){last.marks+='\u05BB';continue;}
        if(last&&base==='י'&&!marks&&last.marks.includes('\u05B4'))continue;
        out.push({base,marks});
    }
    return out;
}
function rootGroup(root,binyan){
    if(root.length!==3)return `${binyan} מרובע`;
    if(root.endsWith('ה'))return `${binyan} ל-ה`;
    if(['פעל','הפעיל','הופעל','נפעל'].includes(binyan)){
        if(/[וי]/.test(root[1]))return `${binyan} ע"ו`;
        if(root[0]==='נ')return `${binyan} חפ"נ`;
        if(root[0]==='י')return `${binyan} פ"י`;
    }
    return `${binyan} שלם`;
}
function forte(binyan,group,tense,slot){
    if(['פיעל','פועל','התפעל'].includes(binyan)&&slot===1)return true;
    if(binyan==='נפעל'&&slot===0&&['עתיד','ציווי','שם הפועל','שם פעולה'].includes(tense))return true;
    return group==='פעל חפ"נ'&&slot===1&&['עתיד','ציווי','שם הפועל'].includes(tense);
}
function matchesModel(form,root,modelForm,model,group,tense){
    const expected=clusters(modelForm),actual=clusters(form);
    if(actual.length!==expected.length)return false;
    const slots=models[group][2];let cursor=0;
    for(const slot of slots){
        const index=expected.findIndex((part,i)=>i>=cursor&&part.base===model.root[slot]);
        if(index<0)return false;
        expected[index]={...expected[index],base:root[slot],slot};cursor=index+1;
    }
    return expected.every((part,i)=>{
        const normalize=marks=>{
            if(part.slot!==undefined&&!forte(model.binyan,group,tense,part.slot))marks=marks.replace(/\u05BC/g,'');
            // Final kaf writes a silent sheva where other final consonants do
            // not. This spelling requirement does not change the paradigm.
            if(part.slot!==undefined&&part.base==='כ'&&i===expected.length-1&&marks==='\u05B0')return '';
            return marks;
        };
        return part.base===actual[i].base&&normalize(part.marks)===normalize(actual[i].marks);
    });
}
function classify(entry,tense,modelEntries){
    const group=rootGroup(entry.root,entry.binyan),baseGroup=models[group]?group:`${entry.binyan} שלם`,spec=models[baseGroup];
    const model=modelEntries.find(item=>item.binyan===spec[0]&&item.root===spec[1]&&item.forms[tense]);
    if(!model)return {group,kind:'exception',reason:'No single reference pattern is established for this form.',model:null};
    const forms=entry.forms[tense];
    const regular=entry.root.length===3&&Object.entries(forms).every(([person,answers])=>
        answers.every(answer=>(model.forms[tense][person]||[]).some(modelForm=>matchesModel(answer,entry.root,modelForm,model,baseGroup,tense))));
    return {group,kind:regular?'standard':'exception',model:model.word,
        reason:regular?'Follows the reference pattern.':`The ${tense} forms differ from the ${model.word} reference pattern.`};
}
module.exports={models,rootGroup,matchesModel,classify};

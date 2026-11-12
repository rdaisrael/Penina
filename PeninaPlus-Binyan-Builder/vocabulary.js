(function(root,factory){
    const api=factory(typeof module==='object'&&module.exports?require('../PeninaPlus-Reader/reader-core'):root.ReaderCore);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.BinyanVocabulary=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(reader){
    function prepare(result,request){
        const profile={...request.vocabulary,mode:'upload',words:[],forms:request.vocabulary.forms||request.vocabulary.binyanim};
        return {...result,questions:result.questions.map(q=>{
            if(!['sentence','writing'].includes(q.exercise))return {...q,sentenceWords:[],notes:[]};
            if(!q.words&&request.footnotes==='none')return {...q,sentenceWords:[],notes:[]};
            if(!Array.isArray(q.words)||!Array.isArray(q.phrases))throw new Error('Sentence vocabulary is incomplete. Please build the worksheet again.');
            if(q.words.length>80||q.phrases.length>40||[...q.words,...q.phrases].some(item=>!item||typeof item.translation!=='string'||!item.translation.trim()||item.translation.length>160||typeof item.word!=='string'||item.word.length>400))throw new Error('Sentence vocabulary notes are invalid. Please build the worksheet again.');
            if(q.phrases.some(p=>!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end>q.words.length||p.end-p.start<2))throw new Error('Sentence vocabulary phrase indexes are invalid. Please build the worksheet again.');
            // Reader's analysis contract includes a title. Add a synthetic title here
            // and remove it afterwards; the exercise blank never becomes a token.
            const title='תרגול\n',text=title+q.sentence;
            const analysis=reader.validateAnalysis({text,words:[
                {word:'תרגול',mastered:false,translation:'Practice',match:'',form:'',isName:true},
                ...q.words
            ],phrases:q.phrases.map(p=>({...p,start:p.start+1,end:p.end+1}))},profile,text);
            const checked=reader.buildResult(text,analysis);
            return {...q,sentenceWords:checked.words.slice(1).map(word=>({...word,start:word.start-title.length})),notes:checked.notes};
        })};
    }
    return {prepare};
});

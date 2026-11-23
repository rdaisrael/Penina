'use strict';
(function(root,factory){if(typeof module==='object' && module.exports)module.exports=factory();else root.QuizRecordingSettings=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
    const DEFAULT_MINUTES=3,MINUTE_OPTIONS=Object.freeze([3,5,10]);
    const MAX_BYTES=32000000,UPLOAD_BYTES=2000000,PART_BYTES=1500000;
    const minutes=q=>q.recordingMinutes ?? DEFAULT_MINUTES;
    const validMinutes=value=>MINUTE_OPTIONS.includes(value);
    // Already-published questions retain the limit they were assigned with.
    const validStoredMinutes=value=>Number.isInteger(value) && value>=1 && value<=30;
    const limitMs=q=>minutes(q)*60000;
    const label=q=>minutes(q)+' minute'+(minutes(q)===1?'':'s');
    // Part size is divisible by three so complete base64 parts join losslessly.
    function* uploads(audio,durationMs){
        const start=audio.indexOf(',')+1,header=audio.slice(0,start),encoded=audio.slice(start);
        const totalBytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
        if(totalBytes<=UPLOAD_BYTES){yield {audio,durationMs};return;}
        const totalParts=Math.ceil(totalBytes/PART_BYTES),length=PART_BYTES*4/3;
        for(let part=0;part<totalParts;part++)yield {audio:header+encoded.slice(part*length,(part+1)*length),durationMs,part,totalParts,totalBytes};
    }
    return {DEFAULT_MINUTES,MINUTE_OPTIONS,MAX_BYTES,UPLOAD_BYTES,PART_BYTES,minutes,validMinutes,validStoredMinutes,limitMs,label,uploads};
});

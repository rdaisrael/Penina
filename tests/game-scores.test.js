const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Shared leaderboard route dispatches each game and rejects unknown games',async()=>{
 const calls=[],ctx={module:{exports:{}},require:name=>{const handler=(req,res)=>{calls.push(name);res.status(200).json({grade:req.query.grade});};return name==='../lib/quiz-account'?{handle:handler}:handler;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/game-scores.js'),'utf8'),ctx);
 for(const game of ['asteroids','matching','flappy','snowblaster','live','assessment','quiz-account','unknown',undefined]){
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.body=data;}};
  await ctx.module.exports({query:{game,grade:'sixth'}},res);
  assert.equal(res.code,['asteroids','matching','flappy','snowblaster','live','assessment','quiz-account'].includes(game)?200:400);
 }
 assert.deepEqual(calls,['../lib/asteroids-scores','../lib/matching-scores','../lib/flappy-scores','../lib/snowblaster-scores','../lib/live-game','../lib/quiz-submissions','../lib/quiz-account']);
});


test('Query actions cannot mask restricted assessment or live-game body actions',async()=>{
 const calls=[],ctx={module:{exports:{}},require:name=>{
  if(name==='../lib/teacher-apps')return {requireApps:async()=>{throw Object.assign(Error('App denied'),{status:403});}};
  return ()=>{calls.push(name);};
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/game-scores.js'),'utf8'),ctx);
 for(const [game,action] of [['assessment','report'],['assessment-custom','correct'],['assessment-retake','correct'],['assessment-retake-8','report'],['live','create']]){
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.body=data;}};
  await ctx.module.exports({method:'POST',query:{game,action:'student'},body:{action}},res);assert.equal(res.code,403);
 }
 assert.equal(calls.length,0);
});

test('A deleted teacher can still sign out or switch Google accounts',async()=>{
 const calls=[],ctx={module:{exports:{}},require:name=>{
  if(name==='../lib/quiz-teachers')return {rejectDeletedSession:async()=>{throw Object.assign(Error('Deleted'),{status:403});}};
  if(name==='../lib/quiz-account')return {handle:(req,res)=>{calls.push(req.query.action);return res.status(200).json({ok:true});}};
  return ()=>{};
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/game-scores.js'),'utf8'),ctx);
 for(const action of ['logout','login','callback','teacher']){
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.body=data;}};
  await ctx.module.exports({query:{game:'quiz-account',action},headers:{cookie:'__Host-penina-quiz-session=deleted'}},res);
  assert.equal(res.code,action==='teacher'?403:200);
 }
 assert.deepEqual(calls,['logout','login','callback']);
});

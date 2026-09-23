const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Shared leaderboard route dispatches each game and rejects unknown games',async()=>{
 const calls=[],ctx={module:{exports:{}},require:name=>(req,res)=>{calls.push(name);res.status(200).json({grade:req.query.grade});}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/game-scores.js'),'utf8'),ctx);
 for(const game of ['asteroids','matching','flappy','unknown',undefined]){
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.body=data;}};
  await ctx.module.exports({query:{game,grade:'sixth'}},res);
  assert.equal(res.code,['asteroids','matching','flappy'].includes(game)?200:400);
 }
 assert.deepEqual(calls,['../lib/asteroids-scores','../lib/matching-scores','../lib/flappy-scores']);
});

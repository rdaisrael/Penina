const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../PeninaPlus-vocab-builder/flash-cards/library.js'),'utf8');
function harness({selected=['two'],confirm=true,ok=true}={}) {
 const requests=[],messages=[],confirmations=[];
 const ctx={sets:[{pathname:'one',title:'First'},{pathname:'two',title:'Second'}],grade:'sixth',removalChoices:{querySelectorAll:()=>selected.map(value=>({value}))},removeButton:{},selectedForCombination:new Set(['one','two']),render(){},showMessage:async(...args)=>messages.push(args),openInputDialog:async options=>{confirmations.push(options);return confirm;},fetch:async(url,options)=>{requests.push({method:options.method,...JSON.parse(options.body)});return{ok,json:async()=>ok?{removed:['two']}:{error:'Not your webpage'}};}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    async function removeSelectedSets()'),source.indexOf("    removeButton.addEventListener('click', removeSelectedSets)")),ctx);
 return {ctx,requests,messages,confirmations};
}
test('Removal confirms the specific lists and deletes only the removal selection',async()=>{
 const h=harness();await h.ctx.removeSelectedSets();
 assert.match(h.confirmations[0].message,/Second/);assert(!h.confirmations[0].message.includes('First'));
 assert.deepEqual(h.requests,[{method:'DELETE',grade:'sixth',pathnames:['two']}]);
 assert.equal(h.ctx.sets.length,1);assert.equal(h.ctx.sets[0].pathname,'one');assert.deepEqual([...h.ctx.selectedForCombination],['one']);
});
test('Empty selections and cancellation do not delete anything',async()=>{
 for(const options of [{selected:[]},{confirm:false}]){const h=harness(options);await h.ctx.removeSelectedSets();assert.equal(h.requests.length,0);assert.equal(h.ctx.sets.length,2);}
});
test('A rejected removal preserves lists and reports the server error',async()=>{
 const h=harness({ok:false});await h.ctx.removeSelectedSets();assert.equal(h.ctx.sets.length,2);assert.equal(h.messages[0][1],'Not your webpage');assert.equal(h.ctx.removeButton.disabled,false);
});

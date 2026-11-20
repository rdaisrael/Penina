const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function panel(request) {
    const elements = new Map(), window = {confirm:()=>true};
    const get = id => {
        if (!elements.has(id)) elements.set(id,{hidden:true, value:'', options:[], selectedOptions:[{text:'Class'}],
            replaceChildren(...options) { this.options=options; this.value=''; }, add(option) { this.options.push(option); }});
        return elements.get(id);
    };
    let copied;
    vm.runInNewContext(fs.readFileSync(require.resolve('../homepage-page-codes'),'utf8'),{
        window, document:{getElementById:get}, navigator:{clipboard:{writeText:async text=>{copied=text;}}},
        Option:class { constructor(text,value) { Object.assign(this,{text,value}); } },
        fetch:async (url, init) => {
            assert.equal(url,'/api/vocabulary-pages'); assert.equal(init.method,'POST');
            const reply = request(JSON.parse(init.body));
            return {ok:true,json:()=>reply};
        }
    });
    return {window,get,copied:()=>copied};
}

test('Admin panel creates, shows, copies, replaces and revokes only the selected page’s code', async () => {
    const requests=[];
    const h=panel(body=>{
        requests.push(body);
        if(body.operation==='list')return {pages:[{id:'sixth',name:'Sixth Grade'}]};
        if(body.operation==='create')return {version:'1',code:'first'};
        if(body.operation==='replace')return {version:'2',code:'second'};
        return {version:null,code:null};
    });
    const {get}=h;
    h.window.PeninaPageCodes.show();
    await get('code-refresh').onclick();
    assert.equal(get('code-page').options[1].value,'sixth');
    get('code-page').value='sixth';await get('code-page').onchange();
    assert.equal(get('code-create').hidden,false);
    await get('code-create').onclick();assert.equal(get('class-access-code').textContent,'first');
    await get('code-copy').onclick();assert.equal(h.copied(),'first');
    h.window.confirm=()=>false;await get('code-revoke').onclick();assert.equal(requests.length,3);
    h.window.confirm=()=>true;await get('code-replace').onclick();
    assert.equal(requests.at(-1).version,'1');
    assert.equal(get('class-access-code').textContent,'second');
    await get('code-revoke').onclick();assert.equal(requests.at(-1).version,'2');
    assert.equal(get('code-display').hidden,true);assert.equal(get('class-access-code').textContent,'');
    assert(requests.slice(1).every(request=>request.pageId==='sixth'));
});

test('Changing pages or signing out discards late responses containing codes', async () => {
    const pending=[];
    const {get,window}=panel(()=>new Promise(resolve=>pending.push(resolve)));
    get('code-page').value='first';const first=get('code-page').onchange();
    get('code-page').value='second';const second=get('code-page').onchange();
    pending[1]({version:'2',code:'right'});await second;
    pending[0]({version:'1',code:'wrong'});await first;
    assert.equal(get('class-access-code').textContent,'right');
    const reopened=get('code-page').onchange();window.PeninaPageCodes.hide();
    pending[2]({version:'2',code:'stale'});await reopened;
    assert.equal(get('page-code-panel').hidden,true);assert.equal(get('class-access-code').textContent,'');
});

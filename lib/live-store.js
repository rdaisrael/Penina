// Supabase holds live events; Blob remains the source for published vocabulary.
function configured() {
    return !!process.env.PENINA_SUPABASE_URL && !!process.env.PENINA_SUPABASE_SECRET_KEY;
}
function settings() {
    const url = process.env.PENINA_SUPABASE_URL;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || '')) throw new Error('Invalid live database URL.');
    return { url, secret: process.env.PENINA_SUPABASE_SECRET_KEY };
}
async function request(query, options = {}) {
    const {url, secret} = settings();
    const response = await fetch(url + '/rest/v1/penina_live_records?' + query, {
        ...options, headers: { apikey: secret, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...options.headers },
        signal: AbortSignal.timeout(10000)
    });
    if (response.status === 409) { const error = new Error('This action was already saved.'); error.status = 409; throw error; }
    if (!response.ok) throw new Error('Live database request failed (' + response.status + ').');
    return response;
}
async function list(prefix) {
    const rows = [];
    for (let offset = 0;;offset += 1000) {
        const query = new URLSearchParams({select:'path,payload',path:'like.'+prefix+'*',order:'path.asc',limit:'1000',offset:String(offset)});
        const page = await (await request(query)).json(); rows.push(...page);
        if (page.length < 1000) break;
    }
    return rows.map(row => ({ pathname: row.path, payload: row.payload }));
}
async function put(path, payload, topic) {
    await request('', {method:'POST',body:JSON.stringify({path,payload,topic})});
}
async function prune() {
    await request(new URLSearchParams({expires_at:'lt.'+new Date().toISOString()}), {method:'DELETE'});
}
function realtime(topic) {
    if (!configured() || !process.env.PENINA_SUPABASE_PUBLISHABLE_KEY) return null;
    return { url: settings().url, key: process.env.PENINA_SUPABASE_PUBLISHABLE_KEY, topic };
}
module.exports = {configured,list,put,prune,realtime};

const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/live-harness');

function saveList(h, title, cards = h.cards, grade = 'sixth') {
 const pathname = `vocabulary-cards/${grade}/list--${Buffer.from(title).toString('base64url')}.html`;
 h.storage.set(pathname, { body: '<script id="peninaCardData" type="application/json">' + JSON.stringify(cards) + '</script>', uploadedAt: new Date().toISOString() });
 return pathname;
}
async function view(h, code, host) { return (await h.request(null, {code}, host)).body; }
async function act(h, code, host, action, settings = {}) {
 const current = await view(h, code, host);
 return h.request(action, {code, version: current.version, ...settings}, host);
}

for (const database of [false, true]) {
 test(`Replay loads all current class lists and preserves connected players (${database ? 'database' : 'blob'})`, async () => {
  const h = harness({database}), other = saveList(h, 'Not originally selected');
  const foreign = saveList(h, 'Another class', h.cards, 'seventh');
  const {code, hostToken} = (await h.create()).body;
  const student = (await h.join(code)).body.studentToken;
  const original = await view(h, code, hostToken);
  const added = saveList(h, 'Newly published', [h.cards[1]]);
  h.storage.set('vocabulary-cards/sixth/ignore.json', {body: '{}'});
  await act(h, code, hostToken, 'end');
  await act(h, code, hostToken, 'restart');
  const writes = h.operations.writes + h.operations.dbWrites;
  const result = await h.request('settings', {code, grade: 'seventh'}, hostToken);
  assert.equal(result.code, 200);
  assert.deepEqual(new Set(result.body.settings.wordlists.map(set => set.pathname)), new Set([h.setPath, other, added]));
  assert(!JSON.stringify(result.body).includes(foreign));
  assert(!JSON.stringify(result.body).includes('horse'));
  assert(!JSON.stringify(result.body).includes('correct'));
  assert.equal(h.operations.writes + h.operations.dbWrites, writes, 'opening settings is read-only');
  assert.equal((await h.request('settings', {code}, student)).code, 403);
  assert.equal((await h.request('configure', {code, version: result.body.version, pathnames: [added]}, student)).code, 403);
  assert.equal((await act(h, code, hostToken, 'configure', {pathnames: [added], count: 10})).code, 200);
  const lobby = await view(h, code, hostToken);
  assert.equal(lobby.code, code);
  assert.deepEqual(lobby.players, original.players);
  assert.equal((await view(h, code, student)).me.score, 0);
  await act(h, code, hostToken, 'start');
  assert.equal((await view(h, code, student)).question.term, h.cards[1].term);
  assert.equal((await h.request('settings', {code}, hostToken)).code, 409);
 });

 test(`Saving reloads edited words and switches answer language (${database ? 'database' : 'blob'})`, async () => {
  const h = harness({database}), {code, hostToken} = (await h.create()).body;
  const student = (await h.join(code)).body.studentToken;
  const revised = {term: 'חדש', english: 'fresh', hebrew: 'לא ישן', alternativeAnswers: {
   english: {term: 'חדש', definition: 'fresh', answers: ['old', 'empty', 'heavy', 'broken']},
   hebrew: {term: 'חדש', definition: 'לא ישן', answers: ['ישן', 'ריק', 'כבד', 'שבור']}
  }};
  h.storage.set(h.setPath, {body: '<script id="peninaCardData" type="application/json">' + JSON.stringify([revised]) + '</script>'});
  assert.equal((await act(h, code, hostToken, 'configure', {language: 'hebrew', count: 15, seconds: 7, revealSeconds: 20})).code, 200);
  let current = await view(h, code, hostToken);
  assert.equal(current.settings.language, 'hebrew');
  assert.equal(current.settings.count, 15);
  assert.equal(current.seconds, 7);
  assert.equal(current.revealSeconds, 20);
  assert.equal(current.total, 1);
  await act(h, code, hostToken, 'start');
  current = await view(h, code, student);
  assert.equal(current.question.term, revised.term);
  assert(current.question.options.includes(revised.hebrew));
  assert(current.question.options.every(option => !/[a-z]/i.test(option)));
  await act(h, code, hostToken, 'end');
  await act(h, code, hostToken, 'restart');
  assert.equal((await view(h, code, hostToken)).settings.language, 'hebrew');
  await act(h, code, hostToken, 'configure', {language: 'english'});
  await act(h, code, hostToken, 'start');
  assert((await view(h, code, student)).question.options.includes('fresh'));
 });
}

test('Unavailable or invalid selections fail without partially changing the lobby', async () => {
 const h = harness(), {code, hostToken} = (await h.create()).body;
 await h.join(code);
 const unavailable = saveList(h, 'Needs choices', [{term: 'בית', english: 'house'}]);
 const before = await view(h, code, hostToken);
 const invalid = [
  {settings: {pathnames: [h.setPath, unavailable], count: 20}, status: 400, message: /Needs choices.*English/},
  {settings: {pathnames: ['vocabulary-cards/sixth/deleted.html']}, status: 404, message: /no longer available/},
  {settings: {pathnames: ['vocabulary-cards/seventh/foreign.html']}, status: 400},
  {settings: {pathnames: []}, status: 400},
  {settings: {pathnames: [h.setPath, h.setPath]}, status: 400},
  {settings: {pathnames: Array.from({length: 21}, (_, i) => `vocabulary-cards/sixth/${i}.html`)}, status: 400},
  {settings: {language: 'french'}, status: 400},
  {settings: {sendScoresToTeacher: 'true'}, status: 400}
 ];
 for (const {settings, status, message} of invalid) {
  const result = await h.request('configure', {code, version: before.version, ...settings}, hostToken);
  assert.equal(result.code, status);
  if (message) assert.match(result.body.error, message);
  const after = await view(h, code, hostToken);
  assert.deepEqual(after.settings, before.settings);
  assert.equal(after.version, before.version);
  assert.deepEqual(after.players, before.players);
 }
 assert.equal((await h.request('configure', {code, version: before.version, count: 10}, hostToken)).code, 200);
 assert.equal((await h.request('configure', {code, version: before.version, count: 20}, hostToken)).code, 409);
});

test('Removed lists do not block returning to the lobby, and excluded emphasis survives another replay', async () => {
 const h = harness(), other = saveList(h, 'Second');
 const {code, hostToken} = (await h.create({pathnames: [h.setPath, other], wordlistEmphasis: {[h.setPath]: 3, [other]: 2}})).body;
 await h.join(code);
 await act(h, code, hostToken, 'configure', {pathnames: [h.setPath]});
 await act(h, code, hostToken, 'end');
 h.storage.delete(h.setPath);
 assert.equal((await act(h, code, hostToken, 'restart')).code, 200);
 const choices = (await h.request('settings', {code}, hostToken)).body.settings;
 assert.deepEqual(choices.wordlists.map(set => set.pathname), [other]);
 assert.equal(choices.wordlistEmphasis[other], 2);
 assert.equal((await act(h, code, hostToken, 'configure', {pathnames: [other]})).code, 200);
 const lobby = await view(h, code, hostToken);
 assert.equal(lobby.playerCount, 1);
 assert.deepEqual(lobby.settings.pathnames, [other]);
 assert.equal(lobby.settings.wordlistEmphasis[other], 2);
});

test('Teacher can opt into and out of score reports for subsequent rounds without changing the recipient', async () => {
 const h = harness({env: {RESEND_API_KEY: 'test', LIVE_SCORE_EMAIL_FROM: 'scores@example.com'}});
 const {code, hostToken} = (await h.create()).body;
 const student = (await h.join(code)).body.studentToken;
 await act(h, code, hostToken, 'end');
 assert.equal(h.emails.length, 0);
 await act(h, code, hostToken, 'restart');
 assert.equal((await act(h, code, hostToken, 'configure', {sendScoresToTeacher: true, teacherEmail: 'untrusted@example.com'})).code, 200);
 assert.equal((await view(h, code, hostToken)).settings.sendScoresToTeacher, true);
 assert(!JSON.stringify((await h.request('settings', {code}, hostToken)).body).includes('@example.com'));
 assert.equal((await view(h, code, student)).settings, undefined);
 await act(h, code, hostToken, 'end');
 assert.equal(h.emails.length, 1);
 assert.deepEqual(h.emails[0].body.to, ['teacher@example.com']);
 await act(h, code, hostToken, 'restart');
 await act(h, code, hostToken, 'configure', {sendScoresToTeacher: false});
 assert.equal((await view(h, code, hostToken)).settings.sendScoresToTeacher, false);
 await act(h, code, hostToken, 'end');
 assert.equal(h.emails.length, 1);
});

test('Enabling reports validates the owner session and email service before saving', async () => {
 for (const options of [{}, {teacherEmail: 'invalid'}, {signedOut: false}]) {
  const hasService = Object.keys(options).length > 0;
  if (hasService) options.env = {RESEND_API_KEY: 'test', LIVE_SCORE_EMAIL_FROM: 'scores@example.com'};
  const h = harness(options), {code, hostToken} = (await h.create()).body;
  if ('signedOut' in options) options.signedOut = true;
  const result = await h.request('configure', {code, version: 0, sendScoresToTeacher: true}, hostToken);
  assert.equal(result.code, options.signedOut ? 401 : hasService ? 400 : 503);
  const current = await view(h, code, hostToken);
  assert.equal(current.version, 0);
  assert.equal(current.settings.sendScoresToTeacher, false);
 }
});

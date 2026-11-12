const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const harness = require('./helpers/live-harness');

async function setup(options = {}) {
 const h = harness({ now: 100000, ...options });
 const { code, hostToken } = (await h.create({ count: 10 })).body;
 const student = (await h.join(code, 'AB')).body.studentToken;
 const second = (await h.join(code, 'CD')).body.studentToken;
 await h.request('start', { code, version: 0 }, hostToken);
 const view = async (token = student) => (await h.request(null, { code }, token)).body;
 const answer = async (token, correct = true) => {
  const data = await view(token), choice = data.question.options.indexOf(h.cards.find(c => c.term === data.question.term).english);
  return h.request('answer', { code, round: data.round, index: data.index, choice: correct ? choice : (choice + 1) % 4 }, token);
 };
 const act = async action => {
  const data = await view(hostToken);
  assert.equal((await h.request(action, { code, version: data.version }, hostToken)).code, 200);
 };
 return Object.assign(h, { code, hostToken, student, second, view, answer, act });
}

for (const database of [false, true]) {
 test(`Every five correct answers earns 50, bonuses stack, and replay clears streaks (${database ? 'database' : 'blob'})`, async () => {
  const h = await setup({ database });
  for (let index = 0; index < 10; index++) {
   await h.answer(h.student);h.advance(1);await h.answer(h.second);
   const before = await h.view();
   assert.equal(before.me.score, index * 125 + Math.floor(index / 5) * 50);
   assert.equal(before.me.streak, index);
   assert.equal(before.me.bonuses, undefined);
   assert.equal(before.question.correct, undefined);
   await h.act('reveal');
   const after = await h.view(), second = await h.view(h.second);
   assert.equal(after.me.streak, index + 1);
   assert.deepEqual(after.me.bonuses, { first: 25, streak: (index + 1) % 5 === 0 ? 50 : 0 });
   assert.equal(after.me.score, (index + 1) * 125 + Math.floor((index + 1) / 5) * 50);
   assert.equal(second.me.bonuses.first, 0);
   assert.equal(second.me.score, (index + 1) * 100 + Math.floor((index + 1) / 5) * 50);
   assert.deepEqual((await h.view()).me, after.me, 'refresh does not award bonuses twice');
   await h.act('next');
  }
  const final = await h.view(h.hostToken);
  assert.deepEqual(final.finalScores.map(p => p.score), [1350, 1100]);
  assert.equal((await h.view()).lastReveal.me.score, 1350);
  await h.act('restart');
  assert.equal((await h.view()).me.streak, 0);
  assert.equal((await h.view()).me.score, 0);
  await h.act('start');await h.answer(h.student);await h.act('reveal');
  assert.deepEqual((await h.view()).me.bonuses, { first: 25, streak: 0 });
  assert.equal((await h.view()).me.streak, 1);
 });

 for (const missed of [false, true]) test(`${missed ? 'Missing' : 'Missing the correct'} answer breaks a four-answer streak (${database ? 'database' : 'blob'})`, async () => {
  const h = await setup({ database });
  for (let index = 0; index < 6; index++) {
   if (index !== 4 || !missed) await h.answer(h.student, index !== 4);
   await h.act('reveal');
   const view = await h.view();
   assert.equal(view.me.streak, index < 4 ? index + 1 : index - 4);
   assert.equal(view.me.bonuses.streak, 0);
   assert.equal(view.me.score, index < 4 ? (index + 1) * 125 : index === 4 ? 500 : 625);
   await h.act('next');
  }
 });

 test(`Only the first correct response gets 25; wrong responses and retries cannot steal it (${database ? 'database' : 'blob'})`, async () => {
  const h = await setup({ database }), third = (await h.join(h.code, 'EF')).body.studentToken;
  await h.answer(h.student, false);h.advance(1);
  await h.answer(h.second);h.advance(1);
  await h.answer(third);await h.answer(h.student);await h.answer(h.second, false);
  await h.act('reveal');
  assert.equal((await h.view()).me.score, 0);
  assert.deepEqual((await h.view()).me.bonuses, { first: 0, streak: 0 });
  assert.equal((await h.view(h.second)).me.score, 125);
  assert.deepEqual((await h.view(h.second)).me.bonuses, { first: 25, streak: 0 });
  assert.equal((await h.view(third)).me.score, 100);
 });

 test(`Identical receipt times award exactly one stable first-correct bonus (${database ? 'database' : 'blob'})`, async () => {
  const h = await setup({ database });
  await Promise.all([h.answer(h.student), h.answer(h.second)]);
  await h.act('reveal');
  const views = await Promise.all([h.view(), h.view(h.second)]);
  assert.deepEqual(views.map(v => v.me.bonuses.first).sort((a, b) => a - b), [0, 25]);
  assert.deepEqual(views.map(v => v.me.score).sort((a, b) => a - b), [100, 125]);
  assert.deepEqual((await h.view()).me, views[0].me);
 });
}

test('First-correct priority uses server arrival time even when the earlier answer saves last', async () => {
 let release, entered, hold = false;
 const saving = new Promise(resolve => { release = resolve; });
 const started = new Promise(resolve => { entered = resolve; });
 const h = await setup({ database: true, beforeWrite: async pathname => {
  if (hold && pathname.includes('/answers/')) { hold = false;entered();await saving; }
 } });
 hold = true;const pending = h.answer(h.student);await started;
 h.advance(1);await h.answer(h.second);release();await pending;
 await h.act('reveal');
 assert.equal((await h.view()).me.bonuses.first, 25);
 assert.equal((await h.view(h.second)).me.bonuses.first, 0);
});

test('Ending an unrevealed question does not award its points or change the streak', async () => {
 const h = await setup();await h.answer(h.student);await h.act('end');
 const view = await h.view();
 assert.equal(view.me.score, 0);assert.equal(view.me.streak, 0);
});

const client = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/flash-cards/live/live.js'), 'utf8');
test('Streak meter fills at five, starts the next target at zero, and retains bonus text with reduced motion', () => {
 const context = { host: false };
 vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function streakMeter('), client.indexOf(' function draw(')), context);
 const data = { phase: 'question', me: { streak: 4 } };
 assert.match(context.streakMeter(data), /aria-valuenow="4"/);
 assert.match(context.streakMeter(data), /1 more correct answer for \+50/);
 data.phase = 'reveal';data.me = { streak: 5, bonuses: { first: 25, streak: 50 } };
 assert.match(context.streakMeter(data), /aria-valuenow="5"/);
 assert.match(context.bonusNotice(data), /First correct answer! <strong>\+25 points/);
 assert.match(context.bonusNotice(data), /5 in a row! <strong>\+50 points/);
 data.phase = 'question';assert.match(context.streakMeter(data), /aria-valuenow="0"/);
 assert.equal(context.bonusNotice(data), '');
 data.me.streak = 6;assert.match(context.streakMeter(data), /aria-valuenow="1"/);
 context.host = true;assert.equal(context.streakMeter(data), '');
});

test('First correct responder reserves the private celebration for the Leviim', () => {
 for (const host of [false, true]) for (const reduced of [false, true]) {
  const bursts = [], timers = [];
  const element = () => ({ style: {}, children: [], setAttribute() {}, append(child) { this.children.push(child); }, remove() { this.removed = true; } });
  const context = { host, celebrated: new Set(), window: { matchMedia: () => ({ matches: reduced }) }, document: { createElement: element, body: { append: el => bursts.push(el) } }, setTimeout: fn => timers.push(fn) };
  vm.createContext(context);vm.runInContext(client.slice(client.indexOf(' function fireworks('), client.indexOf(' function wrongAnswer(')), context);
  const data = { phase: 'question', round: 0, index: 0, question: { correct: 1 }, me: { choice: 1, bonuses: { first: 25 } } };
  context.fireworks(data);assert.equal(bursts.length, 0);
  data.phase = 'reveal';context.fireworks(data);context.fireworks(data);
  assert.equal(bursts.length,0,'the first-correct celebration must not add overlapping fireworks');
  context.fireworks({ ...data, round: 1 });assert.equal(bursts.length,0);
 }
});

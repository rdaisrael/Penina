const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./helpers/live-harness');
const root = path.resolve(__dirname, '..');

async function check(browser, viewport) {
 const h = harness({env: {RESEND_API_KEY: 'test', LIVE_SCORE_EMAIL_FROM: 'scores@example.com'}});
 const second = 'vocabulary-cards/sixth/second--' + Buffer.from('New Hebrew list').toString('base64url') + '.html';
 const card = {term: 'חדש', hebrew: 'לא ישן', alternativeAnswers: {hebrew: {term: 'חדש', definition: 'לא ישן', answers: ['ישן', 'ריק', 'כבד', 'שבור']}}};
 const {code, hostToken} = (await h.create()).body;
 const studentToken = (await h.join(code)).body.studentToken;
 h.storage.set(second, {body: '<script id="peninaCardData" type="application/json">' + JSON.stringify([card]) + '</script>'});
 await h.request('end', {code, version: 0}, hostToken);
 const context = await browser.newContext({viewport, reducedMotion: 'reduce'});
 const errors = [], saves = [];
 let failLoading = true;
 try {
  // All browser traffic is served from local files and the in-memory game handler.
  await context.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url());
   if (url.hostname !== 'live.test') return route.abort();
   if (url.pathname === '/api/game-scores') {
    const body = request.method() === 'POST' ? request.postDataJSON() : {code: url.searchParams.get('code')};
    if (body.action === 'settings' && failLoading) {
     failLoading = false;
     return route.fulfill({status: 503, json: {error: 'Could not load wordlists. Try again.'}});
    }
    if (body.action === 'configure') saves.push(body);
    const result = await h.request(body.action || null, body, (request.headers().authorization || '').replace('Bearer ', ''));
    return route.fulfill({status: result.code, json: result.body});
   }
   const file = path.join(root, url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
   if (url.pathname.endsWith('/live/')) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(file, 'utf8').replace('<script src="music.js"></script>', '')});
   return fs.existsSync(file) ? route.fulfill({path: file}) : route.abort();
  });
  await context.addInitScript(({code, hostToken, studentToken}) => {
   sessionStorage.setItem('penina-live-host-' + code, hostToken);
   sessionStorage.setItem('penina-live-student-' + code, studentToken);
  }, {code, hostToken, studentToken});
  const teacher = await context.newPage(), student = await context.newPage();
  for (const page of [teacher, student]) page.on('pageerror', error => errors.push(error.message));
  await teacher.goto(`http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?host=1&code=${code}`);
  await student.goto(`http://live.test/PeninaPlus-vocab-builder/flash-cards/live/?code=${code}`);
  await teacher.getByRole('button', {name: 'Play again →', exact: true}).click();
  const settings = teacher.locator('.live-settings');
  await settings.getByRole('button', {name: 'Retry', exact: true}).click();
  await settings.getByRole('checkbox', {name: 'New Hebrew list', exact: true}).check();
  await settings.getByRole('checkbox', {name: 'Class vocabulary', exact: true}).uncheck();
  await settings.getByRole('combobox', {name: 'Emphasis for New Hebrew list', exact: true}).selectOption('3');
  await settings.getByRole('combobox', {name: 'Number of questions', exact: true}).selectOption('15');
  await settings.getByRole('combobox', {name: 'Time per question', exact: true}).selectOption('7');
  await settings.getByRole('combobox', {name: 'Time between questions', exact: true}).selectOption('20');
  await settings.getByRole('checkbox', {name: 'Send scores to teacher', exact: true}).check();
  await settings.getByRole('button', {name: 'Save settings', exact: true}).click();
  await teacher.waitForFunction(() => document.querySelector('[data-settings-error]')?.textContent.includes('no teacher-approved answer choices in English'));
  assert.equal(await settings.getByRole('checkbox', {name: 'New Hebrew list', exact: true}).isChecked(), true);
  assert.equal(await settings.getByRole('combobox', {name: 'Emphasis for New Hebrew list', exact: true}).inputValue(), '3');
  assert.equal(await settings.getByRole('checkbox', {name: 'Send scores to teacher', exact: true}).isChecked(), true);
  await settings.getByRole('combobox', {name: 'Answer language', exact: true}).selectOption('hebrew');
  assert(await teacher.evaluate(() => {
   const dialog = document.querySelector('.live-settings'), box = dialog.getBoundingClientRect();
   return box.left >= 0 && box.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
  }), 'settings fit the viewport without horizontal scrolling');
  if (process.env.LIVE_SCREENSHOT_DIR) await teacher.screenshot({path: path.join(process.env.LIVE_SCREENSHOT_DIR, `penina-replay-settings-${viewport.width}.png`)});
  await settings.getByRole('button', {name: 'Save settings', exact: true}).click();
  await settings.waitFor({state: 'detached'});
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].pathnames, [second]);
  assert.equal(saves[1].language, 'hebrew');
  assert.equal(saves[1].wordlistEmphasis[second], 3);
  assert.equal(saves[1].sendScoresToTeacher, true);
  await student.getByRole('heading', {name: 'You’re in, AB.', exact: true}).waitFor();
  await teacher.getByRole('button', {name: 'Start game →', exact: true}).click();
  await student.getByRole('button', {name: /לא ישן/}).waitFor();
  assert.equal(new URL(student.url()).searchParams.get('code'), code);
  assert.equal((await h.request(null, {code}, hostToken)).body.playerCount, 1);
  await teacher.getByRole('button', {name: 'End game', exact: true}).click();
  await teacher.locator('.live-confirm').getByRole('button', {name: 'End game', exact: true}).click();
  await teacher.getByRole('button', {name: 'Play again →', exact: true}).waitFor();
  assert.equal(h.emails.length, 1);
  h.storage.delete(second);
  await teacher.getByRole('button', {name: 'Play again →', exact: true}).click();
  await settings.getByText('Some previously selected wordlists are no longer available.', {exact: false}).waitFor();
  assert.equal(await settings.getByRole('combobox', {name: 'Answer language', exact: true}).inputValue(), 'hebrew');
  await settings.getByRole('button', {name: 'Cancel', exact: true}).click();
  await settings.waitFor({state: 'detached'});
  assert.equal((await h.request(null, {code}, hostToken)).body.playerCount, 1);
  assert.deepEqual(errors, []);
  console.log(`Passed full replay settings flow at ${viewport.width}×${viewport.height}`);
 } finally { await context.close(); }
}

(async () => {
 const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_EXECUTABLE});
 try {
  for (const viewport of [{width: 390, height: 844}, {width: 1024, height: 768}]) await check(browser, viewport);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Records the Gav-IL demo walkthrough: the judge app on a phone (sunset, then night), then the admin console.
// Needs design-system/ served on :8766 (python3 -m http.server 8766) and built previews.
// Frames come from a CDP screencast (Playwright's own video encoder hangs on some Macs); encode.sh makes the mp4.
//
// DRY=1 (or: node record.mjs --dry) runs the same walkthrough with no screencast: every step still has to
// find its element, so a dry run is the proof that the script still matches the prototype.
//
// The walkthrough follows the flow the prototype has today:
//   sign in -> check in -> countdown -> en route signpost -> table check (A14 mismatch, A12 without its check,
//   A12 · K7 matched) -> evaluate with table talk (consent -> "Everyone agreed" -> the sample conversation ->
//   stop -> keep the highlights) -> notes + a nomination -> submit -> next table -> compare with recall ->
//   confirm -> the 8-second undo -> My notes -> Round 1 complete -> Round 2,
//   then the admin console: the presence map, the judges right now, print placards, the Table talk switch with
//   the retention acknowledgement, and voiding votes with a written reason.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8766/.preview/p/';
const W = 1280, H = 800;
const DRY = process.env.DRY === '1' || process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// beat(): a pause for the caption to land. A dry run shortens those, never the waits the app itself needs.
const beat = ms => sleep(DRY ? Math.round(ms * 0.25) : ms);

const OVERLAY = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
  #rc-cursor{position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 0 2px rgba(40,20,10,.85),0 4px 10px rgba(0,0,0,.35);pointer-events:none;transition:transform .12s ease;left:-40px;top:-40px}
  #rc-cursor.down{transform:scale(.7);background:rgba(237,174,51,.9)}
  .rc-ring{position:fixed;z-index:99998;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #edae33;pointer-events:none;animation:rcr .5s ease-out forwards}
  @keyframes rcr{to{transform:scale(3.2);opacity:0}}
  #rc-cap{position:fixed;z-index:99990;left:40px;top:50%;transform:translateY(-50%);width:340px;pointer-events:none;transition:opacity .3s ease}
  #rc-cap .k{font:600 13px/16px Oswald,'Arial Narrow',sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#edae33}
  #rc-cap .t{font:400 34px/1.12 Ultra,Georgia,serif;color:#fbefd4;margin:8px 0 12px;text-shadow:0 3px 0 rgba(0,0,0,.35)}
  #rc-cap .s{font:500 17px/1.5 Manrope,system-ui,sans-serif;color:#f3ead6}
  #rc-pill{position:fixed;z-index:99990;left:50%;bottom:22px;transform:translateX(-50%);max-width:880px;padding:12px 22px;border-radius:8px;background:repeating-linear-gradient(177deg,transparent 0 7px,rgba(0,0,0,.12) 7px 8px,transparent 8px 19px),linear-gradient(#6a3f22,#4a2a16);box-shadow:0 4px 0 #2e190c,0 12px 30px rgba(0,0,0,.35);color:#fbefd4;font:500 16px/1.4 Manrope,system-ui,sans-serif;pointer-events:none;transition:opacity .3s ease;opacity:0;text-align:center}
  #rc-pill b{font:600 13px/1 Oswald,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#edae33;margin-right:10px}
  #rc-card{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;text-align:center;background:linear-gradient(180deg,#673e5b 0 22%,#d96a42 22% 40%,#f7952d 40% 55%,#edae33 55% 64%,#513379 64%);transition:opacity .5s ease}
  #rc-card .sign{padding:30px 54px 26px;border-radius:8px;background:repeating-linear-gradient(177deg,transparent 0 7px,rgba(0,0,0,.12) 7px 8px,transparent 8px 19px),linear-gradient(#6a3f22,#4a2a16);box-shadow:0 8px 0 #2e190c,0 20px 40px rgba(0,0,0,.35)}
  #rc-card .k{font:600 15px/18px Oswald,sans-serif;letter-spacing:.26em;text-transform:uppercase;color:#edae33}
  #rc-card .t{font:400 96px/1 Ultra,Georgia,serif;color:#fbefd4;margin:10px 0 8px;text-shadow:0 6px 0 #2e190c}
  #rc-card .s{font:400 20px/26px Rye,Georgia,serif;letter-spacing:.05em;color:#fbefd4cc}
  \`;
  const c = document.createElement('div'); c.id = 'rc-cursor';
  const cap = document.createElement('div'); cap.id = 'rc-cap';
  const pill = document.createElement('div'); pill.id = 'rc-pill';
  const add = () => { document.head.appendChild(css); document.body.append(c, cap, pill); };
  document.body ? add() : addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', e => { c.classList.add('down'); const r = document.createElement('div'); r.className = 'rc-ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  addEventListener('mouseup', () => c.classList.remove('down'), true);
  window.__cap = (k, t, s) => { cap.style.opacity = 0; setTimeout(() => { cap.innerHTML = '<div class="k">' + k + '</div><div class="t">' + t + '</div><div class="s">' + s + '</div>'; cap.style.opacity = 1; }, 250); };
  window.__pill = (k, s) => { pill.style.opacity = 0; setTimeout(() => { pill.innerHTML = '<b>' + k + '</b>' + s; pill.style.opacity = 1; }, 250); };
  window.__card = (k, t, s) => { let d = document.getElementById('rc-card'); if (!d) { d = document.createElement('div'); d.id = 'rc-card'; document.body.appendChild(d); } d.style.opacity = 1; d.innerHTML = '<div class="sign"><div class="k">' + k + '</div><div class="t">' + t + '</div><div class="s">' + s + '</div></div>'; };
  window.__uncard = () => { const d = document.getElementById('rc-card'); if (d) { d.style.opacity = 0; setTimeout(() => d.remove(), 520); } };
})();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(OVERLAY);
const page = await ctx.newPage();
page.setDefaultTimeout(12000);

// ---------- screencast capture (a dry run records nothing) ----------
const frames = [];
let cdp = null;
if (!DRY) {
  fs.rmSync('.frames', { recursive: true, force: true }); fs.mkdirSync('.frames');
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async f => {
    const n = String(frames.length).padStart(5, '0');
    fs.writeFileSync(`.frames/${n}.jpg`, Buffer.from(f.data, 'base64'));
    frames.push({ file: `${n}.jpg`, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
}

// ---------- helpers ----------
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const step = s => log('·', s);
async function moveTo(x, y, steps = 22) { await page.mouse.move(x, y, { steps }); }
async function click(loc, pause = 450) {
  log('click', String(loc).slice(0, 100));
  await loc.scrollIntoViewIfNeeded(); await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + loc);
  await moveTo(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(180); await page.mouse.down(); await sleep(90); await page.mouse.up(); await sleep(pause);
}
async function type(loc, text, delay = 70) { await click(loc, 200); await loc.pressSequentially(text, { delay }); }
const cap = (k, t, s) => page.evaluate(([k, t, s]) => window.__cap(k, t, s), [k, t, s]);
const pill = (k, s) => page.evaluate(([k, s]) => window.__pill(k, s), [k, s]);
const fonts = () => page.evaluate(async () => { await document.fonts.ready; return 1; });
const phone = () => page.locator('.phone');
// Role/label selectors: what a person would call the thing on the screen.
const btn = (name, scope) => (scope || phone()).getByRole('button', { name, exact: true }).first();
const btnRe = (re, scope) => (scope || phone()).getByRole('button', { name: re }).first();
const radio = (name, scope) => (scope || phone()).getByRole('radio', { name, exact: true }).first();
const strip = name => page.getByRole('button', { name, exact: true });   // the presenter's strip, outside the phone
// until(): the app's own timings (a countdown, a check, a vote) are waited for, never guessed.
async function until(fn, what, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + what);
    await sleep(120);
  }
}
const textOf = async loc => ((await loc.textContent()) || '').replace(/\s+/g, ' ').trim();
const has = (loc, re) => until(async () => re.test(await textOf(loc)), re + ' in ' + loc);

// ---------- Judge app: sign in ----------
async function signIn() {
  step('sign in');
  await type(phone().getByLabel('Email'), 'sarah@stripe.com');
  await click(btn('Email me a sign-in link'), 1200);
  const code = phone().getByLabel('6-digit code');
  await code.waitFor({ state: 'visible' });
  await type(code, '111111', 90);
  await click(btn('Sign in with code'), 900);
  await has(phone().locator('.field__err'), /didn.t work/);
  await code.fill('');
  await type(code, '424242', 90);
  await click(btn('Sign in with code'), 900);
  await btn('Looks right').waitFor({ state: 'visible' });
}

// ---------- Judge app: the walk and the right-table check ----------
async function walkAndCheck(wrong, code, full, wrongName) {
  await click(btnRe(/at the table/), 700);
  const placard = phone().getByLabel('Placard code');
  await placard.waitFor({ state: 'visible' });
  await placard.fill(wrong);
  await click(btn('Check'), 600);
  await phone().locator('.gv-tc__alert').waitFor({ state: 'visible' });
  const said = await textOf(phone().locator('.gv-tc__alert'));
  if (!said.startsWith(wrong + ' is ' + wrongName)) throw new Error('wrong mismatch: ' + said);
  step('mismatch: ' + said);
  await click(btn('Try again'), 500);
  await placard.fill(code);
  await click(btn('Check'), 600);
  await has(phone().locator('.gv-tc__help'), /2 characters after the dot/);
  step('the check is asked for');
  await placard.fill(full);
  await click(btn('Check'), 600);
  await phone().locator('.gv-tc--done').waitFor({ state: 'visible' });
  step('matched: ' + await textOf(phone().locator('.gv-tc--done')));
}

// ---------- Judge app: table talk (consent, the sample conversation, the highlights) ----------
async function tableTalk() {
  step('table talk');
  await click(btn('Ask and record'), 700);
  await phone().locator('.gv-consent').waitFor({ state: 'visible' });
  await beat(1800);
  await click(btnRe(/Everyone agreed/), 1000);
  await phone().locator('.gv-rec').waitFor({ state: 'visible', timeout: 20000 });
  step('recording');
  await beat(1200);
  await click(btn('Mark this moment'), 500);
  // The sample conversation plays at demo-talk-rate; a stop before the 20-second mark pulls nothing.
  await sleep(11000);
  await click(btn('Stop recording'), 1200);
  await until(async () => (await phone().locator('.gv-hl').count()) > 0, 'the highlights');
  step('highlights: ' + (await phone().locator('.gv-hl').count()));
  await beat(1500);
  await click(phone().getByRole('button', { name: /^Keep:/ }).first(), 700);
  await click(btnRe(/Keep all/), 900);
  await has(phone().locator('.gv-hl--kept').first(), /Kept/);
  step('highlights kept: ' + (await phone().locator('.gv-hl--kept').count()));
}

// ---------- Judge app: notes and a nomination ----------
async function notesAndNomination(note, prize) {
  const field = phone().getByLabel('Private notes');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  const v = await field.inputValue();
  await field.fill(v ? v + '\n' + note : note);
  await beat(900);
  await click(btn(prize), 900);
  step('notes + nomination: ' + prize);
}

// ============================ judge app · sunset ============================
await page.goto(BASE + 'JudgePrototype-sunset.html?demo=1'); await fonts();
await page.evaluate(() => window.__card('HackIllinois 2027 · Judging', 'Gav-IL', 'Fair judging, one table at a time'));
await sleep(DRY ? 600 : 3200);
await page.evaluate(() => window.__uncard());
await sleep(600);
await click(strip('Restart'), 600);           // a clean phone: the session in localStorage goes

await cap('Judge app · 1/8', 'Howdy, judge.', 'No passwords. Judges get a one-time email code or link, or staff scan them in at the desk.');
await beat(1600);
await signIn();
await cap('Judge app · 1/8', 'Code from the email', 'Wrong codes count down. Five misses locks it and asks for a fresh code.');
await beat(1200);

await cap('Judge app · 2/8', 'Check in', 'Path, room and Round 2 prize at a glance. Anything off? One tap pings staff.');
await click(btn('Looks right'), 600);
await until(async () => (await btnRe(/at the table/).count()) > 0, 'the walk to Table A12', 15000);

await cap('Judge app · 3/8', 'Head to Table A12', 'Room, table and team on one signpost. The first table appears on its own.');
await beat(1800);

await cap('Judge app · 4/8', 'Are you at the right table?', 'Type the placard code and the 2 characters after the dot. The phone keeps no check of its own.');
await walkAndCheck('A14', 'A12', 'A12K7', 'LedgerLite');
await cap('Judge app · 4/8', 'A14 is LedgerLite', 'NeuralMesh is at A12, two tables to your right. No penalty, no guessing.');
await beat(2200);

await cap('Judge app · 5/8', 'Table talk', 'Ask first: a script the judge reads aloud. The microphone opens only after everyone at the table says yes.');
await beat(1600);
await tableTalk();
await cap('Judge app · 5/8', 'Keep what is right', 'Each suggestion describes the project, never ranks it. Keep, edit or remove — nothing is kept for you.');
await beat(2000);

await notesAndNomination('Live demo: it rerouted around the node I unplugged.', 'Most Creative');
await cap('Judge app · 6/8', 'Notes and nominations', 'Private notes, autosaved. Nominate standouts only: about 1 in 5 projects per prize.');
await beat(1600);
await click(btn('Submit evaluation'), 1400);

await cap('Judge app · 6/8', 'Next table', 'The signpost names the table and the team. Skip is there if the table cannot happen.');
await until(async () => (await btnRe(/at the table/).count()) > 0, 'the walk to Table A17', 15000);
await beat(1600);
await click(btnRe(/at the table/), 700);
const placard2 = phone().getByLabel('Placard code');
await placard2.waitFor({ state: 'visible' });
await placard2.fill('A17M3');
await click(btn('Check'), 600);
await phone().locator('.gv-tc--done').waitFor({ state: 'visible' });
step('matched: ' + await textOf(phone().locator('.gv-tc--done')));

await notesAndNomination('Carbon breakdown worked live on the water bottle.', 'Best Social Impact');
await click(radio('Ran live'), 800);
await beat(900);
await click(btn('Submit evaluation'), 1400);

await cap('Judge app · 7/8', 'Compare your last two', 'Pairwise, no ties. Your own notes and the highlights you kept ride along on each card.');
await until(async () => (await phone().locator('.gv-pair').count()) > 0, 'the comparison', 15000);
await sleep(1200);                              // the pair ignores taps for a moment after it appears
step('compare: ' + await textOf(phone().locator('.gv-pair__q')));
await until(async () => (await phone().locator('.gv-recall').count()) >= 2, 'the recall rows on both cards');
step('recall: ' + await textOf(phone().locator('.gv-pair')));
await click(phone().getByRole('radio', { name: /EcoLens/ }), 900);
await click(btnRe(/^Confirm:/), 1200);
await until(async () => (await phone().locator('.gv-recorded').count()) > 0, 'the vote to be recorded');
step('recorded: ' + await textOf(phone().locator('.gv-recorded')));

await cap('Judge app · 7/8', '8-second undo', 'The vote waits on the phone before it is sent. My notes stays reachable the whole time.');
await beat(2000);
await click(strip('Time up'), 600);            // Round 1 closes: the last vote finishes the round
await click(btn('My notes'), 1500);
await cap('Judge app · 7/8', 'My notes', 'Every project you judged, with the highlights you kept and the nominations you made.');
await beat(2200);
await until(async () => (await phone().getByRole('button', { name: 'Back', exact: true }).count()) > 0, 'the notes screen');
await has(phone().locator('.gv-notes-list'), /NeuralMesh/);
step('my notes: ' + await textOf(phone().locator('.gv-notes-list')));
await sleep(6000);                              // the 8-second undo window runs out; the vote commits behind My notes
await click(btn('Back'), 1200);

await cap('Judge app · 8/8', 'Round 1 complete', 'Your notes come with you to the deliberation in Room 2405.');
await until(async () => (await btn('Start Round 2').count()) > 0, 'Round 1 complete', 15000);
step('round 1: ' + await textOf(phone().locator('.gv-lede').first()));
await beat(2200);
await click(btn('Start Round 2'), 1400);
await cap('Judge app · 8/8', 'Round 2 deliberation', 'Finalists come from Round 1 nominations. Judges order them; a Borda count picks the winners.');
await beat(2000);
await click(btn('Move NeuralMesh up'), 1000);
await beat(1200);
await click(btn('Submit my ranking'), 2000);
await cap('Judge app · 8/8', 'Ranking submitted', 'The group’s combined ranking picks the winners at 9:15 PM.');
await beat(2400);

// ============================ night theme ============================
await page.goto(BASE + 'JudgePrototype-night.html?demo=1'); await fonts();
await sleep(600);
await click(strip('Restart'), 600);
await cap('Night theme', 'Built for late nights', 'Every screen ships in Sunset and Night, with contrast tested in both.');
await beat(1400);
await signIn();
await click(btn('Looks right'), 600);
await until(async () => (await btnRe(/at the table/).count()) > 0, 'the walk in the night theme', 15000);
await beat(1200);
await walkAndCheck('A14', 'A12', 'A12K7', 'LedgerLite');
await cap('Night theme', 'Same flow, after dark', 'Sign in, check in, walk to the table, prove you are at the right one.');
await beat(2400);

// ============================ admin console ============================
await page.goto(BASE + 'AdminConsole-sunset.html'); await fonts();
await page.evaluate(() => window.__card('Staff & admins', 'Admin console', 'Coverage, anti-cheat, assignments, admissions'));
await sleep(DRY ? 600 : 2800);
await page.evaluate(() => window.__uncard());
await sleep(600);

step('overview');
await pill('Overview', 'Live coverage by room, and the projects nobody has judged yet.');
await beat(1500);
const rooms = page.getByRole('heading', { name: 'Rooms right now' });
await rooms.scrollIntoViewIfNeeded();
await until(async () => (await page.locator('.pm__grid').count()) === 4, 'the presence map');
step('presence map: ' + (await page.locator('.pm__t[role=listitem]').count()) + ' tables');
await beat(1800);
await pill('Rooms right now', 'Each room as a map: team here, judge walking there, judge at the table, held, absent.');
await beat(2400);
const judgesCard = page.getByRole('heading', { name: 'Judges right now' });
await judgesCard.scrollIntoViewIfNeeded();
await until(async () => (await page.locator('.js li').count()) > 0, 'the judges right now');
step('judges right now: ' + (await page.locator('.js li').count()) + ' judges');
await beat(1600);
await pill('Judges right now', 'Who is checked in, where they are, and the ones walking too long or sitting still.');
await beat(2200);

step('print placards');
await click(page.getByRole('button', { name: 'Print placards', exact: true }), 1600);
await page.locator('.gv-print').waitFor({ state: 'visible' });
await until(async () => (await page.locator('.gv-print .gv-placard').count()) === 28, 'the placards of Room 4217');
step('placards: ' + (await page.locator('.gv-print .gv-placard').count()));
await pill('Print placards', 'One placard per table, with the QR of the table. The name slot stays blank, so a moved team needs no reprint.');
await beat(2600);
await click(page.locator('.gv-print').getByRole('button', { name: 'Close', exact: true }), 1000);

step('void votes');
await click(page.getByRole('tab', { name: 'Judges', exact: true }), 1400);
await pill('Void votes', 'Unusually fast judging is flagged. Voiding needs a written reason, and it goes in the audit log.');
await beat(1800);
await click(page.getByRole('button', { name: 'Void votes', exact: true }), 1200);
await page.locator('#void-why').waitFor({ state: 'visible' });
await page.selectOption('#void-why', { index: 1 });
await beat(1200);
await click(page.getByRole('button', { name: 'Void 6 votes', exact: true }), 1600);
await has(page.locator('.gv-badge--stamp').first(), /Votes voided/);
await beat(2200);

step('settings');
await click(page.getByRole('tab', { name: 'Settings', exact: true }), 1600);
await pill('Table talk', 'The event’s switch. Off until counsel signs off; every judge still asks every team first.');
await beat(1600);
await click(page.getByRole('switch', { name: 'Table talk (voice notes)' }), 1400);
await until(async () => (await page.getByRole('switch', { name: 'AI summaries (Anthropic)' }).count()) > 0, 'the AI summaries switch');
await beat(2000);
await pill('Retention', 'Audio is never saved: it goes to Cloudflare to be transcribed and is deleted once it is. Transcripts go away 7 days after the event.');
await beat(2600);
await page.getByRole('switch', { name: 'AI summaries (Anthropic)' }).scrollIntoViewIfNeeded();
await click(page.getByRole('switch', { name: 'AI summaries (Anthropic)' }), 1200);
await page.locator('.gv-confirm').waitFor({ state: 'visible' });
await pill('Acknowledge', 'Turning on AI summaries asks you to acknowledge Anthropic’s retention. Your name and the time are recorded.');
await beat(2600);
await click(page.getByRole('button', { name: /I acknowledge/ }), 1600);
await until(async () => (await page.getByRole('switch', { name: 'AI summaries (Anthropic)' }).getAttribute('aria-checked')) === 'true', 'AI summaries to be on');
await has(page.locator('.audit'), /Turned on AI summaries/);
step('audit log: ' + await textOf(page.locator('.audit')));
await beat(2400);

await page.evaluate(() => window.__card('HackIllinois 2027', 'Gav-IL', 'Design system · Design doc · Next.js app'));
await sleep(DRY ? 600 : 3400);

// ---------- write the frame list ----------
if (!DRY) {
  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  let list = '';
  frames.forEach((f, i) => { const d = Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t : end) - f.t); list += `file '${f.file}'\nduration ${d.toFixed(3)}\n`; });
  list += `file '${frames[frames.length - 1].file}'\n`;
  fs.writeFileSync('.frames/list.txt', list);
  log('frames', frames.length);
} else log('dry run: no frames written');
await browser.close();

#!/usr/bin/env node
// Runs tests/index.html headless, in both themes, and prints each page title (PASS n/n or FAIL x/n) and every failing row.
//
//   node scripts/run_tests.mjs                 # sunset and night, one after the other, 10 minutes each
//   node scripts/run_tests.mjs --theme=night   # one theme
//   node scripts/run_tests.mjs --only="Judge prototype · skip"   # the ?only= filter (earlier tests run silently)
//   node scripts/run_tests.mjs --only="final review" --fresh      # ... and skip the earlier tests (fast; only for a suite that loads its own page)
//   node scripts/run_tests.mjs --timeout=900   # seconds per theme (default 600); --throttle=6 slows the CPU 6x like a phone
//
// Build first (python3 scripts/generate_component_docs.py && python3 scripts/build_previews.py). The runner serves design-system/ itself
// with python3 -m http.server (the suite lists directories, which a plain static server can't do), on a free port, and stops it after.
// A run is about 7 minutes per theme on a laptop and the page title stays "Gav-IL tests" until the last check, so this waits for it.
// Exit code: 0 all pass, 1 a failure or a timeout, 2 bad arguments or no Playwright.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([a-z]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : ['?', a]; }));
const known = new Set(['theme', 'only', 'fresh', 'timeout', 'throttle', 'port']);
const stray = Object.keys(args).filter(k => !known.has(k));
if (stray.length) { console.error('run_tests: unknown argument(s) ' + stray.join(', ') + '\nusage: node scripts/run_tests.mjs [--theme=sunset|night] [--only=<suite text> [--fresh]] [--timeout=<seconds>] [--throttle=<n>] [--port=<n>]'); process.exit(2); }
const themes = args.theme ? [String(args.theme)] : ['sunset', 'night'];
if (themes.some(t => !['sunset', 'night'].includes(t))) { console.error('run_tests: --theme is sunset or night'); process.exit(2); }
const timeout = (Number(args.timeout) || 600) * 1000, throttle = Number(args.throttle) || 1;

async function playwright() {
  for (const spec of ['playwright', resolve(root, '../demo/node_modules/playwright/index.mjs')]) {
    try { return await import(spec); } catch { /* try the next */ }
  }
  console.error('run_tests: Playwright is not installed (npm i in demo/, or npm i -D playwright)'); process.exit(2);
}
function freePort() { return new Promise(res => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); }); }

const { chromium } = await playwright();
const port = Number(args.port) || await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', root], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/tests/`)).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }

const browser = await chromium.launch();
let bad = 0;
for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage();
  if (throttle > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  const q = [theme === 'night' ? 'theme=night' : '', args.only ? 'only=' + encodeURIComponent(String(args.only)) : '', args.only && args.fresh ? 'fresh=1' : ''].filter(Boolean).join('&');
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/tests/${q ? '?' + q : ''}`);
  let title;
  try { await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title), null, { timeout }); title = await page.title(); }
  catch { title = 'TIMEOUT after ' + Math.round(timeout / 1000) + 's (title: ' + await page.title() + ')'; }
  const fails = await page.evaluate(() => [...document.querySelectorAll('.t.fail')].map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 400)));
  if (!title.startsWith('PASS')) bad++;
  console.log(`${theme}${throttle > 1 ? ' ' + throttle + 'x' : ''}: ${title} (${Math.round((Date.now() - t0) / 1000)}s)` + (fails.length ? '\n  - ' + fails.slice(0, 40).join('\n  - ') : ''));
  await ctx.close();
}
await browser.close(); stop();
process.exit(bad ? 1 : 0);

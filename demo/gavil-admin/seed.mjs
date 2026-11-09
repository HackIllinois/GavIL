// Seeds the admin demo server so the console looks like a live event.
// 1. A fast judge: Sarah Kim checks in, evaluates three tables in seconds and compares them, so the admin Judges
//    tab shows a "Fast visits" flag and a Void votes button.
// 2. A judge at a table: she then walks to a fourth table (A22) and checks in with its placard, so the presence
//    map has a "Judge at the table" cell.
// 3. Teams here: staff check a handful of teams in at their tables from the Overview's "Check a team in" form (the
//    app's own way), so the map has "Team here" cells next to the "not here yet" ones.
// usage: node seed.mjs [port]
import { chromium } from '../node_modules/playwright/index.mjs'
const PORT = process.argv[2] || '3191'
const BASE = `http://localhost:${PORT}`
const SHOTS = process.env.SHOTS
const CODES = { A01:'YE',A02:'MX',A03:'JH',A04:'WW',A05:'K3',A06:'7Y',A07:'CR',A08:'Y4',A09:'H9',A10:'7U',A11:'XT',A12:'K7',A13:'PW',A14:'W2',A15:'JH',A16:'KK',A17:'M3',A18:'P4',A19:'HY',A20:'T9',A21:'RX',A22:'R4',A23:'J7',A24:'V7',A25:'ND',A26:'NT',A27:'MA',A28:'HM' }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
// A busy machine (load of several hundred) makes every page and every server action slow: wait generously.
ctx.setDefaultTimeout(90000); ctx.setDefaultNavigationTimeout(120000)
const log = (...a) => console.log('[seed]', ...a)
const body = () => page.evaluate(() => document.body.innerText)
const waitText = (re, timeout = 90000) => page.waitForFunction((s) => new RegExp(s, 'i').test(document.body.innerText), re, { timeout })
const click = (role, name) => page.getByRole(role, { name }).first().click({ timeout: 90000 })
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }) }
try {
  await page.goto(BASE + '/login'); await page.waitForTimeout(1500)
  await page.locator('input[type=email], input[placeholder*="company"]').first().fill('sarah.kim@stripe.com')
  await click('button', /email me a sign-in link/i); await page.waitForTimeout(2000)
  await page.locator('input:not([type=hidden])').first().fill('123456')
  await click('button', /sign in with code/i)
  await page.waitForURL(/\/judge/, { timeout: 120000 }); await page.waitForTimeout(1500)
  await shot('s01')
  for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: /looks right/i }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(1200); if (!/Welcome/.test(await body())) break }
  for (let stop = 0; stop < 3; stop++) {
    await page.goto(BASE + '/judge/evaluate'); await waitText('Head to Table|Table [A-D]\\d\\d'); await page.waitForTimeout(800)
    const t = await body(); await shot('s02-' + stop)
    const m = t.match(/Head to Table ([A-D]\d\d)/) || t.match(/Table ([A-D]\d\d)/)
    const code = m && m[1]; log('stop', stop, code)
    if (/Head to Table/.test(t)) {
      await click('button', /i.m at the table/i); await waitText('placard')
      await page.locator('input').first().fill(`${code} ${CODES[code] ?? ''}`); await click('button', /^check$/i)
      await waitText('confirmed|right table'); await page.waitForTimeout(1200)
    }
    await shot('s03-' + stop)
    await page.getByRole('radio', { name: /partly ran|ran live/i }).first().click()
    await page.locator('textarea').first().fill('Quick look at the demo.'); await page.waitForTimeout(400)
    await click('button', /submit evaluation/i)
    if (stop === 0) {
      // The first visit has nothing to compare with: it goes straight to the next table.
      await waitText('Head to Table|Next table'); await page.waitForTimeout(1200); await shot('s04-' + stop); continue
    }
    await page.waitForURL(/compare/, { timeout: 120000 }); await page.waitForTimeout(1500)
    await shot('s04-' + stop)
    log('compare:', (await body()).replace(/\n/g, ' | ').slice(0, 300))
    await page.getByRole('radio').first().click(); await click('button', /confirm/i)
    await waitText('vote recorded'); await shot('s05-' + stop)
    // The vote is sent when the 8 s undo countdown ends.
    await page.waitForFunction(() => !/undo/i.test(document.body.innerText), null, { timeout: 120000 }); await page.waitForTimeout(800)
    await page.waitForTimeout(1500)
  }
  // A fourth table: she is sent to it, checks in with its placard and is still there (no evaluation yet).
  await page.goto(BASE + '/judge/evaluate'); await waitText('Head to Table'); await page.waitForTimeout(800)
  {
    const t = await body(); await shot('s06-at')
    const m = t.match(/Head to Table ([A-D]\d\d)/)
    const code = m && m[1]; log('at-table stop', code)
    if (!code) throw new Error('no fourth table offered: ' + t.replace(/\n/g, ' | ').slice(0, 200))
    await click('button', /i.m at the table/i); await waitText('placard')
    await page.locator('input').first().fill(`${code} ${CODES[code] ?? ''}`); await click('button', /^check$/i)
    await waitText('confirmed|right table'); await page.waitForTimeout(1200); await shot('s07-at')
  }
  // Staff check some teams in at their tables, as floor staff do. Others stay "not here yet".
  const staff = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const sp = await staff.newPage()
  await sp.goto(BASE + '/auth/mock?role=admin'); await sp.waitForTimeout(2000)
  await sp.waitForURL(/\/admin/, { timeout: 120000 })
  const here = (process.env.HERE || 'A12,A17,A20,A22,B08,B12,C05,C16,D17').split(',')
  for (const code of here) {
    const field = sp.getByRole('textbox', { name: /table code to check a team in/i })
    await field.fill(code)
    await sp.getByRole('button', { name: /^check in$/i }).click({ timeout: 90000 })
    await sp.waitForFunction((c) => !document.querySelector('input[name=table]')?.value, code, { timeout: 90000 })
    await sp.waitForTimeout(900)
    log('checked in', code)
  }
  const ov = await sp.evaluate(() => document.body.innerText)
  log('presence:', (ov.match(/\d+ teams? · \d+ here · \d+ not here yet · \d+ absent/g) || []).join(' || '))
  log('judges:', (ov.match(/(Sarah Kim|Marcus Hall)\n[^\n]*/g) || []).join(' || '))
  if (SHOTS) await sp.screenshot({ path: `${SHOTS}/s08-overview.png`, fullPage: true })
  log('done')
} catch (e) { log('FAILED', String(e).slice(0, 400)); await shot('fail'); process.exitCode = 1 }
await browser.close()

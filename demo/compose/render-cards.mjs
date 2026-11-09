// Renders card.html's four backdrops to PNG (1920x1080) with the demo's own Playwright.
import { chromium } from '../node_modules/playwright/index.mjs'
import path from 'node:path'; import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
for (const k of ['intro', 'judge', 'admin', 'outro']) {
  await p.goto(`file://${here}/card.html?kind=${k}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600)
  await p.screenshot({ path: `${here}/out/card-${k}.png` }); console.log('card', k)
}
// Rounded-corner masks for the two recordings (white = visible).
for (const [n, w, h, r] of [['mask-phone', 446, 965, 40], ['mask-admin', 1552, 970, 18]]) {
  await p.setViewportSize({ width: w, height: h })
  await p.setContent(`<body style="margin:0;background:#000"><div style="width:${w}px;height:${h}px;border-radius:${r}px;background:#fff"></div></body>`)
  await p.screenshot({ path: `${here}/out/${n}.png` }); console.log('mask', n)
}
await b.close()

import { chromium } from '/Users/aritro/Downloads/HackIllinois/demo/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('console', m => console.log('console', m.type(), m.text().slice(0,200)));
p.on('pageerror', e => console.log('pageerror', e.message));
p.on('crash', () => console.log('CRASH'));
p.on('close', () => console.log('PAGE CLOSED'));
p.on('requestfailed', r => console.log('reqfail', r.url()));
await p.goto('http://localhost:8931/tests/?only=Judge%20prototype');
for (let i=0;i<20;i++){ await new Promise(r=>setTimeout(r,3000)); console.log(i, await p.title()); }
await b.close();

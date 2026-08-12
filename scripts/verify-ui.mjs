import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.locator('text=Companies').wait({ timeout: 20000 });
const click = (sel) => page.locator(sel).click();
const fill = (sel, v) => page.locator(sel).fill(v);
const wait = (sel) => page.locator(sel).wait({ timeout: 15000 });

// setup: company + project + THB expense
await click('button::-p-text(Add)');
await wait('text=New company');
await fill('input[placeholder="e.g. Media Production Co."]', 'Test Co');
await click('button::-p-text(Save)');
await wait('text=Test Co');
await click('.company-card');
await wait('text=Projects');
await click('button::-p-text(Add project)');
await wait('text=New project');
await fill('input[placeholder="e.g. Phuket Trip 2026 vlog"]', 'Demo project');
await click('button::-p-text(Save)');
await wait('text=Demo project');
await click('.row::-p-text(Demo project)');
await wait('button::-p-text(Add expense)');
await click('button::-p-text(Add expense)');
await wait('text=Scan receipt');
await click('button::-p-text(Enter manually)');
await wait('text=New expense');
await fill('input[placeholder="e.g. Camera lens for travel vlog"]', 'Lunch');
await fill('input[aria-label="Amount"]', '500');
const cur = await page.locator('select[aria-label="Currency"]').waitHandle();
await cur.evaluate((el) => { el.value = 'THB'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await new Promise((r) => setTimeout(r, 3500)); // FX fetch
await click('button::-p-text(Save)');
await wait('text=Lunch');
await new Promise((r) => setTimeout(r, 3000)); // totals HKD fetch

const report = await page.evaluate(() => {
  const totalsCard = document.querySelector('.totals-card')?.innerText ?? 'MISSING';
  const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
  const rowAmount = document.querySelector('.tx-amount-sm')?.textContent ?? 'MISSING';
  const hScroll = document.documentElement.scrollWidth > window.innerWidth;
  return {
    totalsCard,
    rowAmount,
    tabbarBottom: tabbar ? Math.round(tabbar.bottom) : null,
    innerHeight: window.innerHeight,
    horizontalOverflow: hScroll,
  };
});
console.log(JSON.stringify(report, null, 2));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();

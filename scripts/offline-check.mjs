import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 1) online load (caches app shell + SW registers)
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.locator('text=Companies').wait({ timeout: 20000 });
await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
// 2) go offline and reload
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
const text = await page.evaluate(() => document.body.innerText.slice(0, 120));
console.log('offline render:', text.includes('Companies') ? 'OK — app shell served from cache' : 'FAILED');
console.log(JSON.stringify(text));
console.log('page errors:', errors.length ? errors : 'none');
await page.setOfflineMode(false);
await browser.close();

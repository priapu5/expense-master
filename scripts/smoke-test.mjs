// End-to-end smoke test: drives the production build in headless Chrome
// (system Chrome via puppeteer-core — no browser download).
// Usage: npm run smoke   (requires `npm run preview` on port 4173)
import puppeteer from 'puppeteer-core';

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/';
const SHOTS = '/tmp/expense-tracker-shots';
const steps = [];
const errors = [];

async function main() {
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    steps.push(name);
    console.log('✓ shot', name);
  };
  const click = (sel) => page.locator(sel).click();
  const fill = (sel, value) => page.locator(sel).fill(value);

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.locator('text=Companies').wait({ timeout: 20000 });
  await shot('01-empty-state');

  // --- create a company ---
  await click('button::-p-text(Add)');
  await page.locator('text=New company').wait();
  await fill('input[placeholder="e.g. Media Production Co."]', 'Media Production Co.');
  await click('button[aria-label="Icon 🎬"]');
  await click('button::-p-text(Save)');
  await page.locator('text=Media Production Co.').wait({ timeout: 10000 });
  await shot('02-company-created');

  // --- open company, add a project ---
  await click('.company-card');
  await page.locator('text=Projects').wait();
  await shot('03-company-detail');
  await click('button::-p-text(Add project)');
  await page.locator('text=New project').wait();
  await fill('input[placeholder="e.g. Phuket Trip 2026 vlog"]', 'Phuket Trip 2026 vlog');
  await fill('textarea', 'Travel vlog series filmed in Phuket: camera gear, meals, transport.');
  await click('button::-p-text(Save)');
  await page.locator('text=Phuket Trip 2026 vlog').wait();
  await shot('04-project-created');

  // --- open project, add revenue manually ---
  await click('.row::-p-text(Phuket Trip 2026 vlog)');
  await page.locator('button::-p-text(Add expense)').wait();
  await shot('05-project-detail');
  await click('button::-p-text(Add revenue)');
  await page.locator('text=New revenue').wait();
  await fill('input[placeholder="e.g. YouTube AdSense payout"]', 'AdSense payout');
  await fill('input[aria-label="Amount"]', '12000');
  await click('button::-p-text(Save)');
  await page.locator('text=AdSense payout').wait({ timeout: 10000 });
  await shot('06-revenue-added');

  // --- add expense manually (THB, exercises the FX preview path) ---
  await click('button::-p-text(Add expense)');
  await page.locator('text=Scan receipt').wait();
  await click('button::-p-text(Enter manually)');
  await page.locator('text=New expense').wait();
  await fill('input[placeholder="e.g. Camera lens for travel vlog"]', 'Camera lens');
  await fill('input[aria-label="Amount"]', '850');
  const curSelect = await page.locator('select[aria-label="Currency"]').waitHandle();
  await curSelect.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, 'THB');
  await new Promise((r) => setTimeout(r, 2000)); // let the FX preview fetch settle
  await click('button::-p-text(Save)');
  await page.locator('text=Camera lens').wait({ timeout: 10000 });
  await shot('07-expense-added');

  // --- delete it again via the view modal + confirm dialog ---
  await click('.row::-p-text(Camera lens)');
  await page.locator('button::-p-text(Edit)').wait();
  await click('button::-p-text(Delete)');
  await page.locator('text=Delete this transaction?').wait();
  await page.keyboard.press('Enter'); // confirm button has autoFocus
  await page.waitForFunction(() => !document.body.innerText.includes('Camera lens'), { timeout: 10000 });
  console.log('✓ delete + confirm flow works');
  await shot('07b-after-delete');

  // --- query tab ---
  await click('.tabbar-item::-p-text(Query)');
  await page.locator('button::-p-text(Export)').wait();
  await page.waitForFunction(() => document.body.innerText.includes('AdSense payout'));
  await shot('08-query');

  // --- settings: placeholder Gemini key to unlock the scan UI ---
  await click('.tabbar-item::-p-text(Settings)');
  await page.locator('text=Gemini (receipt scanning)').wait();
  await shot('09-settings');
  await fill('input[placeholder="AIza…"]', 'FAKE_KEY_FOR_UI_TEST');
  await click('button::-p-text(Save Gemini settings)');

  // --- scan flow pick screen (no real API call made) ---
  try {
    await click('.tabbar-item::-p-text(Companies)');
  } catch (err) {
    await shot('debug-failed-tab-click');
    const diag = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tabbar-item')][0];
      const r = b.getBoundingClientRect();
      const atPoint = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        tabRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        atPoint: String(atPoint?.tagName) + '.' + String(atPoint?.className?.baseVal ?? atPoint?.className),
        innerH: window.innerHeight,
      };
    });
    console.log('TAB CLICK DIAG:', JSON.stringify(diag));
    throw err;
  }
  // Nav state is preserved by design: returning to the Companies tab restores
  // the project we were inside. Drill back in only if we're at the company list.
  const onProject = await page
    .locator('button::-p-text(Add expense)')
    .wait({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!onProject) {
    await click('.company-card');
    await click('.row::-p-text(Phuket Trip 2026 vlog)');
  }
  await click('button::-p-text(Add expense)');
  await click('button::-p-text(Scan receipt)');
  await page.locator('text=Take photo').wait();
  await shot('10-scan-pick');

  // --- service worker registration ---
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-support';
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => 'registered'),
      new Promise((r) => setTimeout(() => r('timeout'), 8000)),
    ]);
    return ready;
  });
  console.log('SW:', sw);

  // --- reload: IndexedDB persistence + app shell ---
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await page.locator('text=Media Production Co.').wait({ timeout: 15000 });
  console.log('✓ data persists after reload');
  await shot('11-after-reload');

  console.log(errors.length ? '\nPAGE ERRORS:\n' + errors.join('\n') : '\n✓ no console/page errors');
  console.log('screenshots:', SHOTS);
  await browser.close();
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  console.error('screenshots so far:', steps.join(', '));
  process.exit(1);
});

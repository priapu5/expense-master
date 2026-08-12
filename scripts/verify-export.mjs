// Verifies the spreadsheet export end-to-end: seeds a receipt transaction
// (with a canvas-generated JPEG thumb) straight into IndexedDB, clicks
// Export in the Query tab, captures the download, and inspects the .xlsx
// package: embedded images, drawing parts, hyperlinks, FX/HKD columns.
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/';
const DL_DIR = '/tmp/expense-tracker-downloads';
mkdirSync(DL_DIR, { recursive: true });

const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const click = (sel) => page.locator(sel).click();
const fill = (sel, v) => page.locator(sel).fill(v);
const wait = (sel) => page.locator(sel).wait({ timeout: 15000 });

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await wait('text=Companies');

// --- seed company + project via the UI ---
await click('button::-p-text(Add)');
await wait('text=New company');
await fill('input[placeholder="e.g. Media Production Co."]', 'Export Co');
await click('button::-p-text(Save)');
await wait('text=Export Co');
await click('.company-card');
await wait('text=Projects');
await click('button::-p-text(Add project)');
await wait('text=New project');
await fill('input[placeholder="e.g. Phuket Trip 2026 vlog"]', 'Export project');
await click('button::-p-text(Save)');
await wait('text=Export project');

// --- inject a receipt transaction directly into IndexedDB ---
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('expense-tracker', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const projects = await new Promise((res, rej) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const projectId = projects[0].id;

  // Canvas-generated "receipt" thumbnail (fake photo, 300x150 JPEG).
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 150;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 300, 150);
  ctx.fillStyle = '#0b7a4b';
  ctx.fillRect(30, 40, 240, 10);
  ctx.fillStyle = '#999999';
  ctx.fillRect(30, 70, 180, 8);
  ctx.fillRect(30, 95, 210, 8);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('RECEIPT', 30, 30);
  const thumbDataUrl = canvas.toDataURL('image/jpeg', 0.8);

  const tx = db.transaction('transactions', 'readwrite');
  tx.objectStore('transactions').put({
    id: 'verify-receipt-1',
    projectId,
    type: 'expense',
    amount: 1234.56,
    currency: 'USD',
    date: '2026-08-10',
    merchant: 'Camera Store',
    description: 'Camera equipment for export verification',
    receipt: {
      blobData: null,
      blobType: 'image/jpeg',
      thumbDataUrl,
      thumbW: 300,
      thumbH: 150,
      syncState: 'synced',
      driveFileId: 'verify-test-file-id',
      driveUrl: 'https://drive.google.com/file/d/verify-test-file-id/view',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await tx.done;
});
console.log('✓ receipt transaction seeded');

// --- reload so the app picks up the new data, then export ---
await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
await wait('text=Export Co');
await click('.tabbar-item::-p-text(Query)');
await wait('button::-p-text(Export)');

const client = await page.createCDPSession();
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DL_DIR,
  eventsEnabled: true,
});

await click('button::-p-text(Export)');

// Wait for the .xlsx to appear
let file = null;
for (let i = 0; i < 40 && !file; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  file = readdirSync(DL_DIR).find((f) => f.endsWith('.xlsx')) || null;
}
if (!file) throw new Error('Export did not produce an .xlsx download');
const path = `${DL_DIR}/${file}`;
console.log('✓ downloaded', file);

// --- inspect the package ---
const listing = execSync(`unzip -l "${path}"`).toString();
const mediaCount = (listing.match(/xl\/media\//g) || []).length;
const hasDrawing = listing.includes('xl/drawings/drawing1.xml');
const sheet1 = execSync(`unzip -p "${path}" xl/worksheets/sheet1.xml`).toString();
const sharedStrings = execSync(`unzip -p "${path}" xl/sharedStrings.xml`).toString();
const hasHyperlink = sheet1.includes('<hyperlink');
const hasHkdHeader = sharedStrings.includes('Amount (HKD)');
const hasFxHeader = sharedStrings.includes('FX rate (HKD)');
const hasUsdAmount = sheet1.includes('1234.56');
const drawingXml = hasDrawing
  ? execSync(`unzip -p "${path}" xl/drawings/drawing1.xml`).toString()
  : '';
const hasImageAnchor = drawingXml.includes('twoCellAnchor') || drawingXml.includes('oneCellAnchor');
const drawingRels = execSync(`unzip -p "${path}" xl/drawings/_rels/drawing1.xml.rels`).toString();
const hasImageRel = drawingRels.includes('image');

const summary = {
  mediaFiles: mediaCount,
  hasDrawingPart: hasDrawing,
  hasImageAnchorInDrawing: hasImageAnchor,
  hasImageRel: hasImageRel,
  hasDriveHyperlink: hasHyperlink,
  hasHkdColumn: hasHkdHeader,
  hasFxRateColumn: hasFxHeader,
  hasUsdAmount: hasUsdAmount,
  pageErrors: errors,
};
console.log(JSON.stringify(summary, null, 2));

const ok =
  mediaCount >= 1 && hasDrawing && hasImageAnchor && hasImageRel && hasHkdHeader && hasFxHeader && hasUsdAmount && errors.length === 0;
console.log(ok ? '\n✓ EXPORT VERIFICATION PASSED' : '\n✗ EXPORT VERIFICATION FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

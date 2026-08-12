/** Spreadsheet export via the vendored ExcelJS browser bundle.
 *  Embeds receipt thumbnails into cells + Drive hyperlinks, plus a Summary
 *  sheet with per-currency totals and the home-currency conversion column. */
import type { Transaction } from '../types';
import { getRatesForDates } from './fx';
import { totalsByCurrency, round2 } from '../lib/totals';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ExportRow {
  date: string;
  type: string;
  company: string;
  project: string;
  description: string;
  merchant: string;
  amount: number;
  currency: string;
  rate: number | null;
  amountHome: number | null;
  homeCurrency: string;
  thumbDataUrl?: string;
  thumbW?: number;
  thumbH?: number;
  driveUrl?: string;
}

export interface CurrencySplit {
  revenue: number;
  expense: number;
}

export interface ExportSummary {
  byCurrency: Map<string, CurrencySplit>;
  homeRevenue: number;
  homeExpense: number;
  homeCurrency: string;
  count: number;
  dateFrom?: string;
  dateTo?: string;
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

let exceljsPromise: Promise<any> | null = null;

function ensureExcelJS(): Promise<any> {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!exceljsPromise) {
    exceljsPromise = new Promise<any>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = './vendor/exceljs.min.js';
      s.async = true;
      s.onload = () =>
        window.ExcelJS
          ? resolve(window.ExcelJS)
          : reject(new ExportError('Spreadsheet library failed to load.'));
      s.onerror = () =>
        reject(new ExportError('Could not load the spreadsheet library — are you online?'));
      document.head.appendChild(s);
    });
  }
  return exceljsPromise;
}

/** Builds export rows (chronological) with FX rates frozen in at export time. */
export async function buildExportData(
  txs: Transaction[],
  ctx: { companyOf: (t: Transaction) => string; projectOf: (t: Transaction) => string },
  home: string,
): Promise<{ rows: ExportRow[]; summary: ExportSummary }> {
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt)));

  // Batch-fetch all needed rates per currency (cached in IDB).
  const curDates = new Map<string, Set<string>>();
  for (const t of sorted) {
    if (t.currency !== home) {
      let set = curDates.get(t.currency);
      if (!set) {
        set = new Set();
        curDates.set(t.currency, set);
      }
      set.add(t.date);
    }
  }
  const rates = new Map<string, number>();
  await Promise.all(
    [...curDates.entries()].map(async ([cur, dates]) => {
      const m = await getRatesForDates(cur, home, [...dates]);
      for (const [d, r] of m) rates.set(`${cur}:${d}`, r);
    }),
  );

  const byCurrency = totalsByCurrency(sorted);
  let homeRevenue = 0;
  let homeExpense = 0;

  const rows: ExportRow[] = sorted.map((t) => {
    const rate = t.currency === home ? 1 : rates.get(`${t.currency}:${t.date}`) ?? null;
    const amountHome = rate != null ? round2(t.amount * rate) : null;
    if (rate != null) {
      if (t.type === 'revenue') homeRevenue += t.amount * rate;
      else homeExpense += t.amount * rate;
    }
    return {
      date: t.date,
      type: t.type,
      company: ctx.companyOf(t),
      project: ctx.projectOf(t),
      description: t.description ?? '',
      merchant: t.merchant ?? '',
      amount: t.amount,
      currency: t.currency,
      rate,
      amountHome,
      homeCurrency: home,
      thumbDataUrl: t.receipt?.thumbDataUrl,
      thumbW: t.receipt?.thumbW,
      thumbH: t.receipt?.thumbH,
      driveUrl: t.receipt?.driveUrl,
    };
  });

  const dateFrom = sorted[0]?.date;
  const dateTo = sorted[sorted.length - 1]?.date;

  return {
    rows,
    summary: {
      byCurrency,
      homeRevenue: round2(homeRevenue),
      homeExpense: round2(homeExpense),
      homeCurrency: home,
      count: rows.length,
      dateFrom,
      dateTo,
    },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Builds the workbook and returns it as a Blob. */
export async function exportXlsx(
  rows: ExportRow[],
  summary: ExportSummary,
  filename: string,
): Promise<Blob> {
  const ExcelJS = await ensureExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Expense Tracker';

  const home = summary.homeCurrency;
  const ws = wb.addWorksheet('Transactions');
  ws.columns = [
    { width: 12 },
    { width: 9 },
    { width: 16 },
    { width: 20 },
    { width: 34 },
    { width: 16 },
    { width: 12 },
    { width: 9 },
    { width: 12 },
    { width: 13 },
    { width: 18 },
    { width: 14 },
  ];
  const header = ws.addRow([
    'Date', 'Type', 'Company', 'Project', 'Description', 'Merchant',
    'Amount', 'Currency', `FX rate (${home})`, `Amount (${home})`, 'Receipt', 'Drive',
  ]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B7A4B' } };
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const excelRow = ws.addRow([
      row.date,
      row.type,
      row.company,
      row.project,
      row.description,
      row.merchant,
      row.amount,
      row.currency,
      row.rate == null ? null : Math.round(row.rate * 10000) / 10000,
      row.amountHome,
      '',
      '',
    ]);
    excelRow.getCell(7).numFmt = '#,##0.00';
    excelRow.getCell(9).numFmt = '0.0000';
    excelRow.getCell(10).numFmt = '#,##0.00';
    excelRow.alignment = { vertical: 'middle' };

    if (row.thumbDataUrl) {
      const w = row.thumbW && row.thumbH ? (118 * row.thumbH) / Math.max(1, row.thumbW) : 0;
      const h = clamp(Math.round(w), 40, 170);
      try {
        const imgId = wb.addImage({ base64: row.thumbDataUrl, extension: 'jpeg' });
        ws.addImage(imgId, {
          tl: { col: 10.12, row: rowNumber - 1 + 0.04 },
          ext: { width: 118, height: h },
          editAs: 'oneCell',
        });
        excelRow.height = h + 8;
      } catch {
        excelRow.getCell(11).value = 'image error';
      }
    }

    if (row.driveUrl) {
      const cell = excelRow.getCell(12);
      cell.value = { text: 'Open', hyperlink: row.driveUrl, tooltip: 'Open receipt in Google Drive' };
      cell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  });

  // Totals footer
  const footerStart = rows.length + 3;
  let r = footerStart;
  ws.getCell(r, 5).value = 'Totals by currency';
  ws.getCell(r, 5).font = { bold: true };
  r++;
  for (const [cur, v] of [...summary.byCurrency.entries()].sort()) {
    ws.getCell(r, 5).value = `Revenue ${cur}`;
    ws.getCell(r, 7).value = round2(v.revenue);
    ws.getCell(r, 7).numFmt = '#,##0.00';
    ws.getCell(r, 8).value = cur;
    r++;
    ws.getCell(r, 5).value = `Expense ${cur}`;
    ws.getCell(r, 7).value = round2(v.expense);
    ws.getCell(r, 7).numFmt = '#,##0.00';
    ws.getCell(r, 8).value = cur;
    r++;
  }
  const totalRow = r++;
  ws.getCell(totalRow, 5).value = `TOTAL (${home})`;
  ws.getCell(totalRow, 5).font = { bold: true };
  ws.getCell(totalRow, 9).value = null;
  ws.getCell(totalRow, 10).value = round2(summary.homeRevenue - summary.homeExpense);
  ws.getCell(totalRow, 10).numFmt = '#,##0.00';
  ws.getCell(totalRow, 10).font = { bold: true };
  r++;
  ws.getCell(r, 1).value =
    'FX: ECB daily reference rates via frankfurter.app, converted at each transaction date. Indicative only — not tax advice.';
  ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF6B7280' } };

  // Summary sheet
  const ws2 = wb.addWorksheet('Summary');
  ws2.columns = [{ width: 30 }, { width: 16 }, { width: 16 }];
  ws2.addRow(['Expense Tracker export']).font = { bold: true, size: 14 };
  ws2.addRow(['Exported', new Date().toISOString()]);
  ws2.addRow([
    'Date range',
    summary.dateFrom && summary.dateTo ? `${summary.dateFrom} to ${summary.dateTo}` : 'All time',
  ]);
  ws2.addRow(['Transactions', summary.count]);
  ws2.addRow([]);
  ws2.addRow(['', 'Revenue', 'Expense']).font = { bold: true };
  for (const [cur, v] of [...summary.byCurrency.entries()].sort()) {
    const row = ws2.addRow([cur, round2(v.revenue), round2(v.expense)]);
    row.getCell(2).numFmt = '#,##0.00';
    row.getCell(3).numFmt = '#,##0.00';
  }
  const homeRow = ws2.addRow([`TOTAL (${home})`, round2(summary.homeRevenue), round2(summary.homeExpense)]);
  homeRow.font = { bold: true };
  homeRow.getCell(2).numFmt = '#,##0.00';
  homeRow.getCell(3).numFmt = '#,##0.00';
  ws2.addRow([]);
  ws2.addRow([
    'Notes',
    'Receipts are embedded in the Transactions sheet. "Open" links to Google Drive. FX uses ECB reference rates at each transaction date.',
  ]);

  const buf = await wb.xlsx.writeBuffer();
  void filename;
  return new Blob([buf], { type: XLSX_MIME });
}

export function exportFilename(dateFrom?: string, dateTo?: string): string {
  const range = dateFrom && dateTo ? `${dateFrom}_${dateTo}` : 'all';
  return `expenses_${range}.xlsx`;
}

export async function exportAndSave(
  rows: ExportRow[],
  summary: ExportSummary,
): Promise<void> {
  const filename = exportFilename(summary.dateFrom, summary.dateTo);
  const blob = await exportXlsx(rows, summary, filename);
  const { shareOrDownload } = await import('../lib/download');
  await shareOrDownload(blob, filename);
}

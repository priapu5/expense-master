import type { Transaction } from '../types';

export interface CurrencyTotals {
  revenue: number;
  expense: number;
}

export function totalsByCurrency(txs: Transaction[]): Map<string, CurrencyTotals> {
  const m = new Map<string, CurrencyTotals>();
  for (const t of txs) {
    const cur = m.get(t.currency) ?? { revenue: 0, expense: 0 };
    if (t.type === 'revenue') cur.revenue += t.amount;
    else cur.expense += t.amount;
    m.set(t.currency, cur);
  }
  return m;
}

export function netByCurrency(m: Map<string, CurrencyTotals>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [cur, v] of m) out.set(cur, v.revenue - v.expense);
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

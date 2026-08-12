import { useEffect, useRef, useState } from 'react';
import type { Transaction } from '../types';
import { getRatesForDates } from '../services/fx';
import { round2 } from '../lib/totals';

export interface HomeTotals {
  revenue: number;
  expense: number;
}

export const ALL_KEY = () => 'all';

/** Sums of transactions converted to the home currency at each transaction's
 *  date rate, grouped by an arbitrary stable key function.
 *  Rates are batched per currency (one request per currency) and cached in IDB. */
export function useHomeTotalsByKey(
  txs: Transaction[],
  keyFn: (t: Transaction) => string | null,
  home: string,
): { byKey: Map<string, HomeTotals>; loading: boolean } {
  const [result, setResult] = useState<{ byKey: Map<string, HomeTotals>; loading: boolean }>({
    byKey: new Map(),
    loading: true,
  });
  const keyFnRef = useRef(keyFn);
  keyFnRef.current = keyFn;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const curDates = new Map<string, Set<string>>();
      const meta: { key: string; currency: string; date: string; amount: number; type: Transaction['type'] }[] = [];
      for (const t of txs) {
        const key = keyFnRef.current(t);
        if (key == null) continue;
        meta.push({ key, currency: t.currency, date: t.date, amount: t.amount, type: t.type });
        if (t.currency !== home) {
          let set = curDates.get(t.currency);
          if (!set) {
            set = new Set();
            curDates.set(t.currency, set);
          }
          set.add(t.date);
        }
      }
      const rates = new Map<string, number>(); // `${currency}:${date}` -> rate
      await Promise.all(
        [...curDates.entries()].map(async ([cur, dates]) => {
          const m = await getRatesForDates(cur, home, [...dates]);
          for (const [d, r] of m) rates.set(`${cur}:${d}`, r);
        }),
      );
      if (cancelled) return;
      const byKey = new Map<string, HomeTotals>();
      for (const m of meta) {
        const cur = byKey.get(m.key) ?? { revenue: 0, expense: 0 };
        const rate = m.currency === home ? 1 : rates.get(`${m.currency}:${m.date}`);
        if (rate != null) {
          const homeVal = m.amount * rate;
          if (m.type === 'revenue') cur.revenue += homeVal;
          else cur.expense += homeVal;
        }
        byKey.set(m.key, cur);
      }
      for (const v of byKey.values()) {
        v.revenue = round2(v.revenue);
        v.expense = round2(v.expense);
      }
      setResult({ byKey, loading: false });
    })().catch(() => {
      if (!cancelled) setResult({ byKey: new Map(), loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [txs, home]);

  return result;
}

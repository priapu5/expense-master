import { useMemo } from 'react';
import type { Transaction } from '../types';
import { totalsByCurrency, round2 } from '../lib/totals';
import { formatAmount } from '../lib/currency';
import { ALL_KEY, useHomeTotalsByKey } from '../hooks/useHomeTotalsByKey';
import { Spinner } from './ui';

/** Per-currency revenue/expense/net table with a home-currency (≈ HKD) row. */
export function TotalsCard({ txs, home }: { txs: Transaction[]; home: string }) {
  const byCur = useMemo(() => totalsByCurrency(txs), [txs]);
  const { byKey, loading } = useHomeTotalsByKey(txs, ALL_KEY, home);
  const h = byKey.get('all');
  const net = h ? round2(h.revenue - h.expense) : null;

  if (txs.length === 0) return null;

  return (
    <div className="card totals-card">
      <div className="totals-table">
        <div className="totals-head">Currency</div>
        <div className="totals-head totals-num">Revenue</div>
        <div className="totals-head totals-num">Expense</div>
        <div className="totals-head totals-num">Net</div>
        {[...byCur.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([cur, v]) => {
            const n = round2(v.revenue - v.expense);
            return (
              <div className="totals-grid-row" key={cur}>
                <div className="totals-cell">{cur}</div>
                <div className="totals-cell totals-num">{formatAmount(v.revenue, cur)}</div>
                <div className="totals-cell totals-num">{formatAmount(v.expense, cur)}</div>
                <div className={`totals-cell totals-num ${n >= 0 ? 'tone-pos' : 'tone-neg'}`}>
                  {formatAmount(Math.abs(n), cur)}
                  {n < 0 ? ' −' : ''}
                </div>
              </div>
            );
          })}
        {byCur.size > 1 || home !== [...byCur.keys()][0] ? (
          <div className="totals-grid-row totals-home-row">
            <div className="totals-cell">
              ≈ {home}
              {loading && <Spinner size={11} />}
            </div>
            <div className="totals-cell totals-num">{h ? formatAmount(h.revenue, home) : '—'}</div>
            <div className="totals-cell totals-num">{h ? formatAmount(h.expense, home) : '—'}</div>
            <div className={`totals-cell totals-num ${net != null && net >= 0 ? 'tone-pos' : 'tone-neg'}`}>
              {net == null ? '—' : `${formatAmount(Math.abs(net), home)}${net < 0 ? ' −' : ''}`}
            </div>
          </div>
        ) : null}
      </div>
      <div className="totals-note">Home-currency row converts each transaction at its date's ECB reference rate.</div>
    </div>
  );
}

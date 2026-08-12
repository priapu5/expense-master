import { useEffect, useState } from 'react';
import { getRate } from '../services/fx';
import { isValidDateString } from '../lib/date';

/** Live FX rate for one (currency, date) pair — cached in IndexedDB. */
export function useFxRate(
  from: string | undefined,
  date: string | undefined,
  to: string,
): { rate: number | null; loading: boolean } {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!from || !date || !isValidDateString(date)) {
      setRate(null);
      setLoading(false);
      return;
    }
    if (from === to) {
      setRate(1);
      setLoading(false);
      return;
    }
    setLoading(true);
    getRate(from, to, date)
      .then((r) => {
        if (!cancelled) {
          setRate(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRate(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, date, to]);

  return { rate, loading };
}

/** Converts an amount at the given rate, or null. */
export function convertAmount(amount: number, rate: number | null): number | null {
  if (rate == null) return null;
  return Math.round(amount * rate * 100) / 100;
}

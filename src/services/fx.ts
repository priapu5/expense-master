/** Currency conversion via frankfurter.dev (ECB daily reference rates).
 *  Free, no API key, CORS-enabled, historical dates supported.
 *  Rates are cached in IndexedDB per (from,to) pair; lookups scan back a few
 *  days because ECB publishes no weekend/holiday rates. */
import { getDB } from '../db/db';
import { addDays } from '../lib/date';

// frankfurter.app now 301-redirects to frankfurter.dev/v1 and the redirect
// chain breaks browser CORS, so call the new domain directly.
const BASE_URL = 'https://api.frankfurter.dev/v1';
const LOOKBACK_DAYS = 6;

/** Currencies with ECB reference rates (what frankfurter serves historically). */
export const FX_SUPPORTED = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF',
  'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN',
  'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

type RateMap = Map<string, number>; // date -> rate
const memCache = new Map<string, RateMap>(); // `${from}:${to}` -> rates
const inflight = new Map<string, Promise<void>>();
const loaded = new Set<string>();

const keyFor = (from: string, to: string) => `${from}:${to}`;

async function loadIntoMemory(key: string): Promise<void> {
  if (loaded.has(key)) return;
  const db = await getDB();
  const stored = await db.get('fxRates', key);
  if (stored) memCache.set(key, new Map(Object.entries(stored.rates)));
  loaded.add(key);
}

async function persist(key: string): Promise<void> {
  const rates = memCache.get(key);
  if (!rates) return;
  const db = await getDB();
  await db.put('fxRates', { from: key.split(':')[0], to: key.split(':')[1], rates: Object.fromEntries(rates) }, key);
}

async function fetchRangeOnce(from: string, to: string, start: string, end: string): Promise<Record<string, number> | null> {
  // Range form (start..end) is always used — the single-date endpoint returns
  // a different shape (rates keyed by currency), and ensureRange always asks
  // for at least a 7-day window anyway.
  const url = `${BASE_URL}/${start}..${end}?from=${from}&to=${to}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return null; // unsupported pair / no data
    if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
    const j = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    const out: Record<string, number> = {};
    if (j.rates) {
      for (const [date, values] of Object.entries(j.rates)) {
        const v = values?.[to];
        if (typeof v === 'number' && Number.isFinite(v)) out[date] = v;
      }
    }
    return out;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('frankfurter HTTP')) throw err;
    return null; // network failure / CORS: treated as "no data", UI shows —
  }
}

/** Ensures rates for the (from,to) pair covering [earliest, latest] are in the cache. */
async function ensureRange(from: string, to: string, earliest: string, latest: string): Promise<void> {
  if (from === to) return;
  if (!FX_SUPPORTED.has(from) || !FX_SUPPORTED.has(to)) return;
  const key = keyFor(from, to);
  await loadIntoMemory(key);
  const existing = memCache.get(key) ?? new Map<string, number>();
  memCache.set(key, existing);

  // Check whether every date in [earliest, latest] is already covered (or back-filled).
  let missing = false;
  for (let d = earliest; d <= latest; d = addDays(d, 1)) {
    if (!findRateBack(existing, d)) {
      missing = true;
      break;
    }
  }
  if (!missing) return;

  const inflightKey = key;
  const prev = inflight.get(inflightKey);
  if (prev) {
    await prev;
    return ensureRange(from, to, earliest, latest); // re-check after the concurrent fetch
  }

  const p = (async () => {
    const fetched = await fetchRangeOnce(from, to, addDays(earliest, -LOOKBACK_DAYS), latest);
    if (fetched) {
      for (const [date, rate] of Object.entries(fetched)) existing.set(date, rate);
      await persist(key);
    }
  })().finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, p);
  await p;
}

function findRateBack(rates: RateMap, date: string): number | null {
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const r = rates.get(i === 0 ? date : addDays(date, -i));
    if (r != null) return r;
  }
  return null;
}

/** Rate to convert 1 unit of `from` into `to` on `date`, or null when unavailable. */
export async function getRate(from: string, to: string, date: string): Promise<number | null> {
  if (from === to) return 1;
  if (!FX_SUPPORTED.has(from) || !FX_SUPPORTED.has(to)) return null;
  await ensureRange(from, to, date, date);
  const rates = memCache.get(keyFor(from, to));
  return rates ? findRateBack(rates, date) : null;
}

/** Batch lookup for a list of dates — one network round-trip per currency pair. */
export async function getRatesForDates(
  from: string,
  to: string,
  dates: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (from === to) {
    for (const d of dates) out.set(d, 1);
    return out;
  }
  if (!FX_SUPPORTED.has(from) || !FX_SUPPORTED.has(to) || dates.length === 0) return out;
  const sorted = [...dates].sort();
  const earliest = addDays(sorted[0], -LOOKBACK_DAYS);
  const latest = sorted[sorted.length - 1];
  await ensureRange(from, to, earliest, latest);
  const rates = memCache.get(keyFor(from, to));
  if (!rates) return out;
  for (const d of dates) {
    const r = findRateBack(rates, d);
    if (r != null) out.set(d, r);
  }
  return out;
}

export async function clearFxCache(): Promise<void> {
  memCache.clear();
  loaded.clear();
  const db = await getDB();
  await db.clear('fxRates');
}

export async function fxCacheSize(): Promise<number> {
  const db = await getDB();
  return db.count('fxRates');
}

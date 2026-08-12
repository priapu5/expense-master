import type { ReactNode } from 'react';
import { CURRENCIES, formatAmount } from '../lib/currency';
import { isValidDateString, todayLocal } from '../lib/date';
import { useFxRate, convertAmount } from '../hooks/useFx';
import { Chip, Input, Select } from './ui';

// ---------- layout ----------

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// ---------- currency ----------

export function CurrencySelect({
  value,
  onChange,
  includeAll = false,
}: {
  value: string;
  onChange: (code: string) => void;
  includeAll?: boolean;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Currency">
      {includeAll && <option value="">Any</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} {c.symbol}
        </option>
      ))}
    </Select>
  );
}

// ---------- amount with live home-currency preview ----------

export function AmountField({
  value,
  onChange,
  currency,
  onCurrencyChange,
  date,
  homeCurrency,
  autoFocus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  currency: string;
  onCurrencyChange: (code: string) => void;
  date?: string;
  homeCurrency: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const num = parseFloat(value);
  const valid = Number.isFinite(num) && num > 0;
  const { rate, loading } = useFxRate(valid ? currency : undefined, date, homeCurrency);
  const converted = valid ? convertAmount(num, rate) : null;

  return (
    <div>
      <div className="amount-row">
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder ?? '0.00'}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Amount"
        />
        <CurrencySelect value={currency || ''} onChange={onCurrencyChange} />
      </div>
      {valid && currency && currency !== homeCurrency && (
        <div className="fx-preview" aria-live="polite">
          {loading || rate == null ? (
            converted == null ? (
              <span className="muted">no {homeCurrency} rate available for this date</span>
            ) : (
              <span className="muted">…</span>
            )
          ) : (
            <span>
              ≈ {formatAmount(converted!, homeCurrency)}{' '}
              <span className="muted">@ {rate.toFixed(4)} on {date}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- date with alternative chips ----------

export function DateField({
  value,
  onChange,
  alternatives = [],
  showTodayChip = true,
}: {
  value: string;
  onChange: (v: string) => void;
  alternatives?: { date: string; label: string }[];
  showTodayChip?: boolean;
}) {
  const today = todayLocal();
  const chips: { date: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const a of alternatives) {
    if (isValidDateString(a.date) && !seen.has(a.date)) {
      seen.add(a.date);
      chips.push(a);
    }
  }
  if (showTodayChip && !seen.has(today)) chips.push({ date: today, label: 'Today' });

  return (
    <div>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Date" />
      {chips.length > 0 && (
        <div className="chip-row">
          {chips.map((c) => (
            <Chip
              key={c.date + c.label}
              label={c.label}
              sub={c.date}
              active={value === c.date}
              onClick={() => onChange(c.date)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

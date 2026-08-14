import type { ReactNode } from 'react';
import type { ProcessedImage } from '../lib/image';
import { formatAmount } from '../lib/currency';
import type { ReceiptExtraction } from '../services/gemini';
import { Button, Chip, Input, Spinner } from './ui';
import { CurrencySelect, DateField, Field } from './fields';

/** Review + confirm form shared by the single-scan flow and bulk scan.
 *  Owns no state — the parent keeps the review fields so multiple receipts
 *  can stay in sync (bulk scan) without lifting anything else. */
export function ReceiptReviewForm({
  image,
  extraction,
  projectName,
  homeCurrency,
  amount,
  currency,
  date,
  reason,
  merchant,
  onAmount,
  onCurrency,
  onDate,
  onReason,
  onMerchant,
  saving,
  onSave,
  saveLabel = 'Save expense',
  footerLeft,
}: {
  image: ProcessedImage;
  extraction: ReceiptExtraction | null;
  projectName: string;
  homeCurrency: string;
  amount: string;
  currency: string;
  date: string;
  reason: string;
  merchant: string;
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
  onDate: (v: string) => void;
  onReason: (v: string) => void;
  onMerchant: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  saveLabel?: string;
  footerLeft?: ReactNode;
}) {
  const amountChips = (extraction?.alternativeAmounts ?? [])
    .filter((a) => a.amount > 0)
    .slice(0, 3);
  const reasonChips = [
    ...(extraction?.reason ? [extraction.reason] : []),
    ...(extraction?.reasonAlternatives ?? []),
  ]
    .filter((r, i, arr) => r && arr.indexOf(r) === i)
    .slice(0, 4);

  return (
    <div className="scan-review">
      <img src={image.thumbDataUrl} alt="Receipt preview" className="scan-preview-img" />

      <Field label="Amount">
        <div className="amount-row">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder="0.00"
            autoFocus={!extraction?.totalAmount}
            aria-label="Amount"
          />
          <CurrencySelect value={currency} onChange={onCurrency} />
        </div>
        {amountChips.length > 0 && (
          <div className="chip-row">
            {amountChips.map((a, i) => (
              <Chip
                key={`${a.amount}-${i}`}
                label={formatAmount(a.amount, a.currency)}
                sub={a.label}
                active={amount === String(a.amount) && currency === a.currency}
                onClick={() => {
                  onAmount(String(a.amount));
                  onCurrency(a.currency);
                }}
              />
            ))}
          </div>
        )}
        <div className="field-hint">
          {extraction?.totalAmount != null
            ? 'Gemini guessed the total above — tap an alternative or edit it.'
            : 'Gemini could not find a total on this receipt — enter it manually.'}
        </div>
      </Field>

      <Field label="Date">
        <DateField value={date} onChange={onDate} alternatives={extraction?.alternativeDates ?? []} />
      </Field>

      <Field label="Expense reason">
        <textarea
          className="input textarea"
          rows={3}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder={`e.g. Equipment for ${projectName}`}
        />
        {reasonChips.length > 0 && (
          <div className="chip-row">
            {reasonChips.map((r, i) => (
              <Chip key={i} label={r} active={reason === r} onClick={() => onReason(r)} />
            ))}
          </div>
        )}
      </Field>

      <Field label="Merchant">
        <Input value={merchant} onChange={(e) => onMerchant(e.target.value)} placeholder="Read from the receipt" />
      </Field>

      {currency && currency !== homeCurrency && amount && parseFloat(amount) > 0 && (
        <div className="fx-preview">Converted to {homeCurrency} in totals and exports at the {date} rate.</div>
      )}

      <div className="btn-row btn-row-sticky">
        {footerLeft}
        <Button variant="primary" icon="check" onClick={onSave} disabled={saving}>
          {saving ? <Spinner size={16} /> : saveLabel}
        </Button>
      </div>
    </div>
  );
}

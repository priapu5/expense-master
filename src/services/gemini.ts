import { isValidDateString } from '../lib/date';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export interface ReceiptExtraction {
  totalAmount: number | null;
  currency: string;
  alternativeAmounts: { amount: number; currency: string; label: string }[];
  /** 'YYYY-MM-DD' or '' when not legible */
  transactionDate: string;
  alternativeDates: { date: string; label: string }[];
  merchant: string;
  reason: string;
  reasonAlternatives: string[];
}

export interface ExtractContext {
  companyName: string;
  projectName: string;
  projectDescription?: string;
}

export type GeminiErrorKind = 'key' | 'model' | 'quota' | 'network' | 'http' | 'parse';

export class GeminiError extends Error {
  constructor(
    message: string,
    public kind: GeminiErrorKind,
    public status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** Kept deliberately small: the schema counts toward input tokens. */
const SCHEMA = {
  type: 'object',
  properties: {
    totalAmount: { type: 'number', nullable: true },
    currency: { type: 'string' },
    alternativeAmounts: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['amount', 'currency', 'label'],
      },
    },
    transactionDate: { type: 'string' },
    alternativeDates: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, label: { type: 'string' } },
        required: ['date', 'label'],
      },
    },
    merchant: { type: 'string' },
    reason: { type: 'string' },
    reasonAlternatives: { type: 'array', maxItems: 3, items: { type: 'string' } },
  },
  required: [
    'totalAmount',
    'currency',
    'alternativeAmounts',
    'transactionDate',
    'alternativeDates',
    'merchant',
    'reason',
    'reasonAlternatives',
  ],
} as const;

function buildPrompt(ctx: ExtractContext): string {
  const descLine = ctx.projectDescription?.trim()
    ? `\n- Project description: "${ctx.projectDescription.trim()}"`
    : '';
  return `You extract tax-relevant data from a receipt photo for a freelancer's expense tracker.

Business context:
- Company: "${ctx.companyName}"
- Project: "${ctx.projectName}"${descLine}

Instructions:
1. "totalAmount": the total amount actually charged on the receipt (the grand total as printed, after discounts/taxes/tips). Numeric only, no symbols. If no total is legible, use null — never invent one.
2. "currency": the ISO 4217 code of totalAmount (e.g. "THB", "USD", "HKD"). If uncertain, use the most likely code.
3. "alternativeAmounts": up to 3 OTHER plausible amounts visible on the receipt (e.g. subtotal before tax, total including tip, a line-item amount, or the amount in a second currency if one is shown). Label each in a few words.
4. "transactionDate": the transaction/purchase date printed on the receipt, as "YYYY-MM-DD". If no date is legible, use "".
5. "alternativeDates": up to 3 other dates printed on the receipt (e.g. issue date vs payment date), each as "YYYY-MM-DD" with a short label. Empty array if there are none.
6. "merchant": the merchant/business name on the receipt, or "" if unclear.
7. "reason": one professional English sentence describing the purpose of this expense, inferred from the receipt contents AND the project context above. Example: for a "Phuket Trip 2026 vlog" project and a camera-store receipt, the reason could be "Camera equipment for shooting footage of the Phuket Trip 2026 travel vlog". If the context does not help, describe the expense itself (e.g. "Business lunch at Riverside Café").
8. "reasonAlternatives": up to 3 alternative phrasings of the reason.

Return only the JSON object matching the schema.`;
}

interface GeminiResponsePart {
  text?: string;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiResponsePart[] }; finishReason?: string }[];
}

async function callOnce(url: string, body: unknown): Promise<GeminiResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiError('No internet connection — check your network and try again.', 'network');
  }

  if (!res.ok) {
    let msg = '';
    try {
      const j = await res.json();
      msg = j?.error?.message || '';
    } catch {
      /* ignore */
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new GeminiError(
        'Gemini rejected the API key. Check the key in Settings (it must be a valid Gemini API key).',
        'key',
        res.status,
      );
    }
    if (res.status === 404) {
      throw new GeminiError(
        `Gemini model not found. Check the model name in Settings (currently "${''}").`,
        'model',
        404,
      );
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || 0);
      const waitMs = Math.min(Math.max(retryAfter, 1) * 1000, 60_000);
      await new Promise((r) => setTimeout(r, waitMs));
      throw new GeminiError(
        'Gemini free-tier rate limit reached — try again in a minute.',
        'quota',
        429,
      );
    }
    throw new GeminiError(`Gemini API error (${res.status}): ${msg || 'unknown error'}`, 'http', res.status);
  }

  try {
    return (await res.json()) as GeminiResponse;
  } catch {
    throw new GeminiError('Gemini returned an unreadable response — try again.', 'parse');
  }
}

function parseText(res: GeminiResponse): string {
  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new GeminiError('Gemini returned no text — try again.', 'parse');
  return text;
}

function isFiniteAmount(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e7;
}

function isCurrency(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Z]{3}$/.test(s);
}

function sanitize(raw: unknown): ReceiptExtraction {
  const r = (raw ?? {}) as Record<string, unknown>;
  const totalAmount = isFiniteAmount(r.totalAmount) ? Math.round(r.totalAmount * 100) / 100 : null;

  const altAmounts: ReceiptExtraction['alternativeAmounts'] = [];
  if (Array.isArray(r.alternativeAmounts)) {
    for (const a of r.alternativeAmounts as Record<string, unknown>[]) {
      if (isFiniteAmount(a?.amount) && isCurrency(a?.currency) && typeof a?.label === 'string' && altAmounts.length < 3) {
        altAmounts.push({
          amount: Math.round((a.amount as number) * 100) / 100,
          currency: a.currency as string,
          label: String(a.label).slice(0, 80) || 'Alternative',
        });
      }
    }
  }

  const transactionDate =
    typeof r.transactionDate === 'string' && isValidDateString(r.transactionDate) ? r.transactionDate : '';

  const altDates: ReceiptExtraction['alternativeDates'] = [];
  if (Array.isArray(r.alternativeDates)) {
    for (const a of r.alternativeDates as Record<string, unknown>[]) {
      if (typeof a?.date === 'string' && isValidDateString(a.date) && typeof a?.label === 'string' && altDates.length < 3) {
        altDates.push({ date: a.date as string, label: String(a.label).slice(0, 60) || 'Alternative date' });
      }
    }
  }

  const currency = isCurrency(r.currency) ? r.currency : altAmounts[0]?.currency ?? '';

  const merchant = typeof r.merchant === 'string' ? r.merchant.trim().slice(0, 120) : '';

  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 300) : '';

  const reasonAlternatives: string[] = [];
  if (Array.isArray(r.reasonAlternatives)) {
    for (const a of r.reasonAlternatives) {
      if (typeof a === 'string' && a.trim() && reasonAlternatives.length < 3) {
        reasonAlternatives.push(a.trim().slice(0, 300));
      }
    }
  }

  return {
    totalAmount,
    currency,
    alternativeAmounts: altAmounts,
    transactionDate,
    alternativeDates: altDates,
    merchant,
    reason,
    reasonAlternatives,
  };
}

export function sanitizeModelName(model: string | undefined): string {
  const m = (model || DEFAULT_GEMINI_MODEL).trim();
  return /^[a-z0-9._-]+$/i.test(m) ? m : DEFAULT_GEMINI_MODEL;
}

export interface ExtractionResult {
  extraction: ReceiptExtraction;
  raw: unknown;
}

export async function extractReceipt(opts: {
  imageDataUrl: string;
  apiKey: string;
  model?: string;
  context: ExtractContext;
}): Promise<ExtractionResult> {
  const model = sanitizeModelName(opts.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const base64 = opts.imageDataUrl.split(',')[1] ?? '';

  const makeBody = (temperature: number, retryNote: boolean) => ({
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: buildPrompt(opts.context) + (retryNote ? '\n\nReturn ONLY valid JSON matching the schema exactly.' : '') },
        ],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  });

  let res = await callOnce(url, makeBody(0.2, false));
  let parsed: unknown;
  try {
    parsed = JSON.parse(parseText(res));
  } catch {
    // One retry at temperature 0 — MAX_TOKENS truncation is the usual cause.
    try {
      res = await callOnce(url, makeBody(0, true));
      parsed = JSON.parse(parseText(res));
    } catch (err) {
      if (err instanceof GeminiError) throw err;
      throw new GeminiError(
        'Gemini returned an unexpected format. Enter the details manually or retry.',
        'parse',
      );
    }
  }

  return { extraction: sanitize(parsed), raw: parsed };
}

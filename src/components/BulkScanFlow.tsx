import { useEffect, useRef, useState } from 'react';
import type { Company, Project } from '../types';
import { blobToArrayBuffer, processImageFile, type ProcessedImage } from '../lib/image';
import { formatAmount } from '../lib/currency';
import { todayLocal } from '../lib/date';
import { newId } from '../lib/id';
import { extractReceipt, GeminiError, type ReceiptExtraction } from '../services/gemini';
import { useAppData } from '../state/AppDataContext';
import { useSettings } from '../state/SettingsContext';
import { useToast } from '../state/ToastContext';
import { useDrive } from '../state/DriveContext';
import { useConfirm } from '../state/ConfirmContext';
import { Modal } from './Modal';
import { Button, ICONS, Icon, Spinner } from './ui';
import { ReceiptReviewForm } from './ReceiptReviewForm';

/**
 * Bulk scan: snap receipt photos back-to-back — each one is compressed and
 * sent to Gemini in the background (a small concurrent pool, so bursts stay
 * under the free-tier rate limit) while the user keeps taking pictures.
 * When they're done, every receipt lands in a confirmation list that reuses
 * the same review form as the single-scan flow.
 */

const MAX_CONCURRENT = 3;

type BulkStatus = 'queued' | 'processing' | 'extracting' | 'ready' | 'error' | 'saving' | 'saved';

interface BulkItem {
  id: string;
  file: File | null;
  image: ProcessedImage | null;
  status: BulkStatus;
  error: string;
  extraction: ReceiptExtraction | null;
  // Review fields, seeded from the extraction once it completes.
  amount: string;
  currency: string;
  date: string;
  reason: string;
  merchant: string;
}

function newBulkItem(file: File, defaultCurrency: string): BulkItem {
  return {
    id: newId(),
    file,
    image: null,
    status: 'queued',
    error: '',
    extraction: null,
    amount: '',
    currency: defaultCurrency,
    date: todayLocal(),
    reason: '',
    merchant: '',
  };
}

function statusLabel(item: BulkItem): { text: string; kind: 'busy' | 'ok' | 'err' } {
  switch (item.status) {
    case 'queued':
      return { text: 'Waiting…', kind: 'busy' };
    case 'processing':
      return { text: 'Preparing photo…', kind: 'busy' };
    case 'extracting':
      return { text: 'Reading with Gemini…', kind: 'busy' };
    case 'ready':
      return { text: 'Ready to confirm', kind: 'ok' };
    case 'saving':
      return { text: 'Saving…', kind: 'busy' };
    case 'saved':
      return { text: 'Saved', kind: 'ok' };
    case 'error':
      return { text: item.error || 'Could not read this receipt.', kind: 'err' };
  }
}

export function BulkScanFlow({
  company,
  project,
  onClose,
  onManual,
}: {
  company: Company;
  project: Project;
  onClose: () => void;
  onManual: () => void;
}) {
  const appData = useAppData();
  const { get } = useSettings();
  const { toast } = useToast();
  const drive = useDrive();
  const { confirm } = useConfirm();

  const apiKey = get<string>('geminiKey') ?? '';
  const model = get<string>('geminiModel');
  const home = get<string>('homeCurrency') ?? 'HKD';
  const defaultCurrency = get<string>('defaultCurrency') ?? 'HKD';

  const [step, setStep] = useState<'capture' | 'review'>('capture');
  const [items, setItems] = useState<BulkItem[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const inflight = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const processItem = async (item: BulkItem) => {
    const patch = (p: Partial<BulkItem>) =>
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...p } : i)));
    patch({ status: 'processing' });
    try {
      const img = await processImageFile(item.file!);
      if (!mounted.current) return;
      patch({ image: img, status: 'extracting' });
      const { extraction } = await extractReceipt({
        imageDataUrl: img.dataUrl,
        apiKey,
        model,
        context: {
          companyName: company.name,
          projectName: project.name,
          projectDescription: project.description,
        },
      });
      if (!mounted.current) return;
      patch({
        extraction,
        status: 'ready',
        amount: extraction.totalAmount != null ? String(extraction.totalAmount) : '',
        currency: extraction.currency || defaultCurrency,
        date: extraction.transactionDate || todayLocal(),
        reason: extraction.reason,
        merchant: extraction.merchant,
      });
    } catch (err) {
      if (!mounted.current) return;
      patch({
        status: 'error',
        error: err instanceof GeminiError ? err.message : 'Something went wrong reading the receipt.',
      });
    }
  };

  // Worker pool: keep up to MAX_CONCURRENT receipts being read at once, so the
  // user can keep snapping while Gemini works in the background.
  useEffect(() => {
    const active =
      items.filter((i) => i.status === 'processing' || i.status === 'extracting' || i.status === 'saving').length +
      inflight.current.size;
    const capacity = MAX_CONCURRENT - active;
    if (capacity <= 0) return;
    const queued = items.filter((i) => i.status === 'queued' && !inflight.current.has(i.id)).slice(0, capacity);
    for (const item of queued) {
      inflight.current.add(item.id);
      void processItem(item).finally(() => inflight.current.delete(item.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const onFile = (file: File) => {
    setItems((prev) => [...prev, newBulkItem(file, defaultCurrency)]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (reviewingId === id) setReviewingId(null);
  };

  const retryItem = (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'queued', error: '' } : i)));
  };

  const saveItem = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || !item.image || item.status !== 'ready') return;
    const amountNum = parseFloat(item.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'saving' } : i)));
    try {
      await appData.addTransaction({
        projectId: project.id,
        type: 'expense',
        amount: Math.round(amountNum * 100) / 100,
        currency: item.currency || defaultCurrency,
        date: item.date,
        merchant: item.merchant.trim() || undefined,
        description: item.reason.trim() || undefined,
        receipt: {
          blobData: await blobToArrayBuffer(item.image.blob),
          blobType: item.image.blob.type,
          thumbDataUrl: item.image.thumbDataUrl,
          thumbW: item.image.thumbWidth,
          thumbH: item.image.thumbHeight,
          syncState: 'local',
        },
        llmExtraction: item.extraction
          ? {
              amountCandidates: item.extraction.alternativeAmounts,
              dateCandidates: item.extraction.alternativeDates,
              reasonCandidates: item.extraction.reasonAlternatives,
              merchant: item.extraction.merchant,
              raw: undefined,
            }
          : undefined,
      });
      toast('Expense saved', 'success');
      if (drive.status === 'ready') void drive.syncNow();
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'saved' } : i)));
      setReviewingId(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this expense', 'error');
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'ready' } : i)));
    }
  };

  const unsavedCount = items.filter((i) => i.status !== 'saved').length;

  const requestClose = async () => {
    if (unsavedCount > 0) {
      const ok = await confirm({
        title: 'Close bulk scan?',
        message: `${unsavedCount} receipt(s) haven't been saved yet and will be discarded.`,
        confirmLabel: 'Close anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  const hasApiKey = Boolean(apiKey.trim());
  const reviewing = items.find((i) => i.id === reviewingId) ?? null;
  const readyCount = items.filter((i) => i.status === 'ready').length;

  return (
    <Modal title={step === 'review' ? 'Confirm receipts' : 'Bulk scan'} onClose={() => void requestClose()} full>
      {!hasApiKey && (
        <div className="warning-banner">
          <Icon paths={[...ICONS.alert]} size={18} />
          Add your Gemini API key in Settings to enable receipt scanning.
        </div>
      )}

      {step === 'capture' && (
        <div className="bulk-capture">
          <p className="bulk-hint">
            Tap the shutter for each receipt. Photos are read by Gemini in the background — keep snapping until
            you're done.
          </p>

          <button
            type="button"
            className="bulk-shutter"
            onClick={() => cameraRef.current?.click()}
            disabled={!hasApiKey}
            aria-label="Take receipt photo"
          >
            <Icon paths={[...ICONS.camera]} size={46} />
          </button>
          <div className="bulk-shutter-label">Take photo</div>
          <button type="button" className="bulk-library" onClick={() => libraryRef.current?.click()} disabled={!hasApiKey}>
            or choose from library
          </button>

          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />

          {items.length > 0 && (
            <>
              <div className="bulk-progress">
                {items.length} receipt{items.length === 1 ? '' : 's'} captured · {readyCount} ready
              </div>
              <div className="bulk-list">
                {items.map((item) => {
                  const s = statusLabel(item);
                  const amountNum = parseFloat(item.amount);
                  return (
                    <div key={item.id} className="bulk-item">
                      {item.image ? (
                        <img src={item.image.thumbDataUrl} alt="Receipt" className="bulk-item-thumb" />
                      ) : (
                        <span className="bulk-item-thumb bulk-item-thumb-empty">
                          <Icon paths={[...ICONS.receipt]} size={20} />
                        </span>
                      )}
                      <div className="bulk-item-main">
                        <div className="bulk-item-title">
                          {item.status === 'ready' && Number.isFinite(amountNum) && amountNum > 0
                            ? `${formatAmount(amountNum, item.currency)}${item.merchant ? ' · ' + item.merchant : ''}`
                            : 'Receipt'}
                        </div>
                        <div className={`bulk-item-status bulk-item-status-${s.kind}`}>
                          {s.kind === 'busy' ? <Spinner size={12} /> : null}
                          {s.text}
                        </div>
                      </div>
                      <div className="bulk-item-actions">
                        {item.status === 'error' && (
                          <Button variant="ghost" icon="refresh" onClick={() => retryItem(item.id)}>
                            Retry
                          </Button>
                        )}
                        <button
                          type="button"
                          className="btn-icon btn-icon-danger"
                          aria-label="Remove receipt"
                          onClick={() => removeItem(item.id)}
                        >
                          <Icon paths={[...ICONS.trash]} size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="btn-row btn-row-sticky">
            <Button variant="ghost" onClick={onManual}>
              Enter manually instead
            </Button>
            <Button variant="primary" icon="check" onClick={() => setStep('review')} disabled={items.length === 0}>
              Review &amp; confirm ({items.length})
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="bulk-review">
          <div className="bulk-review-head">
            <Button variant="secondary" icon="camera" onClick={() => setStep('capture')}>
              Add more photos
            </Button>
            <span className="bulk-review-count">
              {items.filter((i) => i.status === 'saved').length} of {items.length} saved
            </span>
          </div>

          {reviewing && reviewing.image && (
            <>
              <ReceiptReviewForm
                image={reviewing.image}
                extraction={reviewing.extraction}
                projectName={project.name}
                homeCurrency={home}
                amount={reviewing.amount}
                currency={reviewing.currency}
                date={reviewing.date}
                reason={reviewing.reason}
                merchant={reviewing.merchant}
                onAmount={(v) => setItems((prev) => prev.map((i) => (i.id === reviewing.id ? { ...i, amount: v } : i)))}
                onCurrency={(v) => setItems((prev) => prev.map((i) => (i.id === reviewing.id ? { ...i, currency: v } : i)))}
                onDate={(v) => setItems((prev) => prev.map((i) => (i.id === reviewing.id ? { ...i, date: v } : i)))}
                onReason={(v) => setItems((prev) => prev.map((i) => (i.id === reviewing.id ? { ...i, reason: v } : i)))}
                onMerchant={(v) => setItems((prev) => prev.map((i) => (i.id === reviewing.id ? { ...i, merchant: v } : i)))}
                saving={reviewing.status === 'saving'}
                onSave={() => void saveItem(reviewing.id)}
                footerLeft={
                  <Button variant="secondary" onClick={() => setReviewingId(null)}>
                    Back to list
                  </Button>
                }
              />
              <div className="btn-row">
                <Button variant="primary" icon="check" onClick={() => void requestClose()}>
                  Finish
                </Button>
              </div>
            </>
          )}

          {!reviewing && (
            <>
              <div className="bulk-list">
                {items.map((item) => {
                  const s = statusLabel(item);
                  const amountNum = parseFloat(item.amount);
                  const saved = item.status === 'saved';
                  return (
                    <div key={item.id} className={`bulk-item${saved ? ' bulk-item-saved' : ''}`}>
                      {item.image ? (
                        <img src={item.image.thumbDataUrl} alt="Receipt" className="bulk-item-thumb" />
                      ) : (
                        <span className="bulk-item-thumb bulk-item-thumb-empty">
                          <Icon paths={[...ICONS.receipt]} size={20} />
                        </span>
                      )}
                      <div className="bulk-item-main">
                        <div className="bulk-item-title">
                          {item.status === 'ready' && Number.isFinite(amountNum) && amountNum > 0
                            ? `${formatAmount(amountNum, item.currency)}${item.merchant ? ' · ' + item.merchant : ''}`
                            : 'Receipt'}
                        </div>
                        <div className={`bulk-item-status bulk-item-status-${s.kind}`}>
                          {s.kind === 'busy' ? <Spinner size={12} /> : saved ? <Icon paths={[...ICONS.check]} size={13} /> : null}
                          {s.text}
                        </div>
                      </div>
                      <div className="bulk-item-actions">
                        {item.status === 'error' && (
                          <Button variant="ghost" icon="refresh" onClick={() => retryItem(item.id)}>
                            Retry
                          </Button>
                        )}
                        {item.status === 'ready' && (
                          <Button variant="secondary" onClick={() => setReviewingId(item.id)}>
                            Confirm
                          </Button>
                        )}
                        {!saved && (
                          <button
                            type="button"
                            className="btn-icon btn-icon-danger"
                            aria-label="Remove receipt"
                            onClick={() => removeItem(item.id)}
                          >
                            <Icon paths={[...ICONS.trash]} size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="btn-row btn-row-sticky">
                <Button variant="ghost" onClick={onManual}>
                  Enter manually instead
                </Button>
                <Button variant="primary" icon="check" onClick={() => void requestClose()}>
                  Finish
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

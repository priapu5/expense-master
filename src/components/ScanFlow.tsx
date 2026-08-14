import { useRef, useState } from 'react';
import type { Company, Project } from '../types';
import { blobToArrayBuffer, processImageFile, type ProcessedImage } from '../lib/image';
import { todayLocal } from '../lib/date';
import { extractReceipt, GeminiError, type ReceiptExtraction } from '../services/gemini';
import { useAppData } from '../state/AppDataContext';
import { useSettings } from '../state/SettingsContext';
import { useToast } from '../state/ToastContext';
import { useDrive } from '../state/DriveContext';
import { Modal } from './Modal';
import { Button, ICONS, Icon, Spinner } from './ui';
import { ReceiptReviewForm } from './ReceiptReviewForm';

type Step = 'pick' | 'processing' | 'extracting' | 'review' | 'error';

export function ScanFlow({
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

  const apiKey = get<string>('geminiKey') ?? '';
  const model = get<string>('geminiModel');
  const home = get<string>('homeCurrency') ?? 'HKD';
  const defaultCurrency = get<string>('defaultCurrency') ?? 'HKD';

  const [step, setStep] = useState<Step>(apiKey.trim() ? 'pick' : 'error');
  const [error, setError] = useState(apiKey.trim() ? '' : 'Add your Gemini API key in Settings first, then come back.');
  const [image, setImage] = useState<ProcessedImage | null>(null);
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(null);

  // Review fields
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState('');
  const [merchant, setMerchant] = useState('');
  const [saving, setSaving] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const runExtraction = async (img: ProcessedImage) => {
    const id = ++runId.current;
    setStep('extracting');
    try {
      const { extraction: ex } = await extractReceipt({
        imageDataUrl: img.dataUrl,
        apiKey,
        model,
        context: {
          companyName: company.name,
          projectName: project.name,
          projectDescription: project.description,
        },
      });
      if (runId.current !== id) return; // user left mid-flight
      setExtraction(ex);
      setAmount(ex.totalAmount != null ? String(ex.totalAmount) : '');
      setCurrency(ex.currency || defaultCurrency);
      setDate(ex.transactionDate || todayLocal());
      setReason(ex.reason);
      setMerchant(ex.merchant);
      setStep('review');
    } catch (err) {
      if (runId.current !== id) return;
      setError(err instanceof GeminiError ? err.message : 'Something went wrong reading the receipt.');
      setStep('error');
    }
  };

  const onFile = async (file: File) => {
    setStep('processing');
    try {
      const img = await processImageFile(file);
      setImage(img);
      await runExtraction(img);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
      setStep('error');
    }
  };

  const save = async () => {
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    if (!image) return;
    setSaving(true);
    try {
      await appData.addTransaction({
        projectId: project.id,
        type: 'expense',
        amount: Math.round(amountNum * 100) / 100,
        currency: currency || defaultCurrency,
        date,
        merchant: merchant.trim() || undefined,
        description: reason.trim() || undefined,
        receipt: {
          blobData: await blobToArrayBuffer(image.blob),
          blobType: image.blob.type,
          thumbDataUrl: image.thumbDataUrl,
          thumbW: image.thumbWidth,
          thumbH: image.thumbHeight,
          syncState: 'local',
        },
        llmExtraction: extraction
          ? {
              amountCandidates: extraction.alternativeAmounts,
              dateCandidates: extraction.alternativeDates,
              reasonCandidates: extraction.reasonAlternatives,
              merchant: extraction.merchant,
              raw: undefined,
            }
          : undefined,
      });
      toast('Expense saved', 'success');
      if (drive.status === 'ready') void drive.syncNow();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hasApiKey = Boolean(apiKey.trim());

  return (
    <Modal title="Scan receipt" onClose={onClose} full>
      {step === 'pick' && (
        <div className="scan-pick">
          {!hasApiKey && (
            <div className="warning-banner">
              <Icon paths={[...ICONS.alert]} size={18} />
              Add your Gemini API key in Settings to enable receipt scanning.
            </div>
          )}
          <button
            type="button"
            className="scan-option"
            onClick={() => cameraRef.current?.click()}
            disabled={!hasApiKey}
          >
            <Icon paths={[...ICONS.camera]} size={34} />
            <span>Take photo</span>
            <small>Uses the camera</small>
          </button>
          <button
            type="button"
            className="scan-option"
            onClick={() => libraryRef.current?.click()}
            disabled={!hasApiKey}
          >
            <Icon paths={[...ICONS.photo]} size={34} />
            <span>Choose from library</span>
            <small>Pick an existing receipt photo</small>
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
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
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <p className="scan-privacy">
            The photo is sent to Google Gemini (free tier) to read it, then saved on this device and — if
            connected — to your own Google Drive. Nothing else.
          </p>
        </div>
      )}

      {(step === 'processing' || step === 'extracting') && (
        <div className="scan-working">
          {image && <img src={image.thumbDataUrl} alt="Receipt preview" className="scan-preview-img" />}
          <Spinner size={34} />
          <div className="scan-working-title">
            {step === 'processing' ? 'Preparing photo…' : 'Reading receipt with Gemini…'}
          </div>
          <div className="scan-working-sub">
            {step === 'extracting'
              ? 'Extracting the total, date and a reason matching this project. Free-tier requests can take a few seconds.'
              : 'Compressing the image before sending.'}
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="scan-error">
          <div className="warning-banner warning-banner-big">
            <Icon paths={[...ICONS.alert]} size={20} />
            {error}
          </div>
          <div className="btn-row">
            {hasApiKey && image && (
              <Button variant="secondary" icon="refresh" onClick={() => void runExtraction(image)}>
                Try again
              </Button>
            )}
            {hasApiKey && !image && (
              <Button variant="secondary" icon="camera" onClick={() => setStep('pick')}>
                Take another photo
              </Button>
            )}
            <Button variant="primary" icon="pencil" onClick={onManual}>
              Enter manually
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && image && (
        <ReceiptReviewForm
          image={image}
          extraction={extraction}
          projectName={project.name}
          homeCurrency={home}
          amount={amount}
          currency={currency}
          date={date}
          reason={reason}
          merchant={merchant}
          onAmount={setAmount}
          onCurrency={setCurrency}
          onDate={setDate}
          onReason={setReason}
          onMerchant={setMerchant}
          saving={saving}
          onSave={() => void save()}
          footerLeft={
            <Button variant="secondary" onClick={() => setStep('pick')}>
              Retake
            </Button>
          }
        />
      )}
    </Modal>
  );
}

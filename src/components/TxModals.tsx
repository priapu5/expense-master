import { useEffect, useMemo, useState, useRef } from 'react';
import type { Transaction } from '../types';
import { arrayBufferToBlob, blobToArrayBuffer, processImageFile } from '../lib/image';
import { formatAmount, formatNumber } from '../lib/currency';
import { formatDate, todayLocal } from '../lib/date';
import { deleteDriveFileBestEffort } from '../services/drive';
import { useAppData } from '../state/AppDataContext';
import { useSettings } from '../state/SettingsContext';
import { useConfirm } from '../state/ConfirmContext';
import { useToast } from '../state/ToastContext';
import { useDrive } from '../state/DriveContext';
import { Modal } from './Modal';
import { Button, ICONS, Icon, Input, Spinner, SyncBadge } from './ui';
import { AmountField, DateField, Field } from './fields';

// ---------- view / edit / delete ----------

export function TxViewModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const appData = useAppData();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const project = appData.projectById.get(tx.projectId);
  const company = project ? appData.companyById.get(project.companyId) : undefined;
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (tx.receipt?.blobData) {
      const url = URL.createObjectURL(arrayBufferToBlob(tx.receipt.blobData, tx.receipt.blobType));
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setImageUrl(null);
    return undefined;
  }, [tx]);

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: 'This permanently removes the record from this device. Receipts already uploaded to Google Drive are kept there.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await appData.deleteTransaction(tx.id);
    toast('Transaction deleted', 'success');
    onClose();
  };

  if (editing) {
    return <TxFormModal mode={tx.type} tx={tx} projectId={tx.projectId} onClose={onClose} />;
  }

  return (
    <Modal title={tx.type === 'expense' ? 'Expense' : 'Revenue'} onClose={onClose}>
      <div className="tx-view-amount">
        <span className={`tx-amount ${tx.type === 'expense' ? 'tone-neg' : 'tone-pos'}`}>
          {formatAmount(tx.amount, tx.currency)}
        </span>
        <SyncBadge tx={tx} />
      </div>
      <div className="kv-list">
        {tx.description && (
          <div className="kv">
            <span className="kv-label">Item</span>
            <span className="kv-value">{tx.description}</span>
          </div>
        )}
        {tx.merchant && (
          <div className="kv">
            <span className="kv-label">Merchant</span>
            <span className="kv-value">{tx.merchant}</span>
          </div>
        )}
        <div className="kv">
          <span className="kv-label">Date</span>
          <span className="kv-value">{formatDate(tx.date)}</span>
        </div>
        <div className="kv">
          <span className="kv-label">Project</span>
          <span className="kv-value">
            {company?.name} · {project?.name ?? '—'}
          </span>
        </div>
      </div>
      {tx.receipt && (
        <div className="tx-view-image">
          {imageUrl ? <img src={imageUrl} alt="Receipt" className="review-img" /> : tx.receipt.thumbDataUrl && <img src={tx.receipt.thumbDataUrl} alt="Receipt thumbnail" className="review-img" />}
          {tx.receipt.driveUrl && (
            <a className="btn btn-secondary" href={tx.receipt.driveUrl} target="_blank" rel="noopener noreferrer">
              <Icon paths={[...ICONS.drive]} size={18} /> Open in Google Drive
            </a>
          )}
        </div>
      )}
      <div className="btn-row">
        <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" icon="trash" onClick={() => void onDelete()}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}

// ---------- manual entry / edit form ----------

export function TxFormModal({
  mode,
  tx,
  projectId,
  onClose,
}: {
  mode: 'expense' | 'revenue';
  tx?: Transaction;
  projectId: string;
  onClose: () => void;
}) {
  const appData = useAppData();
  const { get } = useSettings();
  const { toast } = useToast();
  const drive = useDrive();
  const home = get<string>('homeCurrency') ?? 'HKD';
  const defaultCurrency = get<string>('defaultCurrency') ?? 'HKD';

  const [description, setDescription] = useState(tx?.description ?? '');
  const [merchant, setMerchant] = useState(tx?.merchant ?? '');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [currency, setCurrency] = useState(tx?.currency ?? defaultCurrency);
  const [date, setDate] = useState(tx?.date ?? todayLocal());
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const amountNum = parseFloat(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0;

  const save = async () => {
    if (!valid) {
      toast('Enter a valid amount', 'error');
      return;
    }
    setSaving(true);
    try {
      if (tx) {
        await appData.updateTransaction({
          ...tx,
          amount: Math.round(amountNum * 100) / 100,
          currency,
          date,
          merchant: mode === 'expense' ? merchant.trim() || undefined : undefined,
          description: description.trim() || undefined,
        });
        toast('Transaction updated', 'success');
      } else {
        await appData.addTransaction({
          projectId,
          type: mode,
          amount: Math.round(amountNum * 100) / 100,
          currency,
          date,
          merchant: mode === 'expense' ? merchant.trim() || undefined : undefined,
          description: description.trim() || undefined,
        });
        toast(mode === 'expense' ? 'Expense added' : 'Revenue added', 'success');
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const replacePhoto = async (file: File) => {
    if (!tx?.receipt) return;
    setReplacing(true);
    try {
      const img = await processImageFile(file);
      const oldFileId = tx.receipt.driveFileId;
      const receipt = {
        ...tx.receipt,
        blobData: await blobToArrayBuffer(img.blob),
        blobType: img.blob.type,
        thumbDataUrl: img.thumbDataUrl,
        thumbW: img.thumbWidth,
        thumbH: img.thumbHeight,
        syncState: 'local' as const,
        driveFileId: undefined,
        driveUrl: undefined,
        driveName: undefined,
        syncError: undefined,
      };
      await appData.updateTransaction({ ...tx, receipt });
      if (oldFileId) void deleteDriveFileBestEffort(oldFileId);
      if (drive.status === 'ready') void drive.syncNow();
      toast('Receipt photo replaced — syncing to Drive', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not process that photo', 'error');
    } finally {
      setReplacing(false);
    }
  };

  return (
    <Modal title={tx ? `Edit ${mode}` : mode === 'expense' ? 'New expense' : 'New revenue'} onClose={onClose}>
      <Field label={mode === 'expense' ? 'Item / description' : 'Description'}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={mode === 'expense' ? 'e.g. Camera lens for travel vlog' : 'e.g. YouTube AdSense payout'}
          autoFocus={!tx}
        />
      </Field>
      {mode === 'expense' && (
        <Field label="Merchant (optional)">
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Big Camera Store" />
        </Field>
      )}
      <Field label="Amount">
        <AmountField
          value={amount}
          onChange={setAmount}
          currency={currency}
          onCurrencyChange={setCurrency}
          date={date}
          homeCurrency={home}
        />
      </Field>
      <Field label="Date">
        <DateField value={date} onChange={setDate} showTodayChip />
      </Field>
      {tx?.receipt && (
        <div className="replace-photo">
          <img src={tx.receipt.thumbDataUrl} alt="Current receipt" className="thumb" />
          <div className="replace-photo-actions">
            <Button variant="secondary" icon="photo" onClick={() => fileRef.current?.click()} disabled={replacing}>
              {replacing ? <Spinner size={16} /> : 'Replace photo'}
            </Button>
            <span className="muted">New photo re-syncs to Google Drive</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void replacePhoto(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
      <div className="btn-row">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || replacing}>
          {saving ? <Spinner size={16} /> : 'Save'}
        </Button>
      </div>
      {!valid && amount !== '' && <div className="field-hint">Amount must be greater than 0</div>}
    </Modal>
  );
}

export function useTxFormSummary(tx: Transaction | undefined): string {
  return useMemo(() => (tx ? `${formatDate(tx.date)} · ${formatNumber(tx.amount, 2)} ${tx.currency}` : ''), [tx]);
}

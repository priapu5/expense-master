import { useCallback, useMemo, useRef, useState } from 'react';
import type { Company, Transaction } from '../../types';
import { processImageFile } from '../../lib/image';
import { formatAmount } from '../../lib/currency';
import { useAppData } from '../../state/AppDataContext';
import { useSettings } from '../../state/SettingsContext';
import { useConfirm } from '../../state/ConfirmContext';
import { useToast } from '../../state/ToastContext';
import { useHomeTotalsByKey } from '../../hooks/useHomeTotalsByKey';
import { totalsByCurrency } from '../../lib/totals';
import { Screen } from '../../components/layout';
import { Modal } from '../../components/Modal';
import { Button, EmptyState, ICONS, Icon, IconView, Input, Spinner } from '../../components/ui';

const EMOJIS = ['🏢', '🎬', '📹', '✈️', '🍜', '☕', '🛍️', '💻', '📷', '🚗', '🏠', '💼', '🎨', '📦', '🍔', '🛠️', '🎵', '📚', '🏋️', '💇', '✂️', '🐶', '🌿', '🧾'];

export function CompaniesScreen({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const appData = useAppData();
  const { get } = useSettings();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const home = get<string>('homeCurrency') ?? 'HKD';
  const [formCompany, setFormCompany] = useState<Company | null | undefined>(undefined); // null = new

  const txsByCompany = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of appData.transactions) {
      const cid = appData.projectById.get(t.projectId)?.companyId;
      if (cid) {
        const arr = map.get(cid) ?? [];
        arr.push(t);
        map.set(cid, arr);
      }
    }
    return map;
  }, [appData.transactions, appData.projectById]);

  const keyFn = useCallback(
    (t: Transaction) => appData.projectById.get(t.projectId)?.companyId ?? null,
    [appData.projectById],
  );
  const { byKey: homeByCompany, loading: homeLoading } = useHomeTotalsByKey(appData.transactions, keyFn, home);

  const onDelete = async (c: Company) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      message: 'This removes the company, all its projects and all its transactions from this device. Receipts already uploaded to Google Drive are kept there.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await appData.deleteCompany(c.id);
    toast('Company deleted', 'success');
  };

  return (
    <Screen
      title="Companies"
      scrollKey="companies"
      actions={
        <Button variant="primary" icon="plus" onClick={() => setFormCompany(null)}>
          Add
        </Button>
      }
    >
      {appData.companies.length === 0 ? (
        <EmptyState
          icon="building"
          title="No companies yet"
          text="Create a company (e.g. your media production business), then add projects like “Phuket Trip 2026 vlog”."
        />
      ) : (
        <div className="company-grid">
          {appData.companies.map((c) => {
            const txs = txsByCompany.get(c.id) ?? [];
            const byCur = totalsByCurrency(txs);
            const h = homeByCompany.get(c.id);
            const expenseLabel =
              byCur.size === 0
                ? 'No transactions'
                : [...byCur.entries()]
                    .map(([cur, v]) => `${formatAmount(v.expense, cur, 0)} ${cur}`)
                    .join(' · ');
            return (
              <div key={c.id} className="card company-card" role="button" tabIndex={0} onClick={() => onOpenCompany(c.id)}>
                <div className="company-card-top">
                  <IconView icon={c.icon} size={48} />
                  <div className="company-card-btns">
                    <button
                      type="button"
                      className="btn-icon btn-icon-sm"
                      aria-label={`Edit ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormCompany(c);
                      }}
                    >
                      <Icon paths={[...ICONS.pencil]} size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon-sm btn-icon-danger"
                      aria-label={`Delete ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(c);
                      }}
                    >
                      <Icon paths={[...ICONS.trash]} size={15} />
                    </button>
                  </div>
                </div>
                <div className="company-name">{c.name}</div>
                <div className="company-meta">
                  <span>{appData.projects.filter((p) => p.companyId === c.id).length} projects</span>
                  <span className="company-expense">{expenseLabel}</span>
                  {h && (
                    <span className="company-home">
                      {homeLoading ? '…' : `≈ ${formatAmount(h.expense, home, 0)} ${home} expensed`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {formCompany !== undefined && (
        <CompanyFormModal company={formCompany ?? undefined} onClose={() => setFormCompany(undefined)} />
      )}
    </Screen>
  );
}

export function CompanyFormModal({ company, onClose }: { company?: Company; onClose: () => void }) {
  const appData = useAppData();
  const { toast } = useToast();
  const [name, setName] = useState(company?.name ?? '');
  const [emoji, setEmoji] = useState<string>(company?.icon.kind === 'emoji' ? company.icon.value : EMOJIS[0]);
  const [imgDataUrl, setImgDataUrl] = useState<string | undefined>(company?.icon.kind === 'img' ? company.icon.dataUrl : undefined);
  const [useImg, setUseImg] = useState(company?.icon.kind === 'img');
  const [saving, setSaving] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = async (file: File) => {
    setIconBusy(true);
    try {
      const img = await processImageFile(file, { maxDim: 128, quality: 0.85 });
      setImgDataUrl(img.dataUrl);
      setUseImg(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that image', 'error');
    } finally {
      setIconBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      toast('Give the company a name', 'error');
      return;
    }
    setSaving(true);
    try {
      const icon = useImg && imgDataUrl ? { kind: 'img' as const, dataUrl: imgDataUrl } : { kind: 'emoji' as const, value: emoji };
      if (company) {
        await appData.updateCompany({ ...company, name: name.trim(), icon });
        toast('Company updated', 'success');
      } else {
        await appData.createCompany({ name: name.trim(), icon });
        toast('Company created', 'success');
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={company ? 'Edit company' : 'New company'} onClose={onClose}>
      <div className="field">
        <label className="field-label">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Media Production Co." autoFocus />
      </div>
      <div className="field">
        <label className="field-label">Icon</label>
        <div className="icon-picker">
          <div className="icon-picker-preview">
            {useImg && imgDataUrl ? (
              <img src={imgDataUrl} alt="Company icon" className="icon-picker-img" />
            ) : (
              <span className="icon-picker-emoji">{emoji}</span>
            )}
          </div>
          <Button variant="secondary" icon="photo" onClick={() => fileRef.current?.click()} disabled={iconBusy}>
            {iconBusy ? <Spinner size={16} /> : 'Use photo…'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
              e.target.value = '';
            }}
          />
        </div>
        {!useImg && (
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={`emoji-cell${emoji === e ? ' emoji-selected' : ''}`}
                onClick={() => setEmoji(e)}
                aria-label={`Icon ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="btn-row">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || iconBusy}>
          {saving ? <Spinner size={16} /> : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

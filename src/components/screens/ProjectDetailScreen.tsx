import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../../types';
import { arrayBufferToBlob } from '../../lib/image';
import { formatAmount, formatNumber } from '../../lib/currency';
import { formatDate, formatDateShort } from '../../lib/date';
import { totalsByCurrency } from '../../lib/totals';
import { useAppData } from '../../state/AppDataContext';
import { useSettings } from '../../state/SettingsContext';
import { useConfirm } from '../../state/ConfirmContext';
import { useToast } from '../../state/ToastContext';
import { useDrive } from '../../state/DriveContext';
import { Screen } from '../../components/layout';
import { TotalsCard } from '../../components/TotalsCard';
import { Modal } from '../../components/Modal';
import { Button, EmptyState, ICONS, Icon, SyncBadge } from '../../components/ui';
import { TxFormModal, TxViewModal } from '../../components/TxModals';
import { ProjectFormModal } from './CompanyDetailScreen';
import { ScanFlow } from '../../components/ScanFlow';
import { BulkScanFlow } from '../../components/BulkScanFlow';

export function ProjectDetailScreen({
  projectId,
  onBack,
  onOpenSettings,
}: {
  projectId: string;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const appData = useAppData();
  const { get } = useSettings();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const drive = useDrive();
  const home = get<string>('homeCurrency') ?? 'HKD';
  const apiKey = get<string>('geminiKey');

  const project = appData.projectById.get(projectId);
  const company = project ? appData.companyById.get(project.companyId) : undefined;
  const txs = useMemo(() => appData.transactions.filter((t) => t.projectId === projectId), [appData.transactions, projectId]);

  const [addMenu, setAddMenu] = useState<'expense' | null>(null);
  const [revenueForm, setRevenueForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState(false);
  const [scan, setScan] = useState(false);
  const [bulkScan, setBulkScan] = useState(false);
  const [editProject, setEditProject] = useState(false);
  const [viewTx, setViewTx] = useState<Transaction | null>(null);

  const groups = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const t of txs) {
      const arr = byDate.get(t.date) ?? [];
      arr.push(t);
      byDate.set(t.date, arr);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, items]) => ({ date, items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
  }, [txs]);

  if (!project) {
    return (
      <Screen title="Project" onBack={onBack}>
        <EmptyState icon="folder" title="Project not found" />
      </Screen>
    );
  }

  const startScan = () => {
    if (!apiKey?.trim()) {
      toast('Add your Gemini API key in Settings first', 'error');
      onOpenSettings();
      return;
    }
    setScan(true);
  };

  const startBulkScan = () => {
    if (!apiKey?.trim()) {
      toast('Add your Gemini API key in Settings first', 'error');
      onOpenSettings();
      return;
    }
    setBulkScan(true);
  };

  const onDeleteProject = async () => {
    const ok = await confirm({
      title: `Delete project "${project.name}"?`,
      message: `All ${txs.length} transaction(s) are removed from this device. Receipts already in Google Drive are kept there.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await appData.deleteProject(project.id);
    toast('Project deleted', 'success');
    onBack();
  };

  return (
    <Screen
      title={project.name}
      onBack={onBack}
      scrollKey={`project-${projectId}`}
      actions={
        <>
          <button type="button" className="btn-icon" aria-label="Edit project" onClick={() => setEditProject(true)}>
            <Icon paths={[...ICONS.pencil]} size={18} />
          </button>
          <button type="button" className="btn-icon btn-icon-danger" aria-label="Delete project" onClick={() => void onDeleteProject()}>
            <Icon paths={[...ICONS.trash]} size={18} />
          </button>
        </>
      }
    >
      {project.description && <p className="project-description">{project.description}</p>}
      <TotalsCard txs={txs} home={home} />

      <div className="add-buttons">
        <Button variant="primary" icon="camera" onClick={() => setAddMenu('expense')}>
          Add expense
        </Button>
        <Button variant="accent" icon="plus" onClick={() => setRevenueForm(true)}>
          Add revenue
        </Button>
      </div>

      {txs.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No transactions yet"
          text="Scan a receipt with the camera, or enter an expense manually."
        />
      ) : (
        groups.map((g) => {
          const cur = totalsByCurrency(g.items);
          const dayExpense = [...cur.values()].reduce((s, v) => s + v.expense, 0);
          return (
            <div key={g.date} className="tx-group">
              <div className="group-header">
                <span>{formatDate(g.date)}</span>
                <span className="group-total">
                  {[...cur.entries()]
                    .map(([c, v]) => `${formatAmount(v.expense, c, 0)} ${c}`)
                    .join(' · ') || `− ${formatNumber(dayExpense)}`}
                </span>
              </div>
              <div className="list-card">
                {g.items.map((t) => (
                  <TxRow key={t.id} tx={t} onOpen={() => setViewTx(t)} />
                ))}
              </div>
            </div>
          );
        })
      )}
      {drive.status === 'needsReconnect' ? (
        <div className="sync-note sync-note-error">
          <Icon paths={[...ICONS.alert]} size={16} />
          <span>Google Drive session expired — sign in again to keep syncing.</span>
          <Button variant="ghost" icon="drive" onClick={() => void drive.connect()}>
            Reconnect
          </Button>
        </div>
      ) : (
        drive.pendingCount > 0 && (
          <div className="sync-note">
            <Icon paths={[...ICONS.cloudOff]} size={16} />
            {drive.pendingCount} receipt(s) not yet in Google Drive
            {drive.status === 'ready' && (
              <Button variant="ghost" icon="refresh" onClick={() => void drive.syncNow()}>
                Sync now
              </Button>
            )}
          </div>
        )
      )}

      {addMenu && (
        <Modal title="Add expense" onClose={() => setAddMenu(null)}>
          <div className="menu-options">
            <button type="button" className="menu-option" onClick={() => { setAddMenu(null); startScan(); }}>
              <span className="menu-option-icon">
                <Icon paths={[...ICONS.camera]} size={24} />
              </span>
              <span className="menu-option-text">
                <strong>Scan receipt</strong>
                <small>Photo → AI extracts amount, date &amp; reason</small>
              </span>
            </button>
            <button type="button" className="menu-option" onClick={() => { setAddMenu(null); startBulkScan(); }}>
              <span className="menu-option-icon">
                <Icon paths={[...ICONS.layers]} size={24} />
              </span>
              <span className="menu-option-text">
                <strong>Bulk scan</strong>
                <small>Shoot many receipts — confirm them all at once</small>
              </span>
            </button>
            <button type="button" className="menu-option" onClick={() => { setAddMenu(null); setExpenseForm(true); }}>
              <span className="menu-option-icon">
                <Icon paths={[...ICONS.receipt]} size={24} />
              </span>
              <span className="menu-option-text">
                <strong>Enter manually</strong>
                <small>Type the amount, currency and description</small>
              </span>
            </button>
          </div>
        </Modal>
      )}
      {revenueForm && <TxFormModal mode="revenue" projectId={project.id} onClose={() => setRevenueForm(false)} />}
      {expenseForm && <TxFormModal mode="expense" projectId={project.id} onClose={() => setExpenseForm(false)} />}
      {editProject && company && (
        <ProjectFormModal companyId={company.id} project={project} onClose={() => setEditProject(false)} />
      )}
      {scan && company && (
        <ScanFlow
          company={company}
          project={project}
          onClose={() => setScan(false)}
          onManual={() => {
            setScan(false);
            setExpenseForm(true);
          }}
        />
      )}
      {bulkScan && company && (
        <BulkScanFlow
          company={company}
          project={project}
          onClose={() => setBulkScan(false)}
          onManual={() => {
            setBulkScan(false);
            setExpenseForm(true);
          }}
        />
      )}
      {viewTx && <TxViewModal tx={viewTx} onClose={() => setViewTx(null)} />}
    </Screen>
  );
}

function TxRow({ tx, onOpen }: { tx: Transaction; onOpen: () => void }) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);

  // Thumb source: full blob if present (better quality), else the small thumb.
  useEffect(() => {
    let url: string | null = null;
    if (tx.receipt?.blobData) {
      url = URL.createObjectURL(arrayBufferToBlob(tx.receipt.blobData, tx.receipt.blobType));
      setThumbSrc(url);
    } else {
      setThumbSrc(tx.receipt?.thumbDataUrl || null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [tx.receipt?.blobData, tx.receipt?.thumbDataUrl, tx.id]);

  return (
    <div className="row clickable" role="button" tabIndex={0} onClick={onOpen}>
      <div className="row-thumb">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="thumb" />
        ) : tx.type === 'expense' ? (
          <span className="type-badge type-expense">
            <Icon paths={[...ICONS.arrowDown]} size={16} />
          </span>
        ) : (
          <span className="type-badge type-revenue">
            <Icon paths={[...ICONS.arrowUp]} size={16} />
          </span>
        )}
      </div>
      <div className="row-main">
        <div className="row-title">
          {tx.description || tx.merchant || (tx.type === 'expense' ? 'Expense' : 'Revenue')}
        </div>
        <div className="row-sub">
          {tx.merchant && tx.description ? tx.merchant : ''}
          {tx.merchant && tx.description ? ' · ' : ''}
          {formatDateShort(tx.date)}
        </div>
      </div>
      <div className="row-amount">
        <div className={`tx-amount-sm ${tx.type === 'expense' ? 'tone-neg' : 'tone-pos'}`}>
          {tx.type === 'expense' ? '−' : '+'}
          {formatAmount(tx.amount, tx.currency)}
        </div>
        <SyncBadge tx={tx} />
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { formatAmount } from '../../lib/currency';
import { totalsByCurrency } from '../../lib/totals';
import { round2 } from '../../lib/totals';
import { ALL_KEY, useHomeTotalsByKey } from '../../hooks/useHomeTotalsByKey';
import { useAppData } from '../../state/AppDataContext';
import { useSettings } from '../../state/SettingsContext';
import { useConfirm } from '../../state/ConfirmContext';
import { useToast } from '../../state/ToastContext';
import { Screen, TotalsStrip } from '../../components/layout';
import { TotalsCard } from '../../components/TotalsCard';
import { Modal } from '../../components/Modal';
import { Button, EmptyState, ICONS, Icon, IconView, Input, Spinner, TextArea } from '../../components/ui';
import { CompanyFormModal } from './CompaniesScreen';

export function CompanyDetailScreen({
  companyId,
  onBack,
  onOpenProject,
}: {
  companyId: string;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const appData = useAppData();
  const { get } = useSettings();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const home = get<string>('homeCurrency') ?? 'HKD';

  const company = appData.companyById.get(companyId);
  const projects = useMemo(() => appData.projects.filter((p) => p.companyId === companyId), [appData.projects, companyId]);
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const txs = useMemo(() => appData.transactions.filter((t) => projectIds.has(t.projectId)), [appData.transactions, projectIds]);

  const [editForm, setEditForm] = useState(false);
  const [projectForm, setProjectForm] = useState<Project | null | undefined>(undefined);

  if (!company) {
    return (
      <Screen title="Company" onBack={onBack}>
        <EmptyState icon="building" title="Company not found" />
      </Screen>
    );
  }

  // Home-currency totals converted at each transaction's date rate (same logic
  // as the TotalsCard below) — never a raw sum across currencies.
  const { byKey: homeByKey, loading: homeLoading } = useHomeTotalsByKey(txs, ALL_KEY, home);
  const h = homeByKey.get('all');
  const net = h ? round2(h.revenue - h.expense) : null;

  const onDeleteCompany = async () => {
    const ok = await confirm({
      title: `Delete "${company.name}"?`,
      message: `This removes ${projects.length} project(s) and ${txs.length} transaction(s) from this device. Receipts already uploaded to Google Drive are kept there.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await appData.deleteCompany(company.id);
    toast('Company deleted', 'success');
    onBack();
  };

  return (
    <Screen
      title={
        <span className="screen-title-inline">
          <IconView icon={company.icon} size={28} /> {company.name}
        </span>
      }
      onBack={onBack}
      scrollKey={`company-${companyId}`}
      actions={
        <>
          <button type="button" className="btn-icon" aria-label="Edit company" onClick={() => setEditForm(true)}>
            <Icon paths={[...ICONS.pencil]} size={18} />
          </button>
          <button type="button" className="btn-icon btn-icon-danger" aria-label="Delete company" onClick={() => void onDeleteCompany()}>
            <Icon paths={[...ICONS.trash]} size={18} />
          </button>
        </>
      }
    >
      <TotalsStrip
        lines={[
          {
            label: 'Revenue',
            value: homeLoading ? '…' : h ? formatAmount(h.revenue, home, 0) : '—',
            sub: `≈ ${home}`,
            tone: 'pos',
          },
          {
            label: 'Expense',
            value: homeLoading ? '…' : h ? formatAmount(h.expense, home, 0) : '—',
            sub: `≈ ${home}`,
            tone: 'neg',
          },
          {
            label: 'Net',
            value: homeLoading ? '…' : net == null ? '—' : `${formatAmount(Math.abs(net), home, 0)}${net < 0 ? ' −' : ''}`,
            sub: `≈ ${home}`,
            tone: net == null ? 'neutral' : net >= 0 ? 'pos' : 'neg',
          },
        ]}
      />
      <TotalsCard txs={txs} home={home} />

      <div className="section-row">
        <h2 className="section-title">Projects</h2>
        <Button variant="primary" icon="plus" onClick={() => setProjectForm(null)}>
          Add project
        </Button>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet" text='Add a project like "Phuket Trip 2026 vlog" and start tracking its expenses.' />
      ) : (
        <div className="list-card">
          {projects.map((p) => {
            const pTxs = txs.filter((t) => t.projectId === p.id);
            const pCur = totalsByCurrency(pTxs);
            return (
              <div key={p.id} className="row clickable" role="button" tabIndex={0} onClick={() => onOpenProject(p.id)}>
                <div className="row-main">
                  <div className="row-title">{p.name}</div>
                  {p.description && <div className="row-sub">{p.description}</div>}
                  <div className="row-meta">
                    {pCur.size === 0
                      ? 'No transactions'
                      : [...pCur.entries()].map(([cur, v]) => (
                          <span key={cur} className="row-meta-item">
                            <span className="tone-pos">{formatAmount(v.revenue, cur, 0)}</span> /{' '}
                            <span className="tone-neg">{formatAmount(v.expense, cur, 0)}</span> {cur}
                          </span>
                        ))}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn-icon btn-icon-sm"
                    aria-label={`Edit ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectForm(p);
                    }}
                  >
                    <Icon paths={[...ICONS.pencil]} size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-icon-sm btn-icon-danger"
                    aria-label={`Delete ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void (async () => {
                        const ok = await confirm({
                          title: `Delete project "${p.name}"?`,
                          message: 'All its transactions are removed from this device. Receipts already in Google Drive are kept there.',
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (ok) {
                          await appData.deleteProject(p.id);
                          toast('Project deleted', 'success');
                        }
                      })();
                    }}
                  >
                    <Icon paths={[...ICONS.trash]} size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editForm && <CompanyFormModal company={company} onClose={() => setEditForm(false)} />}
      {projectForm !== undefined && (
        <ProjectFormModal companyId={company.id} project={projectForm ?? undefined} onClose={() => setProjectForm(undefined)} />
      )}
    </Screen>
  );
}

export function ProjectFormModal({
  companyId,
  project,
  onClose,
}: {
  companyId: string;
  project?: Project;
  onClose: () => void;
}) {
  const appData = useAppData();
  const { toast } = useToast();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast('Give the project a name', 'error');
      return;
    }
    setSaving(true);
    try {
      if (project) {
        await appData.updateProject({ ...project, name: name.trim(), description: description.trim() || undefined });
        toast('Project updated', 'success');
      } else {
        await appData.createProject({ companyId, name: name.trim(), description: description.trim() || undefined });
        toast('Project created', 'success');
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <div className="field">
        <label className="field-label">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Phuket Trip 2026 vlog" autoFocus />
      </div>
      <div className="field">
        <label className="field-label">Description (optional — helps the AI write better expense reasons)</label>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Travel vlog series filmed in Phuket: camera gear, meals, transport, accommodation"
          rows={3}
        />
      </div>
      <div className="btn-row">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner size={16} /> : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

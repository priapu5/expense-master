import { useMemo, useState } from 'react';
import type { Transaction } from '../../types';
import { formatAmount } from '../../lib/currency';
import { formatDate } from '../../lib/date';
import { useAppData } from '../../state/AppDataContext';
import { useSettings } from '../../state/SettingsContext';
import { useToast } from '../../state/ToastContext';
import { buildExportData, exportAndSave } from '../../services/export';
import { Screen } from '../../components/layout';
import { TotalsCard } from '../../components/TotalsCard';
import { Button, EmptyState, ICONS, Icon, Input, Select, Spinner } from '../../components/ui';
import { TxViewModal } from '../../components/TxModals';

const EXPORT_CAP = 1000;

export function QueryScreen() {
  const appData = useAppData();
  const { get } = useSettings();
  const { toast } = useToast();
  const home = get<string>('homeCurrency') ?? 'HKD';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [viewTx, setViewTx] = useState<Transaction | null>(null);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    return appData.transactions.filter((t) => {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (type && t.type !== type) return false;
      const project = appData.projectById.get(t.projectId);
      if (!project) return false;
      if (companyId && project.companyId !== companyId) return false;
      if (projectId && t.projectId !== projectId) return false;
      if (search.trim()) {
        const company = appData.companyById.get(project.companyId);
        const hay = `${t.description ?? ''} ${t.merchant ?? ''} ${project.name} ${company?.name ?? ''} ${t.currency}`.toLowerCase();
        if (!hay.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [appData.transactions, appData.projectById, appData.companyById, from, to, companyId, projectId, type, search]);

  const projectOptions = useMemo(
    () => (companyId ? appData.projects.filter((p) => p.companyId === companyId) : appData.projects),
    [appData.projects, companyId],
  );

  const filtersActive = Boolean(from || to || companyId || projectId || type || search.trim());

  const resetFilters = () => {
    setFrom('');
    setTo('');
    setCompanyId('');
    setProjectId('');
    setType('');
    setSearch('');
  };

  const onExport = async () => {
    if (filtered.length === 0) {
      toast('Nothing to export — the current filters match no transactions', 'error');
      return;
    }
    setExporting(true);
    try {
      const { rows, summary } = await buildExportData(
        filtered.slice(0, EXPORT_CAP),
        {
          companyOf: (t) => appData.companyById.get(appData.projectById.get(t.projectId)?.companyId ?? '')?.name ?? '—',
          projectOf: (t) => appData.projectById.get(t.projectId)?.name ?? '—',
        },
        home,
      );
      if (filtered.length > EXPORT_CAP) {
        toast(`Only the first ${EXPORT_CAP} rows were exported`, 'info');
      }
      await exportAndSave(rows, summary);
      toast('Spreadsheet exported', 'success');
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen
      title="Query"
      scrollKey="query"
      actions={
        <Button variant="primary" icon="download" onClick={() => void onExport()} disabled={exporting}>
          {exporting ? <Spinner size={16} /> : 'Export'}
        </Button>
      }
    >
      <div className="card filter-card">
        <div className="filter-row">
          <div className="filter-item">
            <label className="field-label">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="filter-item">
            <label className="field-label">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-item">
            <label className="field-label">Company</label>
            <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(''); }}>
              <option value="">All</option>
              {appData.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="filter-item">
            <label className="field-label">Project</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="filter-item">
            <label className="field-label">Type</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All</option>
              <option value="expense">Expense</option>
              <option value="revenue">Revenue</option>
            </Select>
          </div>
        </div>
        <input
          className="input search-input-plain"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, merchant, project…"
          aria-label="Search"
        />
        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </div>

      <TotalsCard txs={filtered} home={home} />

      <div className="section-row">
        <h2 className="section-title">
          Results <span className="muted">({filtered.length})</span>
        </h2>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="search" title="No matching transactions" text="Adjust the date range or filters." />
      ) : (
        <div className="list-card">
          {filtered.map((t) => {
            const project = appData.projectById.get(t.projectId);
            const company = project ? appData.companyById.get(project.companyId) : undefined;
            return (
              <div key={t.id} className="row clickable" role="button" tabIndex={0} onClick={() => setViewTx(t)}>
                <div className="row-thumb">
                  {t.receipt?.thumbDataUrl ? (
                    <img src={t.receipt.thumbDataUrl} alt="" className="thumb" />
                  ) : t.type === 'expense' ? (
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
                  <div className="row-title">{t.description || t.merchant || (t.type === 'expense' ? 'Expense' : 'Revenue')}</div>
                  <div className="row-sub">
                    {formatDate(t.date)}
                    {company && project ? ` · ${company.name} / ${project.name}` : ''}
                  </div>
                </div>
                <div className={`tx-amount-sm ${t.type === 'expense' ? 'tone-neg' : 'tone-pos'}`}>
                  {t.type === 'expense' ? '−' : '+'}
                  {formatAmount(t.amount, t.currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewTx && <TxViewModal tx={viewTx} onClose={() => setViewTx(null)} />}
    </Screen>
  );
}

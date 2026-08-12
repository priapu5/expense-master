import type { ReactNode } from 'react';
import { ICONS, Icon } from './ui';

export type Tab = 'companies' | 'query' | 'settings';

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { key: Tab; label: string; icon: keyof typeof ICONS }[] = [
    { key: 'companies', label: 'Companies', icon: 'building' },
    { key: 'query', label: 'Query', icon: 'search' },
    { key: 'settings', label: 'Settings', icon: 'sliders' },
  ];
  return (
    <nav className="tabbar">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`tabbar-item${tab === it.key ? ' tabbar-active' : ''}`}
          onClick={() => onChange(it.key)}
          aria-current={tab === it.key ? 'page' : undefined}
        >
          <Icon paths={[...ICONS[it.icon]]} size={22} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Screen({
  title,
  onBack,
  backLabel,
  actions,
  children,
  scrollKey,
}: {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Change this to reset scroll position when navigating between detail screens. */
  scrollKey?: string;
}) {
  return (
    <div className="screen">
      <header className="screen-header">
        {onBack && (
          <button type="button" className="btn-icon" onClick={onBack} aria-label={backLabel ?? 'Back'}>
            <Icon paths={[...ICONS.back]} size={20} />
          </button>
        )}
        <h1 className="screen-title">{title}</h1>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="scroll-pane" key={scrollKey}>
        {children}
      </div>
    </div>
  );
}

/** Card-style summary strip for revenue/expense/net totals. */
export function TotalsStrip({
  lines,
}: {
  lines: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' | 'neutral' }[];
}) {
  return (
    <div className="totals-strip">
      {lines.map((l) => (
        <div className="total-cell" key={l.label}>
          <span className="total-label">{l.label}</span>
          <span className={`total-value ${l.tone === 'pos' ? 'tone-pos' : l.tone === 'neg' ? 'tone-neg' : ''}`}>
            {l.value}
          </span>
          {l.sub && <span className="total-sub">{l.sub}</span>}
        </div>
      ))}
    </div>
  );
}

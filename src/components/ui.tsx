import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useToast, type ToastKind } from '../state/ToastContext';
import type { IconSpec, Transaction } from '../types';

// ---------- inline SVG icons (stroke style, no icon library) ----------

export function Icon({
  paths,
  size = 20,
  className,
}: {
  paths: string[];
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  pencil: ['M17 3a2.8 2.8 0 114 4L7.5 20.5 3 22l1.5-4.5L17 3z'],
  camera: [
    'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z',
    'M12 16a4 4 0 100-8 4 4 0 000 8z',
  ],
  photo: ['M3 5h18v14H3z', 'M3 15l5-5 4 4 3-3 6 6', 'M15 9h.01'],
  search: ['M21 21l-4.35-4.35', 'M11 19a8 8 0 100-16 8 8 0 000 16z'],
  sliders: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M9 4v4', 'M15 10v4', 'M7 16v4'],
  building: [
    'M3 21h18',
    'M5 21V7l7-4 7 4v14',
    'M9 9h.01',
    'M15 9h.01',
    'M9 13h.01',
    'M15 13h.01',
    'M9 17h.01',
    'M15 17h.01',
  ],
  cloudOff: ['M3 3l18 18', 'M18.5 14.5A4.5 4.5 0 0018 5.5a7 7 0 00-12.6-1.2', 'M5 9a4.5 4.5 0 00.4 8.98', 'M9 15h4.5'],
  cloudCheck: [
    'M20.4 14.6A5 5 0 0018 5.3a7 7 0 00-13 3A4.5 4.5 0 005 17h14a4.5 4.5 0 001.4-8.8z',
    'M9 15l2.5 2.5L16 13',
  ],
  alert: ['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  receipt: [
    'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
    'M14 2v6h6',
    'M9 13h6',
    'M9 17h6',
  ],
  arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
  arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
  download: ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  drive: [
    'M2 8l3 12h14L22 8z',
    'M2 8h20',
    'M6 12h.01',
    'M10 16h.01',
    'M9.5 8L12 4l2.5 4',
    'M14.5 8L12 12l2.5 4',
  ],
  check: ['M20 6L9 17l-5-5'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.5 9a9 9 0 0114.9-3.4L23 10', 'M1 14l4.6 4.4A9 9 0 0020.5 15'],
  lock: ['M4 11h16v10H4z', 'M8 11V7a4 4 0 018 0v4'],
  folder: ['M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z'],
  info: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 16v-5', 'M12 8h.01'],
} as const;

// ---------- buttons ----------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
  icon?: keyof typeof ICONS;
}

export function Button({ variant = 'primary', icon, children, className, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant}${className ? ' ' + className : ''}`} {...rest}>
      {icon && <Icon paths={[...ICONS[icon]]} size={18} />}
      {children}
    </button>
  );
}

// ---------- form controls ----------

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input${props.className ? ' ' + props.className : ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input textarea${props.className ? ' ' + props.className : ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input select${props.className ? ' ' + props.className : ''}`} />;
}

// ---------- small pieces ----------

export function Chip({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip${active ? ' chip-active' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="chip-label">{label}</span>
      {sub && <span className="chip-sub">{sub}</span>}
    </button>
  );
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function EmptyState({ icon, title, text }: { icon: keyof typeof ICONS; title: string; text?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon paths={[...ICONS[icon]]} size={30} />
      </div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
    </div>
  );
}

export function IconView({ icon, size = 44 }: { icon: IconSpec; size?: number }) {
  if (icon.kind === 'emoji') {
    return (
      <span className="icon-view icon-view-emoji" style={{ width: size, height: size, fontSize: size * 0.55 }}>
        {icon.value}
      </span>
    );
  }
  return (
    <span className="icon-view" style={{ width: size, height: size }}>
      <img src={icon.dataUrl} alt="" style={{ width: size, height: size }} />
    </span>
  );
}

export function SyncBadge({ tx }: { tx: Transaction }) {
  if (!tx.receipt) return null;
  const s = tx.receipt.syncState;
  if (s === 'synced') {
    return (
      <span className="sync-badge sync-ok" title="Saved to Google Drive">
        <Icon paths={[...ICONS.cloudCheck]} size={14} />
      </span>
    );
  }
  if (s === 'uploading') {
    return (
      <span className="sync-badge sync-busy" title="Uploading to Google Drive…">
        <Spinner size={12} />
      </span>
    );
  }
  if (s === 'error') {
    return (
      <span className="sync-badge sync-err" title={tx.receipt.syncError ?? 'Drive sync failed'}>
        <Icon paths={[...ICONS.alert]} size={14} />
      </span>
    );
  }
  return (
    <span className="sync-badge sync-local" title="On this device only — not yet in Google Drive">
      <Icon paths={[...ICONS.cloudOff]} size={14} />
    </span>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-bar">
      <Icon paths={[...ICONS.search]} size={16} />
      <input
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="btn-icon btn-icon-sm" onClick={() => onChange('')} aria-label="Clear search">
          <Icon paths={['M18 6L6 18', 'M6 6l12 12']} size={14} />
        </button>
      )}
    </div>
  );
}

export function ToastHost() {
  const { items, dismiss } = useToast();
  const kindClass: Record<ToastKind, string> = { success: 'toast-success', error: 'toast-error', info: 'toast-info' };
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <button key={t.id} type="button" className={`toast ${kindClass[t.kind]}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' && <Icon paths={[...ICONS.check]} size={16} />}
          {t.kind === 'error' && <Icon paths={[...ICONS.alert]} size={16} />}
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  );
}

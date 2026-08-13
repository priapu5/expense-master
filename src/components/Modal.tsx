import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

export function Modal({
  title,
  onClose,
  children,
  maxWidth = 480,
  full = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
  /** Full-screen mode (used by the scan flow). */
  full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const style: CSSProperties | undefined = full ? undefined : { maxWidth };

  // Portaled to <body>: callers render modals inside scrolled containers, and
  // fixed positioning there can be clipped/misplaced (notably on iOS Safari).
  return createPortal(
    <div
      className={`modal-backdrop${full ? ' modal-backdrop-full' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal-sheet${full ? ' modal-sheet-full' : ''}`} style={style} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon paths={['M18 6L6 18', 'M6 6l12 12']} size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

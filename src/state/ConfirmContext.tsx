import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmCtxValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<ConfirmCtxValue>({ confirm: async () => false });

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setCurrent(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setCurrent(null);
    resolver.current?.(result);
    resolver.current = null;
  }, []);

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {current && (
        <Modal onClose={() => close(false)} title={current.title} maxWidth={400}>
          {current.message != null && <div className="confirm-message">{current.message}</div>}
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              {current.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={`btn ${current.destructive ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => close(true)}
              autoFocus
            >
              {current.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmCtxValue {
  return useContext(ConfirmCtx);
}

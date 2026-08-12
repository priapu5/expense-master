import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastCtxValue {
  toast: (message: string, kind?: ToastKind) => void;
  items: ToastItem[];
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastCtxValue>({
  toast: () => undefined,
  items: [],
  dismiss: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter.current;
      setItems((prev) => [...prev.slice(-3), { id, message, kind }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return <ToastCtx.Provider value={{ toast, items, dismiss }}>{children}</ToastCtx.Provider>;
}

export function useToast(): ToastCtxValue {
  return useContext(ToastCtx);
}

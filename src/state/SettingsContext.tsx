import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSettingsAll, setSetting as dbSetSetting } from '../db/repos';

export const SETTING_DEFAULTS: Record<string, unknown> = {
  geminiModel: 'gemini-2.5-flash',
  homeCurrency: 'HKD',
  defaultCurrency: 'HKD',
  driveSignInMode: 'popup',
  driveBackupEnabled: true,
};

interface SettingsCtxValue {
  settings: Record<string, unknown>;
  loaded: boolean;
  /** Value merged with defaults. */
  get: <T>(key: string) => T | undefined;
  set: (key: string, value: unknown) => Promise<void>;
  /** Re-read settings from storage (e.g. a token landed in another tab). */
  reload: () => Promise<void>;
}

const SettingsCtx = createContext<SettingsCtxValue>({
  settings: {},
  loaded: false,
  get: () => undefined,
  set: async () => undefined,
  reload: async () => undefined,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettingsAll()
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const get = useCallback(
    <T,>(key: string): T | undefined => {
      const v = settings[key];
      if (v !== undefined) return v as T;
      return SETTING_DEFAULTS[key] as T | undefined;
    },
    [settings],
  );

  const set = useCallback(async (key: string, value: unknown) => {
    await dbSetSetting(key, value);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reload = useCallback(async () => {
    const s = await getSettingsAll().catch(() => ({}));
    setSettings(s);
    setLoaded(true);
  }, []);

  return <SettingsCtx.Provider value={{ settings, loaded, get, set, reload }}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsCtxValue {
  return useContext(SettingsCtx);
}

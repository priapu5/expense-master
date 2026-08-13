import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as drive from '../services/drive';
import { exportAll, restoreAll } from '../db/repos';
import { useAppData } from './AppDataContext';
import { useSettings } from './SettingsContext';
import { useToast } from './ToastContext';
import type { BackupJSON, DriveStatus, Transaction } from '../types';

interface DriveCtxValue {
  status: DriveStatus;
  statusMessage: string | null;
  account?: string;
  pendingCount: number;
  syncingCount: number;
  lastBackupAt?: string;
  lastSyncError: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  backupNow: () => Promise<void>;
  restoreBackup: (fileId: string, json?: BackupJSON) => Promise<void>;
}

const DriveCtx = createContext<DriveCtxValue | null>(null);

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function DriveProvider({ children }: { children: ReactNode }) {
  const { settings, loaded: settingsLoaded, set, reload } = useSettings();
  const appData = useAppData();
  const { toast } = useToast();

  const clientId = settings['driveClientId'] as string | undefined;
  const tokens = settings['driveTokens'] as { accessToken?: string; account?: string; expiresAt?: number } | undefined;
  const lastBackupAt = settings['lastBackupAt'] as string | undefined;

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncBusy = useRef(false);
  const backupBusy = useRef(false);
  const backupTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  const hasToken = Boolean(tokens?.accessToken);
  const status: DriveStatus = !clientId?.trim()
    ? 'unconfigured'
    : statusMessage === 'needsReconnect'
      ? 'needsReconnect'
      : statusMessage === 'error'
        ? 'error'
        : hasToken
          ? statusMessage === 'connecting'
            ? 'connecting'
            : 'ready'
          : 'signedOut';

  const pendingCount = useMemo(
    () => appData.transactions.filter((t) => t.receipt && t.receipt.syncState !== 'synced').length,
    [appData.transactions],
  );
  const syncingCount = useMemo(
    () => appData.transactions.filter((t) => t.receipt?.syncState === 'uploading').length,
    [appData.transactions],
  );

  // Startup: pick up a redirect-mode token from the URL, reset stale uploads.
  useEffect(() => {
    if (!settingsLoaded) return;
    drive
      .handleRedirectToken()
      .then((found) => {
        if (found) toast('Signed in to Google Drive', 'success');
      })
      .catch(() => undefined);
    // iOS home-screen flow: the Safari tab lands here with ?code= — exchange
    // it, save the token, and tell the user to return to the app.
    drive
      .handleOAuthCodeReturn()
      .then((found) => {
        if (found) toast('Signed in — you can now return to the app', 'success');
      })
      .catch(() => undefined);
    // Any record stuck in 'uploading' from a crashed session goes back to 'local'.
    for (const t of appData.transactions) {
      if (t.receipt?.syncState === 'uploading') {
        appData.setReceipt(t.id, { ...t.receipt, syncState: 'local' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // Prime the sign-in config (and preload Google's script) as soon as settings
  // load, so Connect has no awaits before it opens the popup — Safari only
  // allows popups within a direct user gesture.
  useEffect(() => {
    if (!settingsLoaded) return;
    drive.primeSignInConfig(clientId, settings['driveSignInMode'] as 'popup' | 'redirect' | undefined);
    if (clientId?.trim()) drive.preloadGis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, clientId, settings['driveSignInMode']]);

  // The iOS home-screen flow signs in inside a Safari tab; when the user
  // comes back to the app, re-read settings so the token saved there shows up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  const connect = useCallback(async () => {
    setStatusMessage('connecting');
    if (drive.isIosStandalone()) toast('Opening Google sign-in in Safari…', 'info');
    try {
      await drive.getAccessToken(true);
      await reload();
      setStatusMessage(null);
      toast('Connected to Google Drive', 'success');
      void syncNowInternal();
      void maybeAutoBackup(true);
    } catch (err) {
      // Note: redirect mode normally never reaches here — the page navigates
      // and handleRedirectToken() completes the flow on reload. The timeout in
      // requestToken covers the case where the navigation was blocked.
      if (err instanceof drive.DriveError && err.kind === 'auth') {
        setStatusMessage(null); // user cancelled — stay signed out
        return;
      }
      if (!(err instanceof drive.DriveError)) console.warn('[drive] connect failed:', err);
      setStatusMessage('error');
      setLastSyncError(errMessage(err));
      toast(errMessage(err), 'error');
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    await drive.disconnectDrive();
    setStatusMessage(null);
    toast('Disconnected from Google Drive. Local data is untouched.', 'info');
  }, [toast]);

  const syncNowInternal = useCallback(async () => {
    if (syncBusy.current) return;
    syncBusy.current = true;
    try {
      // Working over live DB state; updates flow through AppData actions.
      const pending = appData.transactions.filter(
        (t) => t.receipt && t.receipt.blobData && t.receipt.syncState !== 'synced',
      );
      for (const t of pending) {
        const company = appData.companyById.get(appData.projectById.get(t.projectId)?.companyId ?? '');
        if (!company) continue;
        const receipt = t.receipt!;
        const target: Transaction = { ...t, receipt: { ...receipt, syncState: 'uploading', syncError: undefined } };
        await appData.updateTransaction(target);
        try {
          const fileName = buildReceiptFileName(t, company.name);
          const res = await drive.uploadReceipt({
            fileName,
            mimeType: receipt.blobType,
            data: receipt.blobData!,
            companyId: company.id,
            companyName: company.name,
            transactionId: t.id,
          });
          await appData.updateTransaction({
            ...t,
            receipt: {
              ...receipt,
              syncState: 'synced',
              driveFileId: res.fileId,
              driveUrl: res.webViewLink,
              driveName: fileName,
              syncError: undefined,
            },
          });
          setLastSyncError(null);
        } catch (err) {
          const e = err instanceof drive.DriveError ? err : null;
          await appData.updateTransaction({
            ...t,
            receipt: { ...receipt, syncState: 'error', syncError: errMessage(err) },
          });
          setLastSyncError(errMessage(err));
          if (e && (e.kind === 'auth' || e.kind === 'popup' || e.kind === 'unconfigured')) {
            if (e.kind === 'auth') setStatusMessage('needsReconnect');
            break;
          }
          if (e?.kind === 'quota') break;
        }
      }
      if (pending.length > 0) {
        setStatusMessage(null);
        const remaining = appData.transactions.filter((t) => t.receipt && t.receipt.syncState !== 'synced').length;
        if (remaining === 0) toast('All receipts synced to Google Drive', 'success');
      }
    } finally {
      syncBusy.current = false;
    }
  }, [appData]);

  const syncNow = useCallback(async () => {
    setLastSyncError(null);
    await syncNowInternal();
  }, [syncNowInternal]);

  const backupNowInternal = useCallback(async () => {
    if (backupBusy.current) return;
    backupBusy.current = true;
    try {
      const json = await exportAll();
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const name = `backup-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
      await drive.uploadBackupFile(name, json);
      await drive.pruneOldBackups(10);
      await set('lastBackupAt', new Date().toISOString());
      dirtyRef.current = false;
      return true;
    } finally {
      backupBusy.current = false;
    }
  }, [set]);

  const backupNow = useCallback(async () => {
    try {
      await backupNowInternal();
      toast('Backup saved to Google Drive', 'success');
    } catch (err) {
      const e = err instanceof drive.DriveError ? err : null;
      if (e?.kind === 'popup') toast(errMessage(err), 'error');
      else toast(`Backup failed: ${errMessage(err)}`, 'error');
    }
  }, [backupNowInternal, toast]);

  /** Debounced auto-backup; only runs with a still-valid token (no popups in
   *  the background — popup blockers would kill it). */
  const maybeAutoBackup = useCallback(
    async (immediate = false) => {
      const enabled = settings['driveBackupEnabled'] !== false;
      if (!enabled) return;
      const validToken = await drive.getCachedTokenIfValid();
      if (!validToken) return; // skip silently; next manual backup/sync refreshes
      if (immediate) {
        await backupNowInternal().catch(() => undefined);
        return;
      }
      dirtyRef.current = true;
      if (backupTimer.current != null) window.clearTimeout(backupTimer.current);
      backupTimer.current = window.setTimeout(() => {
        backupTimer.current = null;
        if (dirtyRef.current) void backupNowInternal().catch(() => undefined);
      }, 60_000);
    },
    [settings, backupNowInternal],
  );

  // Auto-backup trigger: any data mutation.
  useEffect(() => {
    if (!settingsLoaded || !clientId?.trim()) return;
    void maybeAutoBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.companies, appData.projects, appData.transactions, settingsLoaded, clientId]);

  const restoreBackup = useCallback(
    async (fileId: string) => {
      const json = await drive.downloadBackup(fileId);
      // Safety snapshot of current state first.
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await drive.uploadBackupFile(`backup-pre-restore-${stamp}.json`, await exportAll());
      } catch {
        /* best effort */
      }
      await restoreAll(json);
      await appData.reload();
      toast('Restore complete', 'success');
    },
    [appData, toast],
  );

  const value = useMemo<DriveCtxValue>(
    () => ({
      status,
      statusMessage,
      account: tokens?.account,
      pendingCount,
      syncingCount,
      lastBackupAt,
      lastSyncError,
      connect,
      disconnect,
      syncNow,
      backupNow,
      restoreBackup,
    }),
    [
      status,
      statusMessage,
      tokens?.account,
      pendingCount,
      syncingCount,
      lastBackupAt,
      lastSyncError,
      connect,
      disconnect,
      syncNow,
      backupNow,
      restoreBackup,
    ],
  );

  return <DriveCtx.Provider value={value}>{children}</DriveCtx.Provider>;
}

function buildReceiptFileName(t: Transaction, companyName: string): string {
  const safe = (s: string) =>
    s
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40) || 'receipt';
  const label = safe(t.merchant || t.description || 'receipt');
  return `${t.date}_${safe(companyName)}_${label}_${t.id.slice(0, 8)}.jpg`;
}

export function useDrive(): DriveCtxValue {
  const ctx = useContext(DriveCtx);
  if (!ctx) throw new Error('useDrive must be used within DriveProvider');
  return ctx;
}

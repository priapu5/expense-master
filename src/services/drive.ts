/** Google Drive integration via Google Identity Services (GIS) — the user's
 *  chosen sign-in method. Token client with popup UX by default, redirect mode
 *  as a Settings fallback for standalone-PWA popup quirks.
 *
 *  Scope is drive.file only: the app can only see files it created itself
 *  (the "ExpenseTracker" folder, per-company subfolders, receipts, backups). */
import { getSetting, setSetting } from '../db/repos';
import type { BackupJSON, DriveTokens } from '../types';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_SKEW_MS = 60_000;

// ---------- GIS (minimal typings) ----------

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken: () => void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: Record<string, unknown>) => GisTokenClient;
      revoke: (token: string, cb: () => void) => void;
    };
  };
}
declare global {
  interface Window {
    google?: Gis;
    ExcelJS?: any;
  }
}

let gisLoadPromise: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (!gisLoadPromise) {
    gisLoadPromise = new Promise<Gis>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () =>
        window.google?.accounts?.oauth2
          ? resolve(window.google)
          : reject(new Error('Google sign-in library failed to load'));
      s.onerror = () => reject(new Error('Could not load Google sign-in — are you online?'));
      document.head.appendChild(s);
    });
  }
  return gisLoadPromise;
}

// ---------- errors ----------

export type DriveErrorKind = 'auth' | 'popup' | 'quota' | 'rate' | 'network' | 'http' | 'unconfigured';

export class DriveError extends Error {
  constructor(
    message: string,
    public kind: DriveErrorKind,
    public status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

function mapDriveError(status: number, data: unknown): DriveError {
  const msg = (data as { error?: { message?: string } })?.error?.message ?? '';
  if (status === 403 && /storageQuotaExceeded/i.test(msg)) {
    return new DriveError('Your Google Drive is full. Free up space, then sync again.', 'quota', 403);
  }
  if (status === 403 && /insufficientPermissions|scope/i.test(msg)) {
    return new DriveError('Google needs fresh permission. Disconnect and reconnect Drive in Settings.', 'auth', 403);
  }
  if (status === 403 && /rateLimit/i.test(msg)) {
    return new DriveError('Drive rate limit reached — sync will retry later.', 'rate', 403);
  }
  if (status === 401) {
    return new DriveError('Drive session expired — reconnect in Settings.', 'auth', 401);
  }
  if (status >= 500) {
    return new DriveError('Google Drive is temporarily unavailable. Try again later.', 'http', status);
  }
  return new DriveError(data ? msg || `Drive error (${status})` : `Drive error (${status})`, 'http', status);
}

// ---------- tokens ----------

export async function getDriveClientId(): Promise<string | undefined> {
  return getSetting<string>('driveClientId');
}

export async function getDriveTokens(): Promise<DriveTokens | undefined> {
  return getSetting<DriveTokens>('driveTokens');
}

export async function clearDriveTokens(): Promise<void> {
  await setSetting('driveTokens', undefined);
}

export async function getSignInMode(): Promise<'popup' | 'redirect'> {
  return ((await getSetting<'popup' | 'redirect'>('driveSignInMode')) || 'popup') === 'redirect'
    ? 'redirect'
    : 'popup';
}

function requestToken(
  clientId: string,
  mode: 'popup' | 'redirect',
  prompt: '' | 'consent',
  hint?: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  return new Promise(async (resolve, reject) => {
    let gis: Gis;
    try {
      gis = await loadGis();
    } catch (err) {
      reject(new DriveError((err as Error).message, 'network'));
      return;
    }
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt,
      ...(hint ? { hint } : {}),
      ...(mode === 'redirect'
        ? { ux_mode: 'redirect', redirect_uri: window.location.origin }
        : { ux_mode: 'popup' }),
      callback: (resp: GisTokenResponse) => {
        if (resp.error !== undefined) {
          if (resp.error === 'popup_closed_by_user' || resp.error === 'popup_blocked') {
            reject(
              new DriveError(
                'The Google sign-in popup was blocked or closed. Allow popups for this site, or switch to "Redirect sign-in" in Settings.',
                'popup',
              ),
            );
          } else if (resp.error === 'access_denied') {
            reject(new DriveError('Google sign-in was cancelled.', 'auth'));
          } else {
            reject(new DriveError(`Google sign-in failed (${resp.error}).`, 'auth'));
          }
          return;
        }
        resolve({
          accessToken: resp.access_token!,
          expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
        });
      },
    });
    client.requestAccessToken();
  });
}

async function fetchAccountEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { user?: { emailAddress?: string } };
    return j.user?.emailAddress;
  } catch {
    return undefined;
  }
}

let tokenInflight: Promise<string> | null = null;

/** Returns a valid access token, requesting one (silently when possible) if needed. */
export async function getAccessToken(forcePrompt = false): Promise<string> {
  if (!tokenInflight) {
    tokenInflight = (async () => {
      const tokens = await getDriveTokens();
      if (tokens && !forcePrompt && tokens.expiresAt - Date.now() > TOKEN_SKEW_MS) {
        return tokens.accessToken;
      }
      const clientId = await getDriveClientId();
      if (!clientId) {
        throw new DriveError('Drive is not configured yet: add your Google OAuth Client ID in Settings.', 'unconfigured');
      }
      const mode = await getSignInMode();
      const fresh = await requestToken(clientId, mode, forcePrompt ? 'consent' : '', tokens?.account);
      const account = await fetchAccountEmail(fresh.accessToken).catch(() => undefined);
      await setSetting('driveTokens', {
        accessToken: fresh.accessToken,
        expiresAt: fresh.expiresAt,
        account,
      } satisfies DriveTokens);
      return fresh.accessToken;
    })();
    tokenInflight.catch(() => undefined).then(() => {
      tokenInflight = null;
    });
  }
  return tokenInflight;
}

/** Cached token without prompting — for background auto-backup. Returns null
 *  when it would need a popup (avoid popup-blockers firing without a gesture). */
export async function getCachedTokenIfValid(): Promise<string | null> {
  const tokens = await getDriveTokens();
  if (tokens && tokens.expiresAt - Date.now() > TOKEN_SKEW_MS) return tokens.accessToken;
  return null;
}

/** After GIS ux_mode=redirect, the token lands in the URL fragment. */
export async function handleRedirectToken(): Promise<boolean> {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token=')) return false;
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return false;
  }
  const expiresIn = Number(params.get('expires_in') || 3600);
  const account = await fetchAccountEmail(accessToken).catch(() => undefined);
  await setSetting('driveTokens', {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    account,
  } satisfies DriveTokens);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

export async function disconnectDrive(): Promise<void> {
  const tokens = await getDriveTokens();
  await clearDriveTokens();
  if (tokens?.accessToken) {
    try {
      const gis = await loadGis();
      gis.accounts.oauth2.revoke(tokens.accessToken, () => undefined);
    } catch {
      /* best effort */
    }
  }
}

// ---------- API helpers ----------

async function driveFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && !retried) {
    await clearDriveTokens();
    return driveFetch(path, init, true); // one silent retry with a fresh token
  }
  return res;
}

async function driveFetchJson(path: string, init?: RequestInit): Promise<Record<string, any>> {
  const res = await driveFetch(path, init);
  const text = await res.text();
  let data: Record<string, any> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw mapDriveError(res.status, data);
  return data;
}

// ---------- folders ----------

async function ensureRootFolder(): Promise<string> {
  const existing = await getSetting<string>('driveFolderId');
  if (existing) return existing;
  const q = encodeURIComponent(
    "name='ExpenseTracker' and mimeType='application/vnd.google-apps.folder' and trashed=false",
  );
  const data = await driveFetchJson(`/files?q=${q}&fields=files(id,name)&pageSize=10`);
  const found = (data.files as { id: string; name: string }[] | undefined)?.find(
    (f) => f.name === 'ExpenseTracker',
  );
  if (found) {
    await setSetting('driveFolderId', found.id);
    return found.id;
  }
  const created = await driveFetchJson('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ExpenseTracker',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: 'expense-tracker' },
    }),
  });
  await setSetting('driveFolderId', created.id);
  return created.id as string;
}

async function ensureCompanyFolder(companyId: string, companyName: string): Promise<string> {
  const map = (await getSetting<Record<string, string>>('driveCompanyFolders')) ?? {};
  if (map[companyId]) return map[companyId];
  const rootId = await ensureRootFolder();
  const created = await driveFetchJson('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: companyName.slice(0, 100),
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
      appProperties: { app: 'expense-tracker', companyId },
    }),
  });
  map[companyId] = created.id as string;
  await setSetting('driveCompanyFolders', map);
  return map[companyId];
}

// ---------- uploads ----------

async function uploadMultipart(args: {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  parents: string[];
  appProperties?: Record<string, string>;
}): Promise<{ fileId: string; webViewLink: string }> {
  const token = await getAccessToken();
  const fd = new FormData();
  fd.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: args.fileName,
          parents: args.parents,
          mimeType: args.mimeType,
          ...(args.appProperties ? { appProperties: args.appProperties } : {}),
        }),
      ],
      { type: 'application/json' },
    ),
  );
  fd.append('file', new Blob([args.data], { type: args.mimeType }));
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd },
  );
  const j = (await res.json().catch(() => null)) as { id?: string; webViewLink?: string } | null;
  if (!res.ok || !j?.id) throw mapDriveError(res.status, j);
  return { fileId: j.id, webViewLink: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
}

export async function uploadReceipt(args: {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  companyId: string;
  companyName: string;
  transactionId: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const folderId = await ensureCompanyFolder(args.companyId, args.companyName);
  return uploadMultipart({
    fileName: args.fileName,
    mimeType: args.mimeType,
    data: args.data,
    parents: [folderId],
    appProperties: { app: 'expense-tracker', transactionId: args.transactionId },
  });
}

export async function uploadBackupFile(fileName: string, json: BackupJSON): Promise<void> {
  const rootId = await ensureRootFolder();
  const bytes = new TextEncoder().encode(JSON.stringify(json, null, 1));
  // Copy into an ArrayBuffer for FormData (Uint8Array is fine too, but keep it simple)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await uploadMultipart({
    fileName,
    mimeType: 'application/json',
    data: buf,
    parents: [rootId],
    appProperties: { app: 'expense-tracker', kind: 'backup' },
  });
}

export async function deleteDriveFileBestEffort(fileId: string): Promise<void> {
  try {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw mapDriveError(res.status, null);
  } catch {
    /* best effort — orphaned file is harmless */
  }
}

// ---------- backups ----------

export interface DriveBackupMeta {
  id: string;
  name: string;
  createdTime: string;
}

export async function listBackups(): Promise<DriveBackupMeta[]> {
  const rootId = await ensureRootFolder();
  const q = encodeURIComponent(`'${rootId}' in parents and name contains 'backup-' and trashed=false`);
  const data = await driveFetchJson(
    `/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=50`,
  );
  return (data.files as DriveBackupMeta[] | undefined) ?? [];
}

export async function downloadBackup(fileId: string): Promise<BackupJSON> {
  const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
  const text = await res.text();
  if (!res.ok) throw mapDriveError(res.status, null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DriveError('Backup file is corrupted.', 'http');
  }
  return parsed as BackupJSON;
}

export async function pruneOldBackups(keep = 10): Promise<void> {
  try {
    const backups = await listBackups();
    for (const b of backups.slice(keep)) {
      await deleteDriveFileBestEffort(b.id);
    }
  } catch {
    /* best effort */
  }
}

export async function getDriveAccount(): Promise<string | undefined> {
  const tokens = await getDriveTokens();
  return tokens?.account;
}

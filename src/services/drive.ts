/** Google Drive integration via Google Identity Services (GIS) — the user's
 *  chosen sign-in method. Token client with popup UX by default, redirect mode
 *  as a Settings fallback for standalone-PWA popup quirks.
 *
 *  iOS home-screen PWAs can do neither (no popups, unreliable navigation), so
 *  there they sign in through a manual OAuth code + PKCE flow in a Safari tab
 *  instead — the token lands in storage shared with the PWA.
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

// Cached copies of the sign-in settings so the Connect click path has no
// IndexedDB awaits before it opens the popup — Safari only allows popups
// within a direct user gesture.
let cachedClientId: string | undefined;
let cachedSignInMode: 'popup' | 'redirect' | undefined;

export function primeSignInConfig(clientId?: string, mode?: 'popup' | 'redirect'): void {
  if (clientId !== undefined) cachedClientId = clientId;
  if (mode !== undefined) cachedSignInMode = mode;
  void refillChallengePool();
}

/** Load Google's sign-in script ahead of the click (see primeSignInConfig). */
export function preloadGis(): void {
  void loadGis().catch(() => undefined);
}

// ---------- iOS standalone: sign in in a Safari tab ----------
// Home-screen PWAs on iOS can't open popups and often block in-place OAuth
// navigations. The reliable flow: open Google's consent page in a Safari tab
// (a target=_blank link opens Safari from standalone), sign in there, and
// read the resulting token from storage shared between Safari and the PWA.

const PENDING_KEY = 'drivePendingCode';

interface PendingCode {
  verifier: string;
  redirectUri: string;
  clientId: string;
  startedAt: number;
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isIosStandalone(): boolean {
  return isIos() && (navigator as { standalone?: boolean }).standalone === true;
}

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Pre-computed S256 pairs so the click handler stays synchronous — Safari
// only honors the target=_blank click within the original user gesture.
let challengePool: { verifier: string; challenge: string }[] = [];

async function refillChallengePool(): Promise<void> {
  while (challengePool.length < 2) {
    const verifier = randomBase64Url(64);
    challengePool.push({ verifier, challenge: await pkceChallenge(verifier) });
  }
}

/** Opens Google's consent page in a Safari tab and stores the PKCE verifier.
 *  localStorage is synchronous, so the whole click path stays in-gesture. */
function startManualSignInSync(clientId: string): void {
  const redirectUri = window.location.origin + window.location.pathname;
  const pair = challengePool.shift();
  void refillChallengePool();
  const verifier = pair?.verifier ?? randomBase64Url(64);
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ verifier, redirectUri, clientId, startedAt: Date.now() } satisfies PendingCode),
  );
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('prompt', 'consent');
  if (pair) {
    authUrl.searchParams.set('code_challenge', pair.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  } else {
    authUrl.searchParams.set('code_challenge', verifier);
    authUrl.searchParams.set('code_challenge_method', 'plain');
  }
  const a = document.createElement('a');
  a.href = authUrl.toString();
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Waits (in the PWA) until the Safari-tab sign-in lands a token in shared
 *  storage; the tab itself runs handleOAuthCodeReturn to do the exchange. */
async function requestTokenManual(clientId: string): Promise<{ accessToken: string; expiresAt: number }> {
  startManualSignInSync(clientId);
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 750));
    const tokens = await getDriveTokens();
    if (tokens && tokens.expiresAt - Date.now() > TOKEN_SKEW_MS) {
      return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
    }
    if (!localStorage.getItem(PENDING_KEY)) {
      throw new DriveError('Google sign-in was cancelled in Safari.', 'auth');
    }
    if (Date.now() - start > 10 * 60_000) {
      throw new DriveError('Sign-in in Safari did not complete. Tap Connect to try again.', 'popup');
    }
  }
}

/** Exchange the ?code= Google returns to the redirect URI (PKCE, no client
 *  secret). Runs in whichever context received the redirect — the Safari tab. */
export async function handleOAuthCodeReturn(): Promise<boolean> {
  const search = new URLSearchParams(window.location.search);
  const code = search.get('code');
  const error = search.get('error');
  const rawPending = localStorage.getItem(PENDING_KEY);
  const clearUrl = () => history.replaceState(null, '', window.location.pathname);
  if (!code) {
    if (!error) return false; // no OAuth response on this URL
    console.warn('[drive] manual sign-in returned error:', error);
    localStorage.removeItem(PENDING_KEY);
    clearUrl();
    return false;
  }
  if (!rawPending) {
    console.warn('[drive] manual sign-in code arrived without pending state');
    clearUrl();
    return false;
  }
  const pending = JSON.parse(rawPending) as PendingCode;
  try {
    const body = new URLSearchParams({
      code,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    } | null;
    if (!res.ok || !data?.access_token) {
      throw new DriveError(
        data?.error ? `Google sign-in failed (${data.error}).` : `Google sign-in failed (${res.status}).`,
        'auth',
      );
    }
    const account = await fetchAccountEmail(data.access_token).catch(() => undefined);
    await setSetting('driveTokens', {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      account,
    } satisfies DriveTokens);
    localStorage.removeItem(PENDING_KEY);
    clearUrl();
    return true;
  } catch (err) {
    localStorage.removeItem(PENDING_KEY);
    clearUrl();
    throw err;
  }
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
    // GIS can fail without ever invoking the callback (blocked popup in
    // Safari / standalone PWAs, blocked navigation). Convert a silent hang
    // into an actionable error instead of a stuck "Connecting…".
    const timer = window.setTimeout(() => {
      reject(
        new DriveError(
          mode === 'redirect'
            ? 'Sign-in did not start — the full-page redirect was blocked by the browser. Try the popup method instead.'
            : 'Google sign-in did not complete. Allow popups for this site, or switch to "Full-page redirect" in Settings.',
          'popup',
        ),
      );
    }, mode === 'redirect' ? 30_000 : 3 * 60_000);
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt,
      ...(hint ? { hint } : {}),
      ...(mode === 'redirect'
        ? { ux_mode: 'redirect', redirect_uri: window.location.origin + window.location.pathname }
        : { ux_mode: 'popup' }),
      callback: (resp: GisTokenResponse) => {
        window.clearTimeout(timer);
        if (resp.error !== undefined) {
          console.warn('[drive] sign-in error:', resp.error, resp.error_description ?? '');
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
    try {
      client.requestAccessToken();
    } catch (err) {
      window.clearTimeout(timer);
      reject(new DriveError(`Google sign-in could not start: ${err instanceof Error ? err.message : String(err)}`, 'popup'));
    }
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
      const clientId = cachedClientId ?? (await getDriveClientId());
      if (!clientId) {
        throw new DriveError('Drive is not configured yet: add your Google OAuth Client ID in Settings.', 'unconfigured');
      }
      let fresh: { accessToken: string; expiresAt: number };
      if (isIosStandalone()) {
        // Home-screen PWA: popups and in-place redirects don't work — sign in
        // in a Safari tab instead. Only for user-initiated sign-in; background
        // renewals surface as "needs reconnect" rather than opening tabs.
        if (!forcePrompt) {
          throw new DriveError('Drive session expired — tap Connect in Settings to sign in again.', 'auth');
        }
        fresh = await requestTokenManual(clientId);
      } else {
        const mode = cachedSignInMode ?? (await getSignInMode());
        fresh = await requestToken(clientId, mode, forcePrompt ? 'consent' : '', tokens?.account);
      }
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
  if (!hash) return false;
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) {
    if (params.get('error')) {
      console.warn('[drive] sign-in redirect returned error:', params.get('error'), params.get('error_description') ?? '');
    }
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

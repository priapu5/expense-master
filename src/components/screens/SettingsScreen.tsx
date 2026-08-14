import { useEffect, useState } from 'react';
import { useSettings } from '../../state/SettingsContext';
import { useDrive } from '../../state/DriveContext';
import { useToast } from '../../state/ToastContext';
import { useConfirm } from '../../state/ConfirmContext';
import { exportAll } from '../../db/repos';
import { clearFxCache, fxCacheSize } from '../../services/fx';
import {
  clearSignInDebugLog,
  getRedirectUri,
  getSignInDebugLog,
  isIosStandalone,
  listBackups,
  type DriveBackupMeta,
} from '../../services/drive';
import { getStorageInfo, requestPersist, bytesLabel } from '../../lib/storage';
import { shareOrDownload } from '../../lib/download';
import { CURRENCIES } from '../../lib/currency';
import { Screen } from '../../components/layout';
import { Modal } from '../../components/Modal';
import { Button, ICONS, Icon, Input, KeyValue, Select, Spinner } from '../../components/ui';

export function SettingsScreen() {
  const { get, set } = useSettings();
  const drive = useDrive();
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [geminiKey, setGeminiKey] = useState((get<string>('geminiKey') ?? ''));
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(get<string>('geminiModel') ?? 'gemini-2.5-flash');
  const [clientId, setClientId] = useState((get<string>('driveClientId') ?? ''));
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null; persisted: boolean | null }>({
    usage: null,
    quota: null,
    persisted: null,
  });
  const [fxCount, setFxCount] = useState(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [showSignInLog, setShowSignInLog] = useState(false);
  const [signInLog, setSignInLog] = useState<string[]>([]);

  useEffect(() => {
    getStorageInfo().then(setStorage).catch(() => undefined);
    fxCacheSize().then(setFxCount).catch(() => undefined);
  }, []);

  const saveGemini = async () => {
    await set('geminiKey', geminiKey.trim());
    await set('geminiModel', model.trim() || 'gemini-2.5-flash');
    toast('Gemini settings saved', 'success');
  };

  const saveClientId = async () => {
    await set('driveClientId', clientId.trim());
    toast('Google OAuth Client ID saved', 'success');
  };

  const copyRedirectUri = async () => {
    const uri = getRedirectUri();
    try {
      await navigator.clipboard.writeText(uri);
    } catch {
      // iOS Safari needs the execCommand fallback outside secure contexts.
      const ta = document.createElement('textarea');
      ta.value = uri;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Redirect URI copied', 'success');
  };

  const onRestore = async (b: DriveBackupMeta) => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `"${b.name}" (${new Date(b.createdTime).toLocaleString()}) will replace ALL current data on this device. A safety snapshot of your current data is saved to Drive first.`,
      confirmLabel: 'Restore',
      destructive: true,
    });
    if (!ok) return;
    try {
      await drive.restoreBackup(b.id);
      setRestoreOpen(false);
    } catch (err) {
      toast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const downloadBackup = async () => {
    try {
      const json = await exportAll();
      const blob = new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' });
      await shareOrDownload(blob, `expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Backup downloaded', 'success');
    } catch (err) {
      toast(`Backup failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const driveStatusLabel: Record<string, string> = {
    unconfigured: 'Not configured — add your Google OAuth Client ID below',
    signedOut: 'Configured, but not signed in',
    connecting: 'Connecting…',
    ready: drive.account ? `Connected as ${drive.account}` : 'Connected',
    needsReconnect: 'Needs reconnection — tap Connect',
    error: 'Sign-in problem — tap Connect to retry',
  };

  return (
    <Screen title="Settings" scrollKey="settings">
      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.camera]} size={18} /> Gemini (receipt scanning)
        </h2>
        <div className="field">
          <label className="field-label">API key</label>
          <div className="input-wrap">
            <Input
              type={showKey ? 'text' : 'password'}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="field-hint">
            Get a free key at aistudio.google.com (Gemini API, free tier). Stored only on this device and sent
            directly to Google — no other server ever sees it.
          </div>
        </div>
        <div className="field">
          <label className="field-label">Model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-2.5-flash" />
          <div className="field-hint">Default is gemini-2.5-flash (free tier).</div>
        </div>
        <Button variant="primary" icon="check" onClick={() => void saveGemini()}>
          Save Gemini settings
        </Button>
      </section>

      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.sliders]} size={18} /> Currency
        </h2>
        <div className="field">
          <label className="field-label">Home currency (for conversions &amp; totals)</label>
          <Select
            value={(get<string>('homeCurrency') ?? 'HKD')}
            onChange={(e) => void set('homeCurrency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
          <div className="field-hint">
            Amounts are converted at the ECB reference rate of each transaction's date (via frankfurter.app, free
            service). Unsupported currencies show "—".
          </div>
        </div>
        <div className="field">
          <label className="field-label">Default currency for new entries</label>
          <Select
            value={(get<string>('defaultCurrency') ?? 'HKD')}
            onChange={(e) => void set('defaultCurrency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => {
            void clearFxCache().then(() => fxCacheSize().then(setFxCount));
            toast('FX cache cleared', 'info');
          }}
        >
          Clear cached exchange rates ({fxCount} pairs)
        </Button>
      </section>

      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.drive]} size={18} /> Google Drive
        </h2>
        <div className="field">
          <label className="field-label">Google OAuth Client ID (web application)</label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-xxxx.apps.googleusercontent.com" autoComplete="off" />
          <div className="field-hint">
            Create one in Google Cloud Console (see README): enable the Drive API, create an OAuth consent
            screen with the drive.file scope, then a "Web application" client. Add this app's URL as an
            authorized JavaScript origin, and the full page URL as an authorized redirect URI if you use
            full-page redirect sign-in. No client secret is needed.
          </div>
          <Button variant="secondary" icon="check" onClick={() => void saveClientId()}>
            Save Client ID
          </Button>
        </div>
        {isIosStandalone() ? (
          <div className="field-hint">
            Home-screen app detected: this can't show Google's sign-in popup, so Connect opens sign-in in a
            Safari tab. Finish signing in there, then return to the app — it connects automatically.
          </div>
        ) : (
          <div className="field">
            <label className="field-label">Sign-in method</label>
            <Select
              value={(get<string>('driveSignInMode') ?? 'popup')}
              onChange={(e) => void set('driveSignInMode', e.target.value)}
            >
              <option value="popup">Popup (default)</option>
              <option value="redirect">Full-page redirect (if popup is blocked)</option>
            </Select>
          </div>
        )}
        <div className="field">
          <label className="field-label">Authorized redirect URI</label>
          <div className="field-hint">
            Google rejects sign-in with <b>Error 400: redirect_uri_mismatch</b> unless this exact URL
            (trailing slash included) is listed under the OAuth client's <b>Authorized redirect URIs</b> in
            Google Cloud Console → Credentials → your Web application client. Popup sign-in only needs the
            JavaScript origin; the full-page redirect and iOS home-screen flows always send this URL.
          </div>
          <div className="btn-row">
            <code className="redirect-uri">{getRedirectUri()}</code>
            <Button variant="secondary" icon="copy" onClick={() => void copyRedirectUri()}>
              Copy
            </Button>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Sign-in debug log</label>
          <div className="field-hint">
            Traces the Safari-tab sign-in across restarts — useful if Connect fails silently.
          </div>
          <div className="btn-row">
            <Button
              variant="secondary"
              icon="info"
              onClick={() => {
                setSignInLog(getSignInDebugLog());
                setShowSignInLog((v) => !v);
              }}
            >
              {showSignInLog ? 'Hide log' : 'Show log'}
            </Button>
            <Button
              variant="secondary"
              icon="trash"
              onClick={() => {
                clearSignInDebugLog();
                setSignInLog([]);
                toast('Sign-in log cleared', 'info');
              }}
            >
              Clear
            </Button>
          </div>
          {showSignInLog && (
            <pre className="redirect-uri" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {signInLog.length ? signInLog.join('\n') : 'No entries yet.'}
            </pre>
          )}
        </div>
        <KeyValue label="Status">
          <span className={drive.status === 'ready' ? 'tone-pos' : ''}>{driveStatusLabel[drive.status] ?? drive.status}</span>
        </KeyValue>
        <KeyValue label="Receipts to sync">{drive.pendingCount}</KeyValue>
        {drive.lastSyncError && (
          <KeyValue label="Last sync error">
            <span className="tone-neg">{drive.lastSyncError}</span>
          </KeyValue>
        )}
        {drive.lastBackupAt && (
          <KeyValue label="Last Drive backup">{new Date(drive.lastBackupAt).toLocaleString()}</KeyValue>
        )}
        <div className="btn-row">
          {drive.status === 'ready' ? (
            <>
              <Button variant="primary" icon="refresh" onClick={() => void drive.syncNow()}>
                Sync now
              </Button>
              <Button variant="secondary" icon="check" onClick={() => void drive.backupNow()}>
                Backup now
              </Button>
              <Button variant="danger" onClick={() => void drive.disconnect()}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon="drive"
              onClick={() => void drive.connect()}
              disabled={drive.status === 'connecting' || !clientId.trim()}
            >
              {drive.status === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
            </Button>
          )}
        </div>
        <div className="btn-row">
          <Button variant="secondary" icon="download" onClick={() => void downloadBackup()}>
            Download backup file
          </Button>
          <Button
            variant="secondary"
            icon="folder"
            onClick={() => void setRestoreOpen(true)}
            disabled={drive.status !== 'ready'}
          >
            Restore from Drive
          </Button>
        </div>
        <div className="field">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={(get<boolean>('driveBackupEnabled') ?? true)}
              onChange={(e) => void set('driveBackupEnabled', e.target.checked)}
            />
            Automatic backup to Drive (about a minute after changes)
          </label>
        </div>
      </section>

      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.lock]} size={18} /> Storage &amp; privacy
        </h2>
        <KeyValue label="Used on this device">{bytesLabel(storage.usage)}</KeyValue>
        <KeyValue label="Browser storage allowance">{bytesLabel(storage.quota)}</KeyValue>
        <KeyValue label="Protected from auto-eviction">{storage.persisted == null ? '—' : storage.persisted ? 'Yes' : 'Not yet'}</KeyValue>
        {storage.persisted === false && (
          <Button
            variant="secondary"
            icon="lock"
            onClick={() => {
              void requestPersist().then((ok) => {
                toast(ok ? 'Storage now protected' : 'Browser declined — installing the app to your home screen also protects data', 'info');
                void getStorageInfo().then(setStorage);
              });
            }}
          >
            Protect my data
          </Button>
        )}
        <div className="settings-note">
          <strong>Your data stays yours.</strong> Everything lives in this browser on your device. Receipt photos
          are sent only to Google's Gemini API (to read them) and, if you connect it, to your own Google Drive.
          The app has no server, no analytics, and no third-party scripts. Note: Google may use Gemini free-tier
          requests to improve their services — for extra privacy, a paid Gemini tier disables that.
        </div>
      </section>

      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.building]} size={18} /> Install the app
        </h2>
        <div className="settings-note">
          <strong>iPhone / iPad:</strong> open this page in Safari → tap the Share button → <em>Add to Home
          Screen</em>. This enables offline use, the camera, and protects your data from iOS's 7-day cleanup for
          regular websites.
        </div>
        <div className="settings-note">
          <strong>Android / desktop:</strong> use the browser's Install app option (Chrome menu → Install).
        </div>
        <div className="settings-note">
          Localhost caveat: install only works over HTTPS. For testing from your Mac use{' '}
          <code>npm run dev</code> at localhost — on the iPhone, deploy the app (e.g. GitHub Pages) first.
        </div>
      </section>

      <section className="card settings-section">
        <h2 className="settings-heading">
          <Icon paths={[...ICONS.info]} size={18} /> About
        </h2>
        <KeyValue label="Version">
          {__APP_VERSION__} <span className="muted">({__APP_COMMIT__})</span>
        </KeyValue>
        <KeyValue label="Build date">{__APP_BUILD_DATE__}</KeyValue>
      </section>

      {restoreOpen && (
        <RestoreModal
          onClose={() => setRestoreOpen(false)}
          onRestore={(b) => void onRestore(b)}
        />
      )}
    </Screen>
  );
}

function RestoreModal({
  onClose,
  onRestore,
}: {
  onClose: () => void;
  onRestore: (b: DriveBackupMeta) => void;
}) {
  const [backups, setBackups] = useState<DriveBackupMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBackups()
      .then(setBackups)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <Modal title="Restore from Google Drive" onClose={onClose}>
      {error && <div className="warning-banner">{error}</div>}
      {!backups && !error && (
        <div className="scan-working">
          <Spinner size={24} />
          <div className="scan-working-title">Listing backups…</div>
        </div>
      )}
      {backups && backups.length === 0 && (
        <div className="settings-note">No backups found in your ExpenseTracker folder yet. Tap "Backup now" first.</div>
      )}
      {backups && backups.length > 0 && (
        <div className="list-card">
          {backups.map((b) => (
            <div key={b.id} className="row">
              <div className="row-main">
                <div className="row-title">{b.name}</div>
                <div className="row-sub">{new Date(b.createdTime).toLocaleString()}</div>
              </div>
              <Button variant="secondary" onClick={() => onRestore(b)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

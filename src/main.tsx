import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './state/ToastContext';
import { SettingsProvider } from './state/SettingsContext';
import { ConfirmProvider } from './state/ConfirmContext';
import { AppDataProvider } from './state/AppDataContext';
import { DriveProvider } from './state/DriveContext';
import './styles/global.css';

// iOS 26 letterboxes standalone (home-screen) web apps above the status bar
// and home indicator but still reports env() safe-area insets, so the CSS
// env()-based paddings would double-inset (WebKit bug 313800). Flag it so the
// stylesheet can zero them. iOS 27 betas fix the insets themselves.
if (
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  /OS 26_/.test(navigator.userAgent) &&
  ((navigator as { standalone?: boolean }).standalone ||
    window.matchMedia('(display-mode: standalone)').matches)
) {
  document.documentElement.classList.add('ios26');
}

// Service worker: production builds only (keeps dev/HMR simple).
// Relative registration so the app works at any sub-path (GitHub Pages etc.).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — don't let the browser serve a cached sw.js for
    // up to 24h; the deploy stamping (see precache-manifest.mjs) relies on the
    // update check seeing the new bytes.
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // iOS standalone apps only check for SW updates when the page loads
        // and are notoriously slow to notice new deploys — nudge the check
        // whenever the app returns to the foreground so a fresh build is
        // picked up on relaunch instead of after several launches. Combined
        // with skipWaiting() in the SW, the new version takes over at once.
        const check = () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('focus', check);
      })
      .catch((err) => console.error('Service worker registration failed', err));
    // When a new service worker takes control (a fresh deploy was detected),
    // this page is still running the old build — reload so the update is what
    // the user sees, without needing several relaunches. The guard keeps it
    // from looping: after the reload the new SW is already in control.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

// Best-effort: ask the browser to protect our storage from eviction.
void import('./lib/storage').then((m) => m.requestPersist());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <SettingsProvider>
        <ConfirmProvider>
          <AppDataProvider>
            <DriveProvider>
              <App />
            </DriveProvider>
          </AppDataProvider>
        </ConfirmProvider>
      </SettingsProvider>
    </ToastProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './state/ToastContext';
import { SettingsProvider } from './state/SettingsContext';
import { ConfirmProvider } from './state/ConfirmContext';
import { AppDataProvider } from './state/AppDataContext';
import { DriveProvider } from './state/DriveContext';
import './styles/global.css';

// iOS 26+ letterboxes standalone (home-screen) web apps: the layout viewport
// is shorter than the physical screen by the status-bar delta, leaving an
// orphan strip at the bottom that the page cannot lay out into (WebKit bug
// 313800 — still open on iOS 26.x and early iOS 27 betas). env() safe-area
// insets are still reported inside the already-inset viewport, so honoring
// them double-insets. Detect the letterbox geometrically (visualViewport vs
// screen height) instead of sniffing the OS version: it covers iOS 26, iOS 27
// betas, and iPads, and re-toggles as the home indicator shows/hides (a swipe
// can collapse the strip, making the app full-screen until relaunch).
const LETTERBOX_GAP = 24; // px of viewport missing from the bottom that signals a letterbox

function isStandalone(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  );
}

function isLetterboxed(): boolean {
  const vv = window.visualViewport;
  if (vv) {
    return window.screen.height - vv.height - vv.offsetTop > LETTERBOX_GAP;
  }
  // No visualViewport (very old iOS): fall back to the known-buggy OS marker.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && /OS 2[67]_/.test(navigator.userAgent);
}

function updateLetterboxClass(): void {
  document.documentElement.classList.toggle('letterboxed', isStandalone() && isLetterboxed());
}

// Re-evaluate on resize: iOS 26 auto-hides the home indicator, collapsing the
// letterbox (the app then genuinely spans the full screen) and restoring it on
// relaunch.
if (isStandalone()) {
  updateLetterboxClass();
  window.visualViewport?.addEventListener('resize', updateLetterboxClass);
  window.addEventListener('resize', updateLetterboxClass);
  window.addEventListener('orientationchange', () => setTimeout(updateLetterboxClass, 300));
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

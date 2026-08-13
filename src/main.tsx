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
    navigator.serviceWorker
      .register('./sw.js')
      .catch((err) => console.error('Service worker registration failed', err));
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

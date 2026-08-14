import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Short git SHA of the commit being built, so every deploy is identifiable in
// Settings → About (the date alone repeats across commits made the same day).
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// Content-Security-Policy, injected as a meta tag.
// Dev needs 'unsafe-inline' scripts (React Refresh preamble) and the HMR websocket;
// production is locked down to the Google API endpoints the app actually calls.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "connect-src 'self' ws://localhost:* http://localhost:* https://generativelanguage.googleapis.com https://oauth2.googleapis.com https://www.googleapis.com https://api.frankfurter.dev",
].join('; ');

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "connect-src 'self' https://generativelanguage.googleapis.com https://oauth2.googleapis.com https://www.googleapis.com https://api.frankfurter.dev",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${ctx.server ? DEV_CSP : PROD_CSP}">`);
      },
    },
  };
}

export default defineConfig({
  // Relative base so the build works at any sub-path (GitHub Pages project site,
  // localhost, or a LAN IP) without extra configuration.
  base: './',
  plugins: [react(), injectCsp()],
  // Version stamp baked in at build/dev-server start and shown in Settings → About.
  // Version comes from package.json (npm sets it when run through npm scripts);
  // the date tells deployments apart even if the version wasn't bumped.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_COMMIT__: JSON.stringify(gitShortSha()),
  },
  build: { target: 'es2020' },
});

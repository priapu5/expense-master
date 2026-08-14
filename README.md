# Expense Tracker PWA

A private, iOS-first expense tracker for company tax records. Scan a receipt with your camera → Google Gemini reads the total, the date, and writes a context-aware expense reason (with alternatives for each) → everything is stored **on your device**, with receipts backed up to **your own Google Drive**, and exportable to a spreadsheet **with the receipt photos embedded** for tax reporting.

No server. No account system. No analytics. No third-party scripts (except Google's own sign-in library).

## Features

- **Companies → Projects → Transactions**: e.g. "Media Production Co." → "Phuket Trip 2026 vlog" → the camera-store receipt.
- **Receipt scanning (Gemini Flash, free tier)**:
  - Total amount **plus alternative amounts** as tappable chips (subtotal, with/without tip, second currency…)
  - Transaction date **plus alternative dates** found on the receipt (fallback: today)
  - **Expense reason** written from the receipt + your project's name/description — *"Camera equipment for shooting footage of the Phuket Trip 2026 travel vlog"* — with alternative phrasings
  - Every field editable before saving; manual entry always available
- **Manual revenue & expenses** with any currency.
- **Home-currency view (default HKD)**: every amount shows its equivalent in your home currency **at the ECB reference rate of the transaction date**, in lists, totals, and exports.
- **Google Drive sync**: receipts upload to `ExpenseTracker/<Company>/` in your Drive; automatic JSON backups (debounced), manual backup, restore.
- **Query panel**: date range, company, project, type, text search; totals by currency + home currency; view/edit/delete (with confirmation).
- **Spreadsheet export (XLSX)**: one row per transaction, receipt image embedded per row, Drive link, FX rate and home-currency columns, summary sheet. Shares to the iOS share sheet (Save to Files) or downloads.
- **PWA**: installable, works offline, camera capture, dark mode, safe-area aware.

## Quick start (on your Mac)

```bash
npm install
npm run dev        # http://localhost:5173
```

Everything works at localhost except installing on an iPhone (see below). Production build: `npm run build` → `dist/`.

## 1. Gemini API key (receipt scanning)

1. Go to [Google AI Studio](https://aistudio.google.com) → **Get API key** (free tier, no billing required).
2. In the app: **Settings → Gemini** → paste the key → Save.

The key is stored only on your device (IndexedDB) and is sent only to Google's Gemini API — no other server ever sees it. The default model is `gemini-2.5-flash` (free tier); the model name is configurable in Settings.

## 2. Google Drive (optional but recommended)

The app uses Google's official popup sign-in (Google Identity Services) with the **`drive.file`** scope — the app can only ever see files it created itself.

1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app name and your email → **Add scopes**: `https://www.googleapis.com/auth/drive.file` → **Add yourself as a test user** (no Google review needed).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Single-page application**, if your console offers it — a public client that needs no secret. If your console only has **Web application** (a confidential client), use it — Google requires its secret at the code exchange for that type, so sign-in otherwise fails with `invalid_request` (the app reads the secret from the credentials file you paste).
5. Under **Authorized JavaScript origins** add:
   - `http://localhost:5173` (for local development)
   - your deployed origin, e.g. `https://<your-username>.github.io`
   Under **Authorized redirect URIs** (needed for full-page redirect sign-in and the iOS home-screen flow) add:
   - `http://localhost:5173/`
   - your app's full page URL, e.g. `https://<your-username>.github.io/expense-tracker/` (exact match, including the trailing slash)

   If your Pages site is private, GitHub publishes it under a random subdomain like `musical-umbrella-xxxx.pages.github.io` — register *that* URL, not `<you>.github.io`.
6. Back on the client's **Credentials** page, click **Download JSON** → in the app: **Settings → Google Drive** → paste the whole file → **Save credentials** → **Connect**. The client ID and secret are stored only on your device and sent only to Google's token endpoint; keep the source/console private since a client-side secret is inherently extractable (an SPA-type client avoids this entirely).

## 3. Deploy (needed for iPhone use)

iOS requires **HTTPS** for service workers, the camera, and Google sign-in, so `localhost` on your Mac is fine for development but your iPhone needs a real URL. The easiest is **GitHub Pages** (free):

1. Create a repo (e.g. `expense-tracker`), push this folder:
   ```bash
   git init && git add -A && git commit -m "Expense tracker"
   git remote add origin https://github.com/<you>/expense-tracker.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Source: GitHub Actions** (a workflow is included in `.github/workflows/deploy-pages.yml`).
3. Your app is at `https://<you>.github.io/expense-tracker/`. Add that origin — and, for full-page redirect sign-in, the full page URL as an authorized redirect URI — to the OAuth client from step 2.

   **If the repo is private**, GitHub publishes the site on a random, stable subdomain (e.g. `musical-umbrella-xxxx.pages.github.io`, shown in **Settings → Pages**) and puts it behind **GitHub's own login**. That login wall breaks Google sign-in and the PWA on a fresh browser session (the OAuth redirect back to the app lands on a GitHub sign-in page, swallowing the code), so prefer one of:
   - **Publish the Pages site publicly** (Settings → Pages → visibility → Public) — clean `https://<you>.github.io/expense-tracker/` URL, no login wall, source repo stays private.
   - Or host `dist/` on **Netlify** or **Cloudflare Pages** — free, static, HTTPS, no auth wall.
   If you must stay private with the random subdomain, it *is* stable across deploys (it only changes if you flip the site's visibility), so registering it in Google works — but expect sign-in to fail whenever the GitHub session in Safari expires.
4. **iPhone**: open the URL in Safari → **Share → Add to Home Screen**. Now it behaves like a real app — and installed apps are exempt from iOS's 7-day website-data cleanup.

(Netlify also works: drag the `dist/` folder onto app.netlify.com/drop — no workflow needed. Or run `npm run preview` on your Mac and open `http://<your-mac-ip>:4173` from the phone for basic testing — but without HTTPS the install/SW/camera/GIS pieces won't fully work.)

## Using it

1. **Companies** → add a company (emoji or photo icon).
2. Open it → **Add project** (give it a helpful description — the AI uses it to write better expense reasons).
3. Open the project → **Add expense → Scan receipt** → take the photo → review the AI's suggestions (tap chips to pick alternatives) → **Save**.
4. The receipt uploads to your Drive automatically if you're connected (cloud badge on each row shows sync state; **Settings → Sync now** retries).
5. **Query** tab → set a date range → **Export** → open the XLSX in Numbers/Excel — photos embedded, one row per expense.

## Security & privacy

- **Your data never leaves your devices or your Google account.** The app has no backend. Receipt photos are sent only to Google's Gemini API (to read them) and to your own Google Drive (if connected).
- Storage is browser IndexedDB on your device, protected by your device passcode at rest. The Gemini key and Drive tokens are also device-only.
- Scopes are minimal (`drive.file`), the Content-Security-Policy restricts network calls to Google's API endpoints and the FX service, and there are no third-party scripts or trackers.
- **Gemini free-tier caveat**: Google may use free-tier API requests to improve their services. If you want receipts excluded from that, use a paid Gemini tier (billing on the same key changes the tier; the model can stay `gemini-2.5-flash`).
- Exchange rates come from [frankfurter.dev](https://frankfurter.dev/) (ECB daily reference rates) and are cached locally. They are indicative — **not tax advice**.
- Uninstall note: your Drive files (`ExpenseTracker/…`) are yours and remain after you remove the app. Delete them in Drive if you want them gone.

## Troubleshooting

- **"Access blocked … Error 400: redirect_uri_mismatch"** when signing in → the redirect URI the app sent isn't registered on your OAuth client. Register your app's exact page URL — e.g. `https://<you>.github.io/expense-tracker/` or your private Pages subdomain — in Google Cloud Console → your OAuth client → **Authorized redirect URIs** (exact match, including the trailing slash; Google requires the scheme, host, and trailing slash to match). This is always required for the full-page redirect and iOS home-screen flows; popup sign-in only needs the authorized JavaScript origin.
- **"Google sign-in failed (invalid_request)"** → your OAuth client is type **"Web application"**, which requires its **client secret** at the code exchange (PKCE doesn't substitute). Paste the whole client-secrets file in **Settings → Google Drive** → **Save credentials** → Connect again. Alternatively create a **"Single-page application"** client, which needs no secret.
- **Google consent completed, but the app still says "Configured, but not signed in"** → the token never made it back from the Safari tab. If the GitHub sign-in page intercepted the redirect (private Pages site), publish the site publicly or move to Netlify/Cloudflare Pages. The status shows **Connecting…** while the Safari tab flow is in progress.
- **"The Google sign-in popup was blocked"** → Settings → Google Drive → switch sign-in method to **Full-page redirect**.
- **Sign-in on the iPhone home-screen app** → Connect opens a Safari tab (home-screen apps can't show Google's popup). Finish signing in there, then return to the app — it connects automatically.
- **429 / "Free-tier rate limit"** while scanning → wait a minute; the free tier allows roughly 1,500 requests/day.
- **Receipt scanned wrong** → tap the alternative chips, or edit any field; you can also replace the photo later (Edit → Replace photo).
- **`—` instead of an HKD amount** → the currency isn't in the ECB reference set (e.g. TWD) or the device is offline with no cached rate. Original amounts are always kept.
- **Photos look HEIC on import** → the app re-encodes everything to JPEG; camera capture is preferred over library pick for old iOS versions.
- **Lost your app data?** → Settings → Google Drive → **Restore from Drive** (a safety snapshot of current data is saved before restoring).
- **Home screen icon shows a letter (e.g. "E")** → iOS only fetches `apple-touch-icon` over HTTPS; add to Home Screen from your deployed HTTPS URL, not the LAN preview (`http://<your-mac-ip>:4173`). iOS also caches the icon per URL — delete the old home screen icon and add it again after redeploying.
- **Strip below the tab bar in the installed app (iOS 26/27 beta)** → WebKit bug [313800](https://bugs.webkit.org/show_bug.cgi?id=313800): iOS letterboxes home-screen web apps above the home indicator and the page cannot draw there (still open on iOS 26.x; Apple fixed it in iOS 27 beta 4). The app paints that strip in the tab bar's color and skips the double-counted safe-area paddings (see `html.letterboxed` rules in `global.css`). It's cosmetic-only: the strip can collapse when the home indicator auto-hides (the app then spans the full screen) and returns on relaunch. On iOS 27 betas the letterbox is baked in when the icon is added — if you see a black strip there, delete the home-screen icon and add it again (bug [317153](https://bugs.webkit.org/show_bug.cgi?id=317153)).

## Development

```bash
npm run dev          # dev server (HMR)
npm run typecheck    # tsc --noEmit
npm run build        # production build + precache manifest
npm run preview      # serve the production build at :4173
npm run smoke        # headless-Chrome end-to-end test (needs `npm run preview` running)
npm run verify:export # generates a real xlsx export and inspects its structure
```

### Stack

React 19 + TypeScript + Vite · `idb` (IndexedDB) · Google Gemini REST API (structured JSON output) · Google Identity Services + Drive API v3 · ExcelJS 4.4.0 (vendored in `public/vendor/`, MIT — see `public/vendor/LICENSE.exceljs.txt`) · frankfurter.dev for ECB reference rates · hand-rolled service worker with build-generated precache manifest.

### Platform notes baked into the design

- Receipts are stored as `ArrayBuffer` in IndexedDB (iOS Safari cannot reliably store `Blob`s there).
- `accept="image/jpeg,image/png,image/gif"` on file inputs makes Safari transcode HEIC→JPEG on upload.
- `env(safe-area-inset-*)`, `100dvh` scroll-container locking, 16px inputs (no focus-zoom), and `overscroll-behavior` for standalone home-screen mode.
- Receipt images are never placed in Cache Storage (iOS caps it at ~50 MB); IndexedDB quota is ~60% of free disk.

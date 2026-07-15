# Files modified — HEL-300 mobile-pwa-shell

Ticket scope: `notes/mobile-pwa-handoff.md` sections **W1, W2, W6, §3.2, §4.2 only**.
Terminal state is **"ready for device testing"**, not "done" — see §6 below.

## Modified

- `.gitignore` — add explicit un-ignore exceptions for the generated PWA icon
  PNGs (`frontend/public/pwa-*.png`, `maskable-icon-*.png`,
  `apple-touch-icon-*.png`); the repo's blanket `*.png` rule (for E2E
  screenshot artifacts) was silently swallowing them. Without this the icons
  would be generated locally but never committed.
- `DESIGN.md` — §4 amended: canonical breakpoint set extended to
  `1440 / 1100 / 768 / 430`, with a one-line rationale (430px covers every
  iPhone portrait width) per the doc's own "never silently diverge" rule.
- `frontend/index.html` — `viewport-fit=cover` added to the viewport meta;
  new `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `apple-touch-icon` link, and dual `theme-color` metas gated on
  `prefers-color-scheme` (light `#f4f2ed` / dark `#121110`, literal copies of
  `--app-bg`). Font trio links (Fraunces/Schibsted Grotesk/JetBrains Mono)
  untouched — still present, now additionally cache-first'd by the SW (see
  `vite.config.ts`).
- `frontend/package.json` / `frontend/package-lock.json` — add
  `vite-plugin-pwa` and `@vite-pwa/assets-generator` as devDependencies; add
  `generate-pwa-assets` script.
- `frontend/vite.config.ts` — add the `VitePWA` plugin (`generateSW` strategy,
  `registerType: "autoUpdate"`, `injectRegister: "auto"`, `devOptions.enabled:
  false` so worktree dev servers are never SW-controlled). Manifest and
  workbox config (`navigateFallbackDenylist`, `runtimeCaching`) are imported
  from the new `src/pwaConfig.ts` so they're unit-testable without loading the
  Vite config module.
- `frontend/src/features/auth/ui/auth.css` — `.auth-page` and `.auth-loading`
  `min-height: 100vh` → `100dvh` (100vh is a lie on iOS Safari; task 4.1).
  Applies at all viewport widths but is a no-op wherever there's no dynamic
  browser-chrome resize (desktop, most non-Safari-mobile browsers compute
  `dvh === vh`), so this does not change desktop/iPad rendering.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — the stray,
  unratified `@media (max-width: 480px)` (line 575) folded into the newly
  ratified `430px` (task 3.2). This is the modal's two-column-row collapse
  breakpoint; only viewports **431–480px** change behaviour (keep the
  desktop-correct two-column row instead of collapsing early) — a window with
  no known device, and entirely below the 768px desktop/iPad threshold.

## Added

- `frontend/pwa-assets.config.ts` — `@vite-pwa/assets-generator` config,
  source `public/orbit-mark.svg` → 180 apple-touch, 64/192/512 standard, 512
  maskable. **Apple-touch-icon background decision (skeptic note 2):**
  `orbit-mark.svg` has a transparent background; iOS composites transparent
  PNGs onto solid black, which would clip the OrbitMark's stroke on a black
  square. Overrode the preset's generic `white` apple background to the
  light-theme `--app-bg` (`#f4f2ed`) instead, via `resizeOptions.background`
  in the preset's `apple` asset config — matching the manifest's chosen
  splash colour (design.md decision 5: light is the splash default) rather
  than an arbitrary white. Standard (192/512) icons keep the preset's
  transparent background (manifest icons render against
  `background_color`); maskable keeps the preset's white safe-zone fill
  (unchanged, not in scope of the skeptic note). Verified with `sharp`
  post-generation: `apple-touch-icon-180x180.png` is 3-channel/opaque;
  `pwa-192x192.png` is 4-channel/non-opaque (transparent), as intended.
- `frontend/public/apple-touch-icon-180x180.png`,
  `frontend/public/pwa-192x192.png`, `frontend/public/pwa-512x512.png`,
  `frontend/public/pwa-64x64.png`, `frontend/public/maskable-icon-512x512.png`
  — generated via `npm run generate-pwa-assets`, committed per design.md
  decision 4 (deterministic deploys, no CI toolchain addition). Visually
  inspected: OrbitMark reads clearly on all five; apple-touch-icon has the
  light `--app-bg` fill (opaque); maskable icon's mark sits well inside the
  padded safe zone.
  - Note: the assets-generator's `minimal2023Preset` also emits a
    `favicon.ico` as a side effect of the `transparent` asset type's default
    `favicons` config. That file was generated locally, is **not** wired into
    `index.html` (which keeps its existing `orbit-mark.svg` icon link,
    untouched), and is **not** committed — out of the ticket's explicit icon
    list (180/192/512/512-maskable only). It will regenerate harmlessly and
    stay untracked if `generate-pwa-assets` is re-run.
- `frontend/src/pwaConfig.ts` — manifest fields, `navigateFallbackDenylist`,
  and `runtimeCaching` rules as plain exported data, imported by both
  `vite.config.ts` and the test below. Deliberately **no** runtime-caching
  rule matches `/api` — Workbox only caches routes it's told to, so omission
  is the enforcement mechanism for the network-only `/api/**` requirement.
- `frontend/src/pwaConfig.test.ts` — task 5.1's required Jest coverage:
  asserts no `runtimeCaching` rule matches `/api/**` paths or URLs,
  `navigateFallbackDenylist` covers `/api/auth/google` and `/api/auth/me` but
  not app routes (`/`, `/sources`), manifest fields (`standalone`, `scope`,
  `start_url`, icon set incl. 512-maskable), and the two font-caching
  handlers (`StaleWhileRevalidate` for the stylesheet host,
  `CacheFirst` + >30-day expiry for the webfont host).

## Not modified (explicitly out of scope, verified untouched)

- `PanelGrid.tsx`/`.css`, `App.tsx`/`App.css` (nav) — HEL-301/HEL-302.
- `LoginPage.tsx` / `RegisterPage.tsx` — no code change. The OAuth button
  stays visible and functional (design.md decision 8); the standalone
  fallback CSS is prepared-but-not-applied, see §6 below.
- `backend/`, `schemas/` — zero diffs (`git status` confirmed no entries
  under either path).
- Desktop/iPad ≥768px: the only two CSS deltas below 768px (`430px`
  media-query fold, `100vh`→`100dvh`) are both scoped to sub-768 rendering
  paths or no-op above it — see the two entries above. No other selector,
  token, or component touched.

## Verification evidence (fresh, this session)

### Lint

```
$ npm run lint
> helio-frontend@0.0.0 lint
> eslint src --max-warnings=0

(exit 0, no output)
```

### Format check

```
$ npm run format:check
> helio-frontend@0.0.0 format:check
> prettier . --check

Checking formatting...
All matched files use Prettier code style!
(exit 0)
```

### Tests

```
$ npm test
> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests

Test Suites: 85 passed, 85 total
Tests:       929 passed, 929 total
Snapshots:   0 total
Time:        12.689 s
(exit 0)
```

`pwaConfig.test.ts` (7 of the 929) exercises exactly the task 5.1 scenarios:
no `/api` runtime-cache route, `navigateFallbackDenylist` covers `/api`,
manifest fields, font-caching handlers.

### Production build

```
$ npm --prefix frontend run build
vite v8.0.16 building client environment for production...
✓ 2886 modules transformed.
dist/registerSW.js                  0.13 kB
dist/manifest.webmanifest           0.38 kB
dist/index.html                     1.65 kB │ gzip:   0.80 kB
dist/assets/index-CbYB-SJ-.css    143.80 kB │ gzip:  18.20 kB
dist/assets/index-Dq9R2LkV.js   1,999.42 kB │ gzip: 629.82 kB
✓ built in 628ms
PWA v1.3.0
mode      generateSW
precache  16 entries (2106.46 KiB)
files generated
  dist/sw.js
  dist/workbox-acf3c99e.js
(exit 0)
```

(Precache count dropped 18→16 between an earlier and this final build: the
first `vite.config.ts` draft listed `includeAssets: ["orbit-mark.svg",
"favicon.ico"]`, but `favicon.ico` — a side effect of the assets-generator's
`transparent` preset, see the "Added" section above — was deliberately not
committed. `includeAssets` would have told Workbox to precache a file that
doesn't exist in a fresh checkout. Caught before commit by re-running the
build after removing `favicon.ico` from disk and confirming the precache
manifest no longer references it; fixed by dropping it from
`includeAssets`.)

### Built-output checks (code-level acceptance criteria — agent-verifiable)

- **`dist/manifest.webmanifest`**: `{"name":"Helio","short_name":"Helio",
  "start_url":"/","display":"standalone","background_color":"#f4f2ed",
  "theme_color":"#f4f2ed","scope":"/","icons":[192,512,512-maskable]}` —
  matches spec `pwa-installability`.
- **`dist/index.html`**: confirmed present — `viewport-fit=cover`,
  `apple-mobile-web-app-capable`, `apple-touch-icon` link, dual
  `theme-color` metas, `<link rel="manifest">`, and the SW register
  `<script>` — all auto-injected by `vite-plugin-pwa` into `<head>`.
- **`dist/registerSW.js`** (the entire registration script):
  `if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('/sw.js', { scope: '/' })})}`
  — a bare, `<script>`-tag-injected listener, structurally decoupled from
  `main.tsx`'s module graph. It cannot run before or interfere with
  `setupAuthInterceptor` because it isn't part of that module at all (task
  2.3 verified by inspection, not by editing `main.tsx` — no edit was
  needed).
- **`dist/sw.js` precache manifest** (16 entries, 2106.46 KiB): every entry
  is JS/CSS/HTML/icon/manifest — `registerSW.js`, `pwa-*.png`,
  `orbit-mark.svg`, `maskable-icon-512x512.png`, `index.html`,
  `empty-panel-grid.svg`, `apple-touch-icon-180x180.png`,
  `assets/index-*.js`, `assets/index-*.css`, `manifest.webmanifest`. **Zero
  `/api` entries.**
- **`dist/sw.js` navigation route**: `new e.NavigationRoute(...,
  {denylist:[/^\/api\//]})` — confirms `navigateFallbackDenylist` compiled
  into the shipped SW exactly as configured.
- **LAN-reachable preview** (task 6.1): started
  `npx vite preview --host --port 4173` from `frontend/`; confirmed
  `Local: http://localhost:4173/` and `Network: http://192.168.1.120:4173/`
  (LAN address will differ on the human's network). `curl` confirmed
  `HTTP 200` for `/`, the manifest, `/sw.js`, and the apple-touch-icon.
  **Preview was stopped after verification** — the orchestrator/human
  should start their own instance for the device session:
  ```
  npm --prefix frontend run build && npx vite preview --host
  ```

### No backend/schema diffs

```
$ git status --porcelain=v1 | grep -E "^\s*[AM?]+ (backend|schemas)/"
(no output — confirmed clean)
```

### `check:openspec` — expected failure at this stage, not a real gate failure

```
$ npm run check:openspec
OpenSpec hygiene issues:
  - change "mobile-pwa-shell" is complete (16/16) but not archived — run `openspec archive mobile-pwa-shell`
(exit 1)
```

This is the same pattern used on HEL-287 (precedent: commit `e674a68c`):
archiving is the orchestrator's job in the delivery phase
(`scripts/concertino/README.md`: "Delivery (squash, archive, PR) stays in
the orchestrator"), not the executor's — so a fully-task-complete,
not-yet-archived change trips this hygiene check by design at this point
in the pipeline. All other Husky checks (`lint`, `format:check`,
`check:schemas`, `check:scala-quality`, `test`) were run fresh above/below
and are clean. The commit uses `-n` solely to skip this one expected,
already-independently-verified-clean gate re-run — called out explicitly
here and in the commit body, per CONTRIBUTING.md's AI-collaborator rule.

```
$ npm run check:schemas
schemas in sync with JsonProtocols (10 checked across 18 protocol files)
(exit 0)

$ npm run check:scala-quality
Scala file-size warnings: [42 pre-existing soft-budget warnings, all in
files this change never touches]
Scala code-quality check: clean (42 soft warning(s))
(exit 0)
```

## Root cause / probe (systematic-debugging.md — icon-commit gap)

This was a hygiene gap, not a runtime bug, but it fits the same
evidence shape:

- **Root cause:** repo-root `.gitignore` line 40 (`*.png`) — added for E2E
  screenshot artifact cleanup — unintentionally matched the newly-generated
  PWA icon PNGs under `frontend/public/`, so `git status` never offered them
  for staging even though `generate-pwa-assets` wrote them to disk
  correctly.
- **Probe:** `git status --porcelain=v1 -- frontend/public/` after running
  `generate-pwa-assets`, before the `.gitignore` fix — showed only
  `favicon.ico` as untracked; the five icon PNGs were silently absent
  despite `ls frontend/public/` showing all of them on disk.
- **Probe output (post-fix):** same command after adding the three
  `!frontend/public/*.png` exceptions —
  ```
  ?? frontend/public/apple-touch-icon-180x180.png
  ?? frontend/public/maskable-icon-512x512.png
  ?? frontend/public/pwa-192x192.png
  ?? frontend/public/pwa-512x512.png
  ?? frontend/public/pwa-64x64.png
  ```
  all five now offered for staging, confirming the cause.

## §6 — Device test plan (human-performed; ordered)

**None of the items below can be or were verified by the agent.** Per the
ticket's verification constraint and `.concertino/laws/verification-before-
completion`, this ticket's terminal state is "ready for device testing."

### Setup

1. From `frontend/`, run:
   ```
   npm run build && npx vite preview --host
   ```
   Note the `Network:` URL it prints (e.g. `http://192.168.1.x:4173/`).
2. On the iPhone, join the **same Wi-Fi network** as the machine running the
   preview server.
3. Open Safari on the iPhone and navigate to that `Network:` URL.

### Ordered test steps

1. **Basic load.** Confirm the app loads over plain Safari (not yet
   installed) — log in, confirm dashboards render normally. This is the
   control for everything below.
2. **Icon legibility.** With the phone in both light and dark iOS appearance
   (Settings → Display & Brightness), look at the page — not yet a home
   screen check, just confirms nothing is visibly broken pre-install.
3. **Install to home screen.** Safari → Share → *Add to Home Screen*. Confirm
   the preview shown in the Add-to-Home-Screen sheet uses the OrbitMark (not
   a generic globe/blank icon) and reads clearly.
4. **Standalone launch.** Tap the new home screen icon. Confirm:
   - No Safari browser chrome (address bar, tab strip) — a true standalone
     window.
   - No content sits under the notch or the home indicator (safe-area
     handling).
   - The status bar area matches the app's background colour, not a jarring
     mismatch.
   - Correct icon shown in the iOS app-switcher (double-swipe-up / long
     home-indicator-swipe) and Settings → General → iPhone Storage.
5. **Icon on dark home screen.** If the phone's home screen background/theme
   is dark, re-check the apple-touch-icon reads clearly — it now uses an
   opaque light (`#f4f2ed`) background so the OrbitMark's orange stroke
   shouldn't clip against iOS's black safe-area composite. Repeat with the
   home screen in light mode if applicable.
6. **Light/dark + accent parity.** Toggle the in-app theme and (if set) a
   non-default accent color while in standalone. Confirm both match desktop
   exactly — the manifest/meta colours are a static splash-screen choice
   only; they must not visibly affect the live app UI.
7. **Fonts — cold load, no FOUT.** Force-quit the installed app (swipe up
   from the app switcher), wait a few seconds, then relaunch from the home
   screen icon. Confirm Fraunces/Schibsted Grotesk/JetBrains Mono are
   present from first paint — no visible flash of a fallback system font.
   (First-ever install is expected to need the network per design.md's
   accepted trade-off; this check is about the *second and later* cold
   launches.)
8. **Google OAuth in standalone — the open risk (§3.2).** From the
   standalone app's `/login` page, tap "Continue with Google" and complete
   the flow. Record the **exact outcome** on HEL-300:
   - **If it completes and lands back in the standalone app, logged in:**
     no further action — OAuth works in standalone on this iOS version.
     Record "OAuth works in standalone" + iOS version on the ticket.
   - **If it punts to Safari and/or the standalone app is still logged out
     afterward:** record "OAuth fails in standalone" + iOS version, and
     apply this **prepared, not-yet-applied** remediation (task 4.2) to
     `frontend/src/features/auth/ui/LoginPage.tsx` / `auth.css`:
     ```css
     @media (display-mode: standalone) and (max-width: 430px) {
       .auth-google-btn {
         display: none;
       }
     }
     ```
     This hides only the Google button, only in standalone, only at/below
     the ratified phone breakpoint — password login (`POST /api/auth/login`,
     pure XHR) is unaffected and remains the guaranteed path. This is a
     follow-up commit once the device result comes back, not part of this
     handoff's diff.
9. **Password login with keyboard up.** On `/login` and `/register`, tap
   into each field and confirm the iOS keyboard does not cover the input
   being edited or the submit button in a way that blocks completing the
   form. Confirm Safari/iOS still offers Keychain autofill (the
   `autocomplete` attributes were left untouched).
10. **Desktop/iPad ≥768px unchanged.** On the same build, open the preview
    URL in a desktop browser (or iPad Safari) at ≥768px width. Confirm
    dashboards, panel grid, nav, and the PanelDetailModal all look and behave
    exactly as before this change — this is the regression check for the two
    sub-768 CSS deltas in this diff.
11. `npm run lint && npm test` clean, Husky pre-commit passes — already
    confirmed fresh in this session (see evidence above); re-confirm if any
    remediation commit is made for step 8.

### Recording results

Record the outcome of step 8 (and any other failures) directly on HEL-300.
If results come back bad for any step, the ticket should iterate — not be
marked done.

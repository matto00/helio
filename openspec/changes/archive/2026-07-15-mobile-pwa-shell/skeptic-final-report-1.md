## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Scope / ground truth**
- `git diff main...HEAD --stat`: 27 files. No `backend/` or `schemas/` paths (confirmed also via
  `git diff main...HEAD -- backend schemas | wc -l` → `0`). Matches ticket's out-of-scope list.
- `frontend/src/features/auth/ui/LoginPage.tsx` / `RegisterPage.tsx`: zero diff (`git diff` empty) —
  the OAuth fallback CSS is genuinely prepared-but-unapplied, not smuggled into the diff.
- `frontend/src/main.tsx`: not in the diff stat — 401 interceptor untouched, consistent with the
  "registerSW.js is an auto-injected `<script>` tag, structurally decoupled from main.tsx" claim.
- `PanelGrid.tsx/.css`, `App.tsx/.css`: untouched — no bleed into HEL-301/HEL-302 territory.

**W1 — PWA shell**
- `frontend/index.html` diff: `viewport-fit=cover` added; `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` link, dual `theme-color`
  (`prefers-color-scheme: light/dark` → `#f4f2ed`/`#121110`) all present, matching `theme.css`'s
  `--app-bg` values.
- `dist/manifest.webmanifest` (fresh build, this session): `name`/`short_name` "Helio",
  `display: "standalone"`, `start_url`/`scope: "/"`, icons `[192, 512, 512-maskable]` — matches
  `pwa-installability` spec exactly.
- Icon opacity/background claims independently verified with Pillow (not just trusted from
  files-modified.md): `apple-touch-icon-180x180.png` corner pixel `(244,242,237,255)` — opaque,
  `#f4f2ed`-matching light `--app-bg`. `pwa-192x192.png` corner `(76,105,113,0)` — alpha 0,
  transparent as claimed. `maskable-icon-512x512.png` corner `(255,255,255,255)` — opaque white
  safe-zone fill. All three have the OrbitMark orange `(249,115,22,255)` at center. This directly
  confirms the design-gate skeptic's note #2 (apple-touch-icon background) was actually addressed,
  not just asserted.

**W2 — Service worker never caches `/api/**`**
- Read `frontend/src/pwaConfig.ts` and `vite.config.ts` directly: `pwaRuntimeCaching` has exactly two
  rules (Google Fonts stylesheet SWR, Google Fonts webfont CacheFirst) — neither matches `/api`.
  `navigateFallbackDenylist = [/^\/api\//]`.
- Ran a fresh build (`rm -rf dist && npm run build`) and inspected the compiled `dist/sw.js` directly
  (not the executor's pasted claims): `node -e` regex-count found exactly 3 `registerRoute(` calls —
  `NavigationRoute(...,{denylist:[/^\/api\//]})`, the Google Fonts stylesheet route, and the Google
  Fonts webfont route. **Zero routes reference `/api`.** This is ground truth from the shipped
  artifact, not a re-statement of the config source.
- `registerType: "autoUpdate"` confirmed in `vite.config.ts`; `devOptions.enabled: false` confirmed
  (SW not active on dev server).
- `frontend/src/pwaConfig.test.ts` read in full — its 7 assertions genuinely exercise the `/api`
  non-match, denylist coverage, manifest fields, and font-cache handlers; not a vacuous test.

**§4.2 — Breakpoint ratification**
- `DESIGN.md` diff: §4 canonical set extended `1440/1100/768` → `1440/1100/768/430` with a one-line
  rationale ("430px covers every iPhone portrait width... `PanelDetailModal.css`'s pre-existing,
  unratified `480px` query was folded into this value").
- `PanelDetailModal.css:575` diff: `480px` → `430px`, confirmed.
- `grep -rn "max-width" frontend/src --include=*.css`: every media-query value present is `768px` or
  `430px` (plus unrelated `max-width` on non-breakpoint properties like `400px`/`600px`/`840px` which
  are element sizing, not media queries). No undocumented breakpoint values remain.

**§3.2/W6 — OAuth / auth on phone**
- `auth.css` diff: `.auth-page`/`.auth-loading` `100vh`→`100dvh`, scoped correctly (no-op on desktop,
  per the dvh/vh equivalence claim — accepted as standard browser behavior).
- `LoginPage.tsx`/`RegisterPage.tsx`: zero diff; `autocomplete` attributes untouched.
- The prepared OAuth-fallback CSS rule in the device test plan (`files-modified.md` §6 step 8) is
  syntactically valid (`@media (display-mode: standalone) and (max-width: 430px) { .auth-google-btn
  { display: none; } }`) and targets the real class name (`grep` confirms `.auth-google-btn` exists in
  both `LoginPage.tsx` and `auth.css`).

**Gates re-run fresh, independently**
- `npm run lint` → clean (0 output, exit 0).
- `npm test` → 85/85 suites, 929/929 tests pass.
- `npm run format:check` → clean.
- `rm -rf dist && npm run build` → succeeds, 16 precache entries, `dist/sw.js`/`dist/manifest.webmanifest` generated.
- `scripts/concertino/assert-phase.sh servers` → `PASS servers` (dev servers healthy at 5473/8380).

**Desktop parity (agent-verifiable per the ticket's own carve-out)**
- Navigated to `http://localhost:5473/` and `/login` at 1440×900 via Playwright. Screenshots show the
  normal dark-theme dashboard shell (sidebar, dashboard list, panel grid) — no visual regression, no
  console errors (one pre-existing unrelated Redux memoization warning, one benign Chromium
  deprecation notice about `apple-mobile-web-app-capable` — expected, since the tag is iOS-Safari
  specific and this is Chromium; not a defect for this ticket's target platform).

**check:openspec bypass**
- Independently ran `npm run check:openspec` in the worktree: fails with "change 'mobile-pwa-shell' is
  complete (16/16) but not archived" — reproduces the executor's claimed reason for `-n`. This matches
  the HEL-287 precedent (archiving is the orchestrator's job at delivery) and is the *only* bypassed
  gate; lint/format/test/schemas/scala-quality were all independently confirmed clean above.

**Device test plan quality**
- Read `files-modified.md` §6 in full: setup (3 steps) + 11 ordered device-test steps, covering install,
  standalone launch, icon-on-dark-home-screen, light/dark+accent parity, font cold-load FOUT check,
  OAuth-in-standalone with the exact prepared CSS remediation inline, keyboard-up login, desktop/iPad
  parity, and a final lint/test re-confirmation. Actionable by a human with an iPhone on the same LAN
  (explicit `Network:` URL instruction, explicit Wi-Fi join step). Includes the required prepared-but-
  unapplied OAuth fallback rule verbatim.

### Verdict: CONFIRM

### Non-blocking notes
1. `apple-mobile-web-app-capable` triggers a Chromium deprecation console warning (Chrome now also
   wants a non-prefixed `mobile-web-app-capable` meta). Irrelevant to this ticket's iOS target (Safari
   still requires the apple-prefixed tag) but cheap to add alongside it in a future pass if Android/
   Chrome install-ability is ever pursued.
2. `frontend/pwa-assets.config.ts`'s favicon.ico side-effect handling (documented but not committed) is
   fine as shipped — flagging only so a future `generate-pwa-assets` re-run doesn't surprise someone
   with an untracked file they don't expect.

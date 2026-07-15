## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All code-level acceptance criteria addressed: manifest fields, iOS meta tags, icons (180/192/512/512-maskable),
  SW precache app-shell-only, `/api/**` network-only twice over (no runtime-caching rule + `navigateFallbackDenylist`),
  `registerType: autoUpdate`, font cache-first rules, `DESIGN.md` §4 amended with 430px + the stray 480px folded,
  `100vh`→`100dvh` on auth pages, no backend/schema diffs, lint/test/build clean.
- Device-dependent ACs (install, standalone launch, icon rendering, FOUT, OAuth-in-standalone, keyboard-up,
  notch) are correctly **not** claimed as verified — terminal state is "ready for device testing" per the
  ticket's explicit constraint, matched exactly by `files-modified.md` §6's ordered device test plan.
- No AC silently reinterpreted. The OAuth fallback (§3.2/W6) is shipped as a prepared-but-unapplied CSS rule
  documented in the device test plan, not pre-emptively applied — matches `design.md` Decision 8 and
  `tasks.md` 4.2 exactly ("do NOT apply it pre-emptively").
- Task list (`tasks.md`, 16/16) matches what was implemented; no drift between planning artifacts and diff.
- No scope creep: `PanelGrid`/`App.tsx` (HEL-301/HEL-302 territory) untouched; `LoginPage.tsx`/`RegisterPage.tsx`
  have zero diff (confirmed via `git diff main...HEAD -- frontend/src/features/auth`).
- No regressions to existing behavior: `main.tsx` has zero diff (401 interceptor untouched — confirmed by direct
  read); dev server has no active SW registration (confirmed via `navigator.serviceWorker.getRegistrations()`
  returning `[]` on the dev server, matching `devOptions.enabled: false`).
- No API contract / schema changes — confirmed via fresh `git diff main...HEAD -- backend schemas` (0 lines) and
  `npm run check:schemas` (clean).
- Planning artifacts (`proposal.md`, `design.md`, spec deltas in `specs/**`) match the final implementation;
  spot-checked `pwa-installability`, `frontend-auth-ui`, `helio-design-tokens` spec deltas against the diff —
  all requirements/scenarios match the shipped code (or explicitly describe the contingent, not-yet-applied
  OAuth-fallback scenario, correctly framed as contingent).

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md compliance**: no inline FQNs (Scala rule, N/A — no backend changes); new files
  (`pwaConfig.ts` 74 lines, `pwaConfig.test.ts` 65 lines, `pwa-assets.config.ts` 27 lines) are well under the
  ~250-line soft budget. No `any` usage anywhere in the diff (grepped `frontend/src/pwaConfig.ts`,
  `vite.config.ts`, `pwa-assets.config.ts`, `pwaConfig.test.ts` — zero hits besides an English-language code
  comment).
- **DESIGN.md [mechanical] compliance**: breakpoint values across `frontend/src/**/*.css` are exactly
  `{430px, 768px}` (grepped all `@media (max/min-width: ...)` values) — no undocumented values remain, matching
  the ratified set `1440/1100/768/430`. The literal hex colours in `index.html` (`<meta theme-color>`) and
  `pwaConfig.ts` (`APP_BG_LIGHT`/`APP_BG_DARK`) are outside the "component CSS or TSX" scope the `[mechanical]`
  no-hardcoded-hex rule targets (DESIGN.md line 89) — they're static manifest/meta data that cannot reference a
  CSS custom property, and are documented as literal copies of `--app-bg` with a comment pointing back at the
  token. Verified the values match `theme.css:86,133` exactly (`#121110` / `#f4f2ed`).
- **DRY**: `pwaConfig.ts` centralizes manifest/workbox config, imported by both `vite.config.ts` and its test —
  avoids duplicating config between build and test. `PanelDetailModal.css`'s 480px folded into the ratified
  430px rather than left as a second undocumented value.
- **Readable / modular**: config extracted into a small, single-purpose, well-commented data module; no magic
  numbers (colours and denylist patterns are named/commented).
- **Type safety**: `pwaManifest: Partial<ManifestOptions>` uses the plugin's own type; no untyped escape hatches.
- **Security**: the `/api/**` network-only invariant is enforced twice (no `runtimeCaching` match + explicit
  `navigateFallbackDenylist`) and is a mechanically-tested invariant (`pwaConfig.test.ts`), not just a comment.
- **Error handling**: N/A — no new runtime error paths introduced (static config only).
- **Tests meaningful**: `pwaConfig.test.ts`'s 7 assertions would catch a real regression — e.g. adding a
  `runtimeCaching` rule matching `/api`, removing an icon size, or narrowing font-cache expiry would all fail
  the suite. Re-ran fresh: 85/85 suites, 929/929 tests pass.
- **No dead code**: no leftover TODO/FIXME in the diff. One minor unreferenced-asset note below
  (non-blocking).
- **No over-engineering**: `generateSW` (not `injectManifest`) chosen specifically to avoid hand-written SW
  code — appropriately conservative per the ticket's own risk framing.
- **Gates re-run fresh, all clean** (independently, not trusting the executor's pasted output):
  - `npm run lint` — exit 0, zero warnings.
  - `npm run format:check` — clean.
  - `npm test` — 85 suites / 929 tests pass.
  - `npm run build` — succeeds; 16 precache entries, zero `/api` entries.
  - `npm run check:schemas` — clean (10 checked across 18 protocol files).
  - `npm run check:scala-quality` — clean (42 pre-existing soft warnings, none in files this change touches).
  - `npm run check:openspec` — fails exactly as expected/documented ("complete but not archived"), matching the
    established precedent from HEL-287 (`e674a68c`, verified this commit exists in history and used the same
    `-n` bypass pattern for the same reason).
- **`git commit -n` bypass**: verified legitimate — only the openspec-hygiene "not yet archived" check would
  have failed; every other Husky gate (lint/format/schema/scala-quality/test) was independently re-run above
  and is clean.

### Phase 3: UI Review — PASS
Issues: none blocking.

Triggered by `frontend/**` changes. Servers started via `scripts/concertino/start-servers.sh` /
`assert-phase.sh` (both `PASS`).

- **Happy path**: logged in via password auth at 1440px, dashboard rendered correctly with panels, no visual
  regression from the `100vh`→`100dvh` or breakpoint-fold changes.
- **No console errors from the diff**: the two `401` errors seen are the pre-existing (unrelated) auth-check
  probe on load (`/api/auth/me` before login) — present regardless of this diff, not a regression.
- **Dev server SW isolation confirmed**: `navigator.serviceWorker.getRegistrations()` returns `[]` on the dev
  server — `devOptions.enabled: false` verified functionally, not just by config inspection.
- **Desktop rendering unaffected** (the one device-independent visual criterion, per the ticket's own carve-out
  that this can be code-reasoned + UI-checked at desktop width): checked login page at 1440px and 768px, and
  the dashboard/panel grid at 1440px — all render identically to expected baseline; the two sub-768 CSS deltas
  (`100dvh`, 430px fold) are confirmed no-ops at these widths by direct visual check.
- **Device-dependent criteria correctly NOT claimed**: install/standalone/icon/FOUT/OAuth/keyboard/notch are
  untested here, consistent with the ticket's binding constraint — this is by design, not a gap.
- **Interactive elements / accessible names**: login form fields and buttons expose accessible names
  (confirmed via snapshot: "Email", "Password", "Sign in", "Continue with Google" all properly labeled/roled).

**Non-blocking observations** (not failures — noted for completeness):
- A new Chrome DevTools console **warning** (not error) appears: `<meta name="apple-mobile-web-app-capable">
  is deprecated. Please include <meta name="mobile-web-app-capable">`. This is Chrome/desktop-specific browser
  guidance; the `apple-` prefixed tag is still required for iOS Safari (the ticket's actual target) and is not
  deprecated there. Consider adding the standard `mobile-web-app-capable` meta alongside for other browsers in
  a follow-up, but it doesn't affect the iOS ACs this ticket targets.
- `frontend/public/pwa-64x64.png` is generated and committed but not referenced by the manifest, `index.html`,
  or any code (only 192/512/512-maskable are in the manifest icon list, and only the 180 apple-touch-icon is
  separately linked). It's a `minimal2023Preset` byproduct that also gets swept into the SW precache manifest
  (adds ~571 bytes). Harmless, but could be excluded from `pwa-assets.config.ts`'s output or from
  `globPatterns`/`includeAssets` if a future pass wants to trim the precache to exactly the ticket's stated
  icon list (180/192/512/512-maskable only).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider adding the standard `mobile-web-app-capable` meta tag alongside `apple-mobile-web-app-capable` in
  `frontend/index.html` to silence the Chrome deprecation warning (no functional impact on the iOS target).
- Consider trimming the unused `pwa-64x64.png` from the generated/committed icon set and the SW precache list,
  since it's not referenced by the manifest or `index.html` and is outside the ticket's stated icon list
  (180/192/512/512-maskable).

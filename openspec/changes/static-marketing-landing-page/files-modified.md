# HEL-1562 files modified

## Source files

- `frontend/app.html` — the former `index.html` app shell (moved unchanged, D1)
- `frontend/index.html` — new static landing page: hero, reel, build, proof points, plans, tagline; meta/canonical/OG/Twitter; head script for the signed-in hint and theme
- `frontend/vite.config.ts` — two HTML entries, shell-routing and plan-number plugins, `injectRegister: false`, SW takeover options, `navigateFallback`
- `frontend/firebase.json` — `** -> /app.html`; no-cache for `/index.html`, `/app.html` and every extensionless path; `/assets/**` immutable
- `frontend/tsconfig.json` — `resolveJsonModule` (landing imports `rects.json`)
- `frontend/src/vite-env.d.ts` — `vite-plugin-pwa/client` types for `virtual:pwa-register`
- `frontend/src/main.tsx` — explicit `registerSW` (the landing page must not register the worker)
- `frontend/src/pwaConfig.ts`, `pwaConfig.test.ts` — `start_url /home`, `navigateFallback /app.html`, query-tolerant denylist for `/` and `/index.html`, `skipWaiting`+`clientsClaim` (found by the old-service-worker run: without them the new worker waits behind the old one)
- `frontend/src/landing/` — `shellRouting.ts`(+test), `shellRoutingPlugin.ts`, `planNumbers.ts`, `planNumbersPlugin.ts`, `planNumbers.sourceScan.test.ts`, `betaRequest.ts`(+test), `betaWiring.ts`, `cases.ts`, `rectStyle.ts`, `reel.ts`, `build.ts`, `landing.ts`, `landing.css`, `landingHtml.test.ts`, `rects.json` (written by the capture run), `shots/uc-<case>-<light|dark>.jpg` (12 captures, written by the capture run)
- `frontend/public/landing/og.jpg` — 1200x630 crop of the launch capture (capture run)
- `frontend/src/services/csrfHeader.ts`, `httpClient.ts` — CSRF header name/value in a dependency-free module shared with the landing page
- `frontend/src/features/auth/state/signedInHint.ts`(+test), `frontend/src/store/store.ts` — `helio.signedIn` listener on `auth.status`
- App-home `/` -> `/home`: `app/AppRoutes.tsx` (route + `/` redirect + NotFound CTA), `app/CommandBar.tsx`, `features/auth/ui/{LoginPage,RegisterPage,MfaVerifyPage,OAuthCallbackPage,PublicOnlyRoute,UserMenu}.tsx`, `features/auth/utils/postLoginReturnTo.ts`, `features/dashboards/ui/{DashboardRoute,ProposalReviewPage}.tsx`, `features/patchSets/ui/PatchSetReviewPage.tsx`, `features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`, `features/proposals/ui/CombinedProposalReviewPage.tsx`, `features/onboarding/ui/OnboardingChecklist.tsx`, `shared/chrome/{resourceNavigation,sections}.ts`
- Their tests: `CommandBar`, `LoginPage`, `MfaVerifyPage`, `OAuthCallbackPage`, `ProtectedRoute`, `UserMenu`, `postLoginReturnTo`, `builtInActions`, `ProposalReviewPage`, `PatchSetReviewPage`, `PipelineProposalReviewPage`, `CombinedProposalReviewPage`, `BottomNav`, `navDestinations`, `resourceNavigation`, `sections`
- `frontend/src/theme/{motionTokenGuard,elevationTokenGuard}.css.test.ts` — CSS file count 132 -> 133 (`landing.css`)
- `e2e/support/isolateLivePage.ts` (`uiLogin` waits for `/home`), ~35 specs retargeted `goto/waitForURL("/")` -> `"/home"`, route tables in `focus-presence-guard`, `state-surface-contrast-guard`, `hel666-single-assistant-entry`; `e2e/hel1562-landing-page.spec.ts` (new); `e2e/README.md`
- `scripts/landing-captures/` — the capture pipeline (`run.mjs`, `capture.mjs`, `lib/`, `steps/`, `fixtures/prod-share-data/` copied from the bundle as data only, `README.md`)
- `scripts/check-landing-build.mjs`, `scripts/check-landing-build.selftest.mjs`, `package.json` scripts, `.github/workflows/ci.yml` (selftest, `vite build`, check — CI only; no `.husky` change)
- `openspec/changes/static-marketing-landing-page/` — `tasks.md` ticked, this file, `evidence/`

## Evidence (in `evidence/`)

- `capture-run.txt` — the final run of the capture pipeline against this worktree's servers (backend :9901, dev :6994): throwaway `@example.test` account, MCP build, 12 captures, panel rectangles, OG image, teardown, user deleted by exact id. The committed shots, `rects.json` and `og.jpg` are that run's output. An earlier identical run (before a one-line `innerText` change in `capture.mjs`) and a first run that hit the pipeline-run rate limit (fixed by pacing runs, see `lib/mcp.mjs`) both cleaned up; the DB shows 0 users/dashboards/pipelines for all three throwaway ids.
- `plan-number-mutation.txt` — green, then `planNumbers.ts` mutated 50 -> 51: `planNumbers.sourceScan.test.ts` goes red (`Expected: 50, Received: 51`), then reverted and green.
- `preview-curl.txt` — production `vite build` + `vite preview` curl of `/`, `/?ref=x`, `/index.html` (landing: hero, OG, canonical, no `#root`) and `/home`, `/dashboards/abc`, `/login`, `/auth/callback` (app shell, `#root`).
- `old-service-worker-run.txt` — Playwright: build of the base commit installs its service worker; the new build is served on the same origin; `/` and `/?ref=x` then show the landing page, `/home` and `/dashboards/abc` the app; manifest `start_url` `/home`. The first attempt of this run failed (new worker stayed `waiting`: `injectRegister:false` had dropped autoUpdate's `skipWaiting`/`clientsClaim`); fixed in `pwaConfig.ts` and pinned by `pwaConfig.test.ts` and `check-landing-build`.
- `check-landing-build.txt`, `d3-d11-probes.txt`, `d12-probe-after-archive-dry-run.txt`.

## D3 probe allowlist (`grep -rnE '"/"' frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.'`)

- `pwaConfig.ts:24 scope: "/"` — the manifest scope, not app home.
- `ImagePanel.tsx:36`, `firstRunNaming.ts:16`, `usePickerSelection.ts:75-76`, `reactMarkdownMock.tsx:33`, `landing/shellRouting.ts:16`, `landing/shellRoutingPlugin.ts:12` — string operations (`startsWith`/`split`/`indexOf`/`lastIndexOf`/`new URL` base), not routes.
- `AppRoutes.tsx:86` — the `/` -> `/home` redirect route itself.
- `landing/shellRouting.ts:13` — the landing path in the dev/preview routing rule.
- `test/renderWithStore.tsx:169,173` — the default `MemoryRouter` location of a test helper (not a shipped route).
- Every other hit is a comment quoting `"a"/"b"` word pairs, or `resourceNavigation.ts:28` (a comment about returning an href).

## D11 probe (`grep -rnE '(goto|waitForURL)\("/"\)|path: "/"|"/",' e2e`)

Only the intentional landing-page hits in `e2e/hel1562-landing-page.spec.ts` remain (the raw `request.get("/")`-adjacent `page.goto("/")` calls that exercise the landing page, the hint redirect and the beta states).

## D12 probe (run over a local `openspec archive` dry run in a scratch copy; the change is not archived here)

43 hits, none an app-home reference. Per-hit reasons:

- `marketing-landing-page/spec.md` (9 hits) and `pwa-installability/spec.md` (`scope: "/"`, the landing `/` requirements and scenarios, 7 hits) — the landing page's own `/`, intended.
- `frontend-pipelines-page/spec.md:45` ("Breadcrumb shows Dashboards on /") and `frontend-data-sources-page/spec.md:13` ("Navigating to / shows dashboard view") — scenario titles, kept because openspec rejects a MODIFIED block that renames a scenario; their bodies say `/home`.
- Operators and separators: `trace-context-logging` (header split), `timestamp-value-parsing` (zone-id characters), `pipeline-string-ops-op` (split separator), `compute-expression-language` (division operator), `form-panel-rendering`/`form-panel-submit` (`+`/`-` steppers).
- `"a"/"b"` word pairs: `pipeline-upsertsource-config`, `outputs-model`, `echarts-chart-panel`, `dataset-row-grid`, `pipeline-zero-root-db-guard`, `pipeline-analyze-schema-warnings`.

## Notes and deviations

- `scripts/landing-captures/run.mjs` runs `npm ci` for `helio-mcp` only when `helio-mcp/node_modules` is absent: delivery worktrees link it to the main checkout's, and `npm ci` rewrites it. It always runs `npm run build`.
- The news board uses the "Meta AI Models" story for both its photo and its summary (the bundle's own capture shows that); the bundle's `replace-image.mjs` workaround is therefore not ported.
- Plan card headings are folded as "Free: ...", "Beta, invite only: the built-in assistant", "Everywhere: on your phone, too" (C9).
- Between 769px and 1100px the build section is a stacked page (the pinned two-column layout needs the 1440/1100 desktop breakpoint); the mockup's 700/760/800/900px queries were mapped onto the canonical 768/1100.
- `/assets/<missing>` on the local preview server returns the landing page (Vite's own fallback); on Firebase it falls to `app.html`.

## Owner ruling: landing type follows DESIGN.md v3 (cycle 4)

- `frontend/src/landing/landing.css` — the wordmark, h1/h2 and closing line use `var(--font-heading)` (sans by default, like the app); the display-size headlines are `--weight-medium` (the app's headings are semibold) with their tracking unchanged; italic kept on the tagline ending and closing line.
- `frontend/index.html` — the Fraunces family is dropped from the landing's Google Fonts link: nothing on the landing reads the serif face any more, and the landing has no way to opt into the app's optional serif style. `app.html` keeps it (the app's serif style needs it).
- `frontend/src/landing/landingFonts.css.test.ts` and an e2e assertion in `e2e/hel1562-landing-page.spec.ts` guard it; `evidence/font-heading-mutations.txt` shows each going red.
- Captures are NOT retaken (owner ruling C11): the shipped shots predate v3's dark canvas; the pipeline stays.

## Declared paths (full list, for squash-branch.sh)

- `.github/workflows/ci.yml`
- `e2e/README.md`
- `e2e/auth-cookie-migration.spec.ts`
- `e2e/focus-presence-guard.spec.ts`
- `e2e/hel1023-breakpoint-layout-derivation.spec.ts`
- `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts`
- `e2e/hel1065-pin-toggle-css-fixes.spec.ts`
- `e2e/hel1079-dataset-management-ui-live.spec.ts`
- `e2e/hel1085-form-field-renderers-keyboard.spec.ts`
- `e2e/hel1087-form-submit-path.spec.ts`
- `e2e/hel1088-compact-counter-chrome.spec.ts`
- `e2e/hel1090-form-panel-assembled-a11y.spec.ts`
- `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`
- `e2e/hel1095-optimistic-pending-writing-panel-a11y.spec.ts`
- `e2e/hel1096-run-to-update-affordance.spec.ts`
- `e2e/hel1169-network-vs-rejection-reconcile-a11y.spec.ts`
- `e2e/hel1189-output-panel-controls-live.spec.ts`
- `e2e/hel1260-orphan-owner-repair.spec.ts`
- `e2e/hel1275-metric-delta-sparkline.spec.ts`
- `e2e/hel1304-output-charttype-render.spec.ts`
- `e2e/hel1305-chart-time-axis.spec.ts`
- `e2e/hel1306-chart-reference-lines.spec.ts`
- `e2e/hel1311-heatmap-histogram-charts.spec.ts`
- `e2e/hel1351-aggregated-chart-overlay.spec.ts`
- `e2e/hel1508-chart-time-axis-followups.spec.ts`
- `e2e/hel1512-category-axis-labels.spec.ts`
- `e2e/hel1562-landing-page.spec.ts`
- `e2e/hel503-palette-global-resource-search.spec.ts`
- `e2e/hel516-palette-quick-create.spec.ts`
- `e2e/hel519-recent-navigation.spec.ts`
- `e2e/hel520-focus-presence-guard.regression.spec.ts`
- `e2e/hel572-chart-click-drilldown.spec.ts`
- `e2e/hel588-cross-filter-panels.spec.ts`
- `e2e/hel665-message-composer.spec.ts`
- `e2e/hel666-single-assistant-entry.spec.ts`
- `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts`
- `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts`
- `e2e/hel813-mobile-touch-target-floor.regression.spec.ts`
- `e2e/hel813-mobile-touch-target-floor.spec.ts`
- `e2e/hel909-output-picker-panel-sheet.spec.ts`
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`
- `e2e/hel968-multi-root-editor-flow.spec.ts`
- `e2e/state-surface-contrast-guard.spec.ts`
- `e2e/support/auth.ts`
- `e2e/support/isolateLivePage.ts`
- `frontend/app.html`
- `frontend/firebase.json`
- `frontend/index.html`
- `frontend/public/landing/og.jpg`
- `frontend/src/app/AppRoutes.tsx`
- `frontend/src/app/CommandBar.test.tsx`
- `frontend/src/app/CommandBar.tsx`
- `frontend/src/features/auth/state/signedInHint.test.ts`
- `frontend/src/features/auth/state/signedInHint.ts`
- `frontend/src/features/auth/ui/LoginPage.test.tsx`
- `frontend/src/features/auth/ui/LoginPage.tsx`
- `frontend/src/features/auth/ui/MfaVerifyPage.test.tsx`
- `frontend/src/features/auth/ui/MfaVerifyPage.tsx`
- `frontend/src/features/auth/ui/OAuthCallbackPage.test.tsx`
- `frontend/src/features/auth/ui/OAuthCallbackPage.tsx`
- `frontend/src/features/auth/ui/ProtectedRoute.test.tsx`
- `frontend/src/features/auth/ui/PublicOnlyRoute.tsx`
- `frontend/src/features/auth/ui/RegisterPage.tsx`
- `frontend/src/features/auth/ui/UserMenu.test.tsx`
- `frontend/src/features/auth/ui/UserMenu.tsx`
- `frontend/src/features/auth/utils/postLoginReturnTo.test.ts`
- `frontend/src/features/auth/utils/postLoginReturnTo.ts`
- `frontend/src/features/commandPalette/model/builtInActions.test.tsx`
- `frontend/src/features/dashboards/ui/DashboardRoute.tsx`
- `frontend/src/features/dashboards/ui/ProposalReviewPage.test.tsx`
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx`
- `frontend/src/features/onboarding/ui/OnboardingChecklist.tsx`
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx`
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx`
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx`
- `frontend/src/landing/betaRequest.test.ts`
- `frontend/src/landing/betaRequest.ts`
- `frontend/src/landing/betaWiring.ts`
- `frontend/src/landing/build.ts`
- `frontend/src/landing/cases.ts`
- `frontend/src/landing/landing.css`
- `frontend/src/landing/landing.ts`
- `frontend/src/landing/landingFonts.css.test.ts`
- `frontend/src/landing/landingHtml.test.ts`
- `frontend/src/landing/planNumbers.sourceScan.test.ts`
- `frontend/src/landing/planNumbers.ts`
- `frontend/src/landing/planNumbersPlugin.ts`
- `frontend/src/landing/rectStyle.ts`
- `frontend/src/landing/rects.json`
- `frontend/src/landing/reel.ts`
- `frontend/src/landing/shellRouting.test.ts`
- `frontend/src/landing/shellRouting.ts`
- `frontend/src/landing/shellRoutingPlugin.ts`
- `frontend/src/landing/shots/uc-fantasy-dark.jpg`
- `frontend/src/landing/shots/uc-fantasy-light.jpg`
- `frontend/src/landing/shots/uc-helio-dark.jpg`
- `frontend/src/landing/shots/uc-helio-light.jpg`
- `frontend/src/landing/shots/uc-launch-dark.jpg`
- `frontend/src/landing/shots/uc-launch-light.jpg`
- `frontend/src/landing/shots/uc-news-dark.jpg`
- `frontend/src/landing/shots/uc-news-light.jpg`
- `frontend/src/landing/shots/uc-oss-dark.jpg`
- `frontend/src/landing/shots/uc-oss-light.jpg`
- `frontend/src/landing/shots/uc-revenue-dark.jpg`
- `frontend/src/landing/shots/uc-revenue-light.jpg`
- `frontend/src/main.tsx`
- `frontend/src/pwaConfig.test.ts`
- `frontend/src/pwaConfig.ts`
- `frontend/src/services/csrfHeader.ts`
- `frontend/src/services/httpClient.ts`
- `frontend/src/shared/chrome/BottomNav.test.tsx`
- `frontend/src/shared/chrome/navDestinations.test.ts`
- `frontend/src/shared/chrome/resourceNavigation.test.tsx`
- `frontend/src/shared/chrome/resourceNavigation.ts`
- `frontend/src/shared/chrome/sections.test.ts`
- `frontend/src/shared/chrome/sections.ts`
- `frontend/src/store/store.ts`
- `frontend/src/theme/elevationTokenGuard.css.test.ts`
- `frontend/src/theme/motionTokenGuard.css.test.ts`
- `frontend/src/vite-env.d.ts`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `package.json`
- `scripts/check-landing-build.mjs`
- `scripts/check-landing-build.selftest.mjs`
- `scripts/landing-captures/README.md`
- `scripts/landing-captures/capture.mjs`
- `scripts/landing-captures/fixtures/prod-share-data/helio-15798fd3-2a58-4241-b3a5-3466952c28e0-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-15798fd3-2a58-4241-b3a5-3466952c28e0-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-6f8c61c7-4c26-45e3-8ef8-109fed7dc0a2-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-6f8c61c7-4c26-45e3-8ef8-109fed7dc0a2-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-a9b1ec05-60f0-4d52-90c0-1a9a991c4391-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-a9b1ec05-60f0-4d52-90c0-1a9a991c4391-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-df064b21-d1ba-4d78-9ba7-bf5a12e4d265-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-df064b21-d1ba-4d78-9ba7-bf5a12e4d265-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-e1ade0e9-5a8f-4bc5-848c-1c677779eb1c-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-e1ade0e9-5a8f-4bc5-848c-1c677779eb1c-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-e8b65644-8605-46ac-994f-ab947f549c33-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-e8b65644-8605-46ac-994f-ab947f549c33-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/helio-panels.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-3a4d0a6d-cf4e-4aa4-9249-bc06e6ddc3ff-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-3a4d0a6d-cf4e-4aa4-9249-bc06e6ddc3ff-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-67bc3f62-47ef-44d8-be84-d2d491b10b82-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-67bc3f62-47ef-44d8-be84-d2d491b10b82-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-9c6cf091-2265-4f26-93b1-afc78238d492-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-9c6cf091-2265-4f26-93b1-afc78238d492-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-9f6f3500-6aa8-4eb4-a094-4a4fed28ed03-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-9f6f3500-6aa8-4eb4-a094-4a4fed28ed03-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-bfe6b7a0-f599-4f79-aa83-0c3295d87f73-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-bfe6b7a0-f599-4f79-aa83-0c3295d87f73-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-ce178724-579e-437c-b8de-ae80b6c8569f-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-ce178724-579e-437c-b8de-ae80b6c8569f-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-d8181287-820b-4623-8715-7439f229e673-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-d8181287-820b-4623-8715-7439f229e673-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-eb6aa3f9-3b65-4495-a4e1-312a5c4de19d-output-meta.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-eb6aa3f9-3b65-4495-a4e1-312a5c4de19d-rows.json`
- `scripts/landing-captures/fixtures/prod-share-data/news-panels.json`
- `scripts/landing-captures/lib/api.mjs`
- `scripts/landing-captures/lib/config.mjs`
- `scripts/landing-captures/lib/mcp.mjs`
- `scripts/landing-captures/run.mjs`
- `scripts/landing-captures/steps/build-launch.mjs`
- `scripts/landing-captures/steps/build-replicas.mjs`
- `scripts/landing-captures/steps/build-usecases.mjs`
- `scripts/landing-captures/steps/enhance.mjs`

## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All four ticket ACs addressed explicitly, not partially:
  1. Bundle report produced (`rollup-plugin-visualizer` via `npm run build:analyze` →
     `dist/stats.html`); before/after documented in `files-modified.md`. Independently re-ran
     `npm run build` and `npm run build:analyze` — chunk names/sizes are byte-for-byte identical to
     the executor's reported numbers (see Phase 2 below), and `grep` against the built output
     confirms `echarts`/`remark`/`micromark` markers are present only in `ChartPanel-*.js` /
     `MarkdownPanel-*.js`, absent from the entry chunk.
  2. First-load chunk measurably reduced and reported: 1,694.36 kB → 942.19 kB raw (‑44%), 512.69 kB
     → 264.99 kB gzip (‑48%). App functionality verified unchanged in Phase 3.
  3. Chart/markdown/proposal surfaces load on demand with a graceful `Spinner`-based fallback
     (`PanelSuspenseFallback`/`PageSuspenseFallback`, matching `PanelContent`'s existing data-loading
     markup per DESIGN.md §7), no console errors — verified live in Phase 3.
  4. Lint zero-warnings and all Jest tests pass (independently re-run, see Phase 2); no new eager
     heavy imports — `ChartRenderer.tsx`/`MarkdownRenderer.tsx`/`AppRoutes.tsx` diffs confirm only
     `React.lazy(() => import(...))` boundaries were added, no static `echarts`/`react-markdown`/
     `ProposalReviewPage` imports remain.
- No AC silently reinterpreted.
- All 8 `tasks.md` task groups checked off; each matches what's actually in the diff (bundle
  analysis wiring, `Suspense` fallback component, chart/markdown/proposal lazy boundaries,
  tree-shaking no-op confirmation, after-baseline, test updates).
- No scope creep: every changed file is within the ticket's stated impact
  (`vite.config.ts`, `ChartRenderer.tsx`/`MarkdownRenderer.tsx`, `AppRoutes.tsx`, new
  `shared/ui/SuspenseFallback.*`, plus their tests). `package.json`'s incidental reordering of the
  `qrcode.react` dependency line (npm's own alphabetization on install) is a no-op, not a behavior
  change.
- No regressions to existing behavior: `PanelContent.test.tsx`'s pre-existing chart-forwarding/
  annotation-resolution assertions still exercise the same behavior, just `await`-ing the now-async
  mount; `echarts-chart-panel`/`markdown-panel` capability requirements are unaffected (confirmed
  live — chart renders identically, markdown renders identically).
- No API/schema contracts touched (frontend-only change); `check:schemas` re-run clean.
- Planning artifacts (`design.md` Decisions 1–5) match the implemented behavior exactly — verified
  line-by-line against the diff (lazy-loading the inner component from inside the renderer file,
  per-panel `Suspense` boundaries, reused `Spinner` fallback, page-level `Suspense` for
  `ProposalReviewPage`, conditionally-added visualizer plugin).

### Phase 2: Code Review — PASS

Issues: none.

**Gates independently re-run in `WORKTREE_PATH`** (no `CLEAN_WORKTREE` flag was passed for this
run, so per-instructions gates ran directly in the executor's worktree):

- `npm run lint` → clean, 0 warnings.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → `Test Suites: 212 passed, 212 total`, `Tests: 2252 passed, 2252 total`.
- `npm --prefix frontend run build` → succeeds; produced chunk sizes match the executor's reported
  after-baseline exactly (`index-CymID4TH.js` 942.19 kB/264.99 kB gzip,
  `ChartPanel-Dio4HnYi.js` 590.62 kB/199.98 kB gzip, `MarkdownPanel-Dffs1RR6.js` 153.85 kB/45.83 kB
  gzip, `ProposalReviewPage-0XtfipOi.js` 5.81 kB/2.18 kB gzip).
- `npm run build:analyze` → also independently re-run; produces `dist/stats.html` (1.2 MB), ordinary
  build output/chunk hashes identical to the non-analyze build, confirming the plugin is truly
  opt-in and non-invasive.
- `npm run check:openspec` → independently re-run; the **only** failure is "change ... is complete
  (15/15) but not archived" — matches the executor's claim exactly. This is expected at this
  workflow stage (archiving is a later Phase 3 step), consistent with cited HEL-703/HEL-704
  precedent.
- `npm run check:schemas` and `npm run check:scala-quality` also independently re-run as an extra
  cross-check of the "only check:openspec failed" claim — both clean (the scala-quality soft-budget
  warnings are all pre-existing backend test files untouched by this diff).
- **Verdict on the Husky-bypass claim: independently confirmed correct.** All gates the executor
  claims passed did in fact pass on a fresh re-run; the one hook that failed is exactly the one
  claimed, for exactly the claimed (expected) reason.

**Standards compliance** (CONTRIBUTING.md binding always; DESIGN.md binding for `frontend/**`):

- File-size budgets: all changed/new files well under the ~250-line soft budget (largest is
  `AppRoutes.tsx` at 101 lines).
- Imports & Qualifiers: N/A section is Scala-specific; frontend imports are all top-of-file, no
  inline FQNs.
- DESIGN.md §7 loading pattern: `PanelSuspenseFallback` is byte-for-byte the same recipe as
  `PanelContent.tsx`'s existing data-loading state (`Spinner size="xl"` + `aria-label="Loading
  data"` + visible "Loading..." label) — verified by diff comparison
  (`frontend/src/features/panels/ui/PanelContent.tsx:64-68` vs.
  `frontend/src/shared/ui/SuspenseFallback.tsx:11-17`). `PageSuspenseFallback` reuses the documented
  `2xl` `Spinner` size (already used by `auth.css`'s boot spinner per `Spinner.tsx`'s own docblock).
  Both fallbacks reuse the shared `Spinner` primitive rather than hand-rolling — no new
  hand-rolled equivalent introduced (§6 "use these; do not hand-roll equivalents").
- Design.md Decision 1 (lazy the inner component, not the renderer's own export) implemented
  exactly as specified in `ChartRenderer.tsx:1-16`/`MarkdownRenderer.tsx:1-17` — renderer export
  signatures and `PanelContent.tsx`'s import of them are untouched, confirmed by diff.
- DRY: acceptable. The `.then((m) => ({ default: m.X }))` named-export adapter appears 3x
  (`ChartRenderer.tsx`, `MarkdownRenderer.tsx`, `AppRoutes.tsx`) — each is a one-line, self-evident
  idiom; not significant duplication (see non-blocking suggestion below).
- Readable/Modular: clear naming (`PanelSuspenseFallback`/`PageSuspenseFallback`), each `Suspense`
  boundary scoped to its own call site per Decision 2 (no accidental single global boundary
  blocking the whole grid).
- Type safety: no `any` introduced (verified by diff grep); `React.lazy`'s `{ default }` adapter is
  correctly typed by TS inference from the named export.
- Error handling: N/A — no new error paths introduced; `Suspense` fallback covers the pending
  state, and a genuinely failed chunk fetch is unchanged existing browser/React behavior (out of
  ticket scope, ticket only requires the loading-fallback scenario).
- Tests meaningful: new `ChartRenderer`/`MarkdownRenderer` Suspense-fallback and no-console-error
  tests exercise the new code paths and would catch a real regression (e.g. an accidentally
  removed `Suspense` boundary would fail the "shows fallback" assertion). The order-dependent test
  design (pending-fallback test must run first in its file, due to `React.lazy`'s per-module-
  instance promise memoization under Jest's shared module registry) is explained thoroughly in both
  the test file comments and `files-modified.md`'s root-cause note, and is currently
  deterministic (Jest runs tests in file order by default) — flagged as a non-blocking suggestion
  below, not a defect.
- No dead code: no unused imports, no leftover TODO/FIXME (grep-verified).
- No over-engineering: no premature abstraction introduced for the 3x adapter duplication (see
  suggestion below — could go either way).
- Behavior-preserving: this is additive code-splitting, not a refactor; live UI testing (Phase 3)
  confirms chart/markdown/proposal-review render identically to pre-change behavior.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both reported
healthy (`PASS servers`).

- **Happy path end-to-end**: opened an existing dashboard containing multiple chart panels — all
  rendered correctly with no console errors. Created a new Markdown panel via the full "+ Add
  panel" UI flow (panel-type → template → data-type-skip → name → create), edited its content, and
  confirmed the lazily-loaded `MarkdownPanel` rendered the markdown (heading, paragraph, list)
  correctly with no console errors. Navigated directly to `/proposals/review` — the lazily-loaded
  `ProposalReviewPage` rendered its full content with no console errors.
- **Loading states**: fallback markup/labels verified via code review and the `SuspenseFallback`
  unit tests; the actual pending-fallback transition is sub-frame on a warm local dev server (as
  design.md's own risk analysis anticipates) and wasn't visually caught live, which is expected
  and consistent with the design's stated trade-off — not a defect.
- **No console errors**: verified via `browser_console_messages` (error level) across every tested
  flow (dashboard load, panel creation, markdown edit/save, direct navigation to
  `/proposals/review`) — 0 app-generated errors. (One stray 403 appeared from my own manual
  unauthenticated `fetch()` CSRF probe against `/api/dashboards` during testing — not
  app-generated, not related to this change.)
- **Entry points**: chart panels (existing dashboard), markdown panel (created fresh via the full
  UI flow), and the Proposal Review route (direct navigation) were all exercised.
- **Accessible names / keyboard**: fallback `<div>`s carry `aria-label` ("Loading data" /
  "Loading"); all interactive elements used during testing (Add panel, template picker, Edit,
  Save, panel options menu, Delete/Confirm) exposed accessible names via the standard
  role-based snapshot/click flow.
- **Breakpoints**: resized to 1440 / 1100 / 768 / 375 (0 → smallest supported) on a dashboard
  containing both the markdown panel and chart panels — no layout breakage at any width; desktop
  grid → mobile stack transition at 768 behaved as expected, panels fully legible at 375.

Test panel created for this review was deleted afterward to avoid polluting the shared dev
database.

### Overall: PASS

### Non-blocking Suggestions

- The `ChartRenderer.test.tsx`/`MarkdownRenderer.test.tsx` "pending fallback" tests are
  order-dependent on being the first test in their file to touch the lazily-loaded module (due to
  `React.lazy`'s per-module-instance promise memoization colliding with Jest's shared module
  registry per file). This is clearly documented and currently deterministic, but a
  `jest.resetModules()` + dynamic re-import of the component under test per test case (or an
  equivalent per-test module isolation pattern) would remove the ordering coupling entirely and be
  more resilient to future test additions/reordering in these files.
- The `.then((m) => ({ default: m.X }))` named-export-to-default adapter is duplicated 3x
  (`ChartRenderer.tsx`, `MarkdownRenderer.tsx`, `AppRoutes.tsx`). Each instance is a single line
  and self-evident, so this isn't a DRY violation worth blocking on, but a tiny shared
  `lazyNamed(loader, key)` helper in `shared/utils` would remove the repetition if a fourth call
  site is ever added.

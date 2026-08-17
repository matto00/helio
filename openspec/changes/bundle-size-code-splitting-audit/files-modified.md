# Files Modified — HEL-512 bundle-size-code-splitting-audit

- `frontend/package.json` — added `rollup-plugin-visualizer` devDependency + `build:analyze` script.
- `frontend/package-lock.json` — lockfile update from the above install.
- `frontend/vite.config.ts` — conditionally adds the `rollup-plugin-visualizer` plugin when
  `ANALYZE=true` (never on an ordinary `npm run build`); report written to `dist/stats.html`
  (already git-ignored via `frontend/dist/`).
- `frontend/src/shared/ui/SuspenseFallback.tsx` (new) — `PanelSuspenseFallback` (panel-body,
  matches `PanelContent`'s data-loading pattern) and `PageSuspenseFallback` (route-level) Suspense
  fallbacks, reusing the shared `Spinner` primitive per DESIGN.md §7.
- `frontend/src/shared/ui/SuspenseFallback.css` (new) — layout/sizing for the two fallback variants.
- `frontend/src/shared/ui/SuspenseFallback.test.tsx` (new) — unit coverage for both fallback
  components.
- `frontend/src/shared/ui/index.ts` — exports the two new fallback components.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — `ChartPanel`'s import becomes a
  `React.lazy(() => import("../ChartPanel").then(...))` target wrapped in a local `Suspense`
  (design.md Decision 1); `ChartRenderer`'s own export/signature and `PanelContent.tsx`'s import of
  it are unchanged.
- `frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx` — same treatment for
  `MarkdownPanel`.
- `frontend/src/app/AppRoutes.tsx` — `ProposalReviewPage`'s import becomes `React.lazy`; its
  `<Route element>` wrapped in a page-level `Suspense` with `PageSuspenseFallback`.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.test.tsx` — converted synchronous
  `getByTestId` assertions to `await screen.findByTestId` (Suspense-aware); added Suspense-fallback
  and no-console-errors coverage. The "still pending" fallback test must run first in the file (see
  root-cause note below) — reordered so it's the file's first describe block.
- `frontend/src/features/panels/ui/renderers/MarkdownRenderer.test.tsx` (new) — bound/static
  content resolution, Suspense-fallback, and no-console-errors coverage (none of this existed
  before this change). Same first-test-in-file ordering constraint as `ChartRenderer.test.tsx`.
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — converted chart-related tests
  (appearance forwarding, prop forwarding, annotation resolution) to `await screen.findByTestId`
  now that `ChartPanel` mounts asynchronously behind `ChartRenderer`'s `Suspense` boundary.
- `openspec/changes/bundle-size-code-splitting-audit/tasks.md` — checked off completed tasks.

## Bundle-composition report (rollup-plugin-visualizer, `npm run build:analyze`)

**Before** (pre-lazy-loading baseline, captured by temporarily stashing the lazy-loading edits
above and re-running the analyzed build):

- Single entry chunk: `index-kYqN1pLj.js` — **1,694.36 kB** raw / **512.69 kB gzip** (no other JS
  chunks — zero code-splitting existed).
- Per-module rendered-size contribution (rollup pre-minification `renderedLength`, summed from the
  visualizer's own module tree — directional, not additive to the final minified/gzip totals):
  `echarts`/`echarts-for-react`: ~889 kB across 201 modules; `react-markdown` +
  `remark`/`micromark`/`mdast`/`unified` transitive deps: ~295 kB across 175 modules.

**After** (post-lazy-loading, this change):

- Entry chunk: `index-CymID4TH.js` — **942.19 kB** raw / **264.99 kB gzip** (‑44% raw / ‑48% gzip).
- `ChartPanel-Dio4HnYi.js` (echarts) — 590.62 kB raw / 199.98 kB gzip, its own chunk.
- `MarkdownPanel-Dffs1RR6.js` (react-markdown/remark-gfm) — 153.85 kB raw / 45.83 kB gzip, its own
  chunk.
- `ProposalReviewPage-0XtfipOi.js` — 5.81 kB raw / 2.18 kB gzip, its own chunk (+ its own 2.72 kB
  CSS chunk).
- Verified `echarts`/`remark`/`micromark` string markers are present **only** in their own chunks
  and absent from the entry chunk (`grep` sanity check against the built output), matching the
  spec's "not present in the initial entry chunk" scenarios for chart/markdown/ProposalReviewPage.

## Root cause / probe notes (systematic-debugging law)

No product bug was fixed in this change — this is new capability work (code-splitting), not a
defect fix. One genuine test-authoring bug was found and fixed during verification, with a
probe-confirmed root cause:

- **Symptom**: `npm test` failed 2 of 2252 tests — `ChartRenderer.test.tsx` and
  `MarkdownRenderer.test.tsx`'s new "shows the shared panel-loading fallback before the chunk
  resolves" tests found the *resolved* content (`echarts`/`markdown-content` testid) already
  present immediately after `render()`, instead of the expected pending-Suspense fallback —
  despite no `await` having run yet in that synchronous test body.
- **Root cause** (one sentence, failing layer = test infrastructure, not product code):
  `React.lazy(loader)` memoizes its loader's promise once per module instance, and Jest shares one
  module registry per **test file** (not per test case), so once any *earlier* test in the file
  triggered and resolved the shared `ChartPanel`/`MarkdownPanel` dynamic import, every *later*
  test's render of the same `ChartRenderer`/`MarkdownRenderer` module saw the already-fulfilled
  chunk and never re-suspended.
- **Probe**: ran the failing test in isolation —
  `npx jest --config jest.config.cjs --testPathPatterns=ChartRenderer.test.tsx -t "shows the
  shared panel-loading fallback"` — which passed when it was the only test to touch the module,
  confirming the pending state *is* observable, just not after another test in the same file has
  already resolved it.
- **Probe output**: `Tests: 7 skipped, 1 passed, 8 total` (isolated run passes) vs. `Test Suites: 2
  failed` (full-file run, same assertion, fails) — the only variable between the two runs is
  whether an earlier test in the file had already resolved the shared lazy promise.
- **Fix**: reordered each file so the pending-fallback test is the file's first test to render the
  component (guaranteeing it runs before any other test resolves the shared promise), and made
  that test `await screen.findByTestId(...)` its own resolution before finishing (so the
  transition is captured in that test's own `act()` scope instead of leaking an "update not
  wrapped in act(...)" warning into whichever test runs next). Verified: full suite now passes
  (`npm test` — `Test Suites: 212 passed, 212 total`, `Tests: 2252 passed, 2252 total`), and the
  isolated + full-file runs produce identical results for both files.

Separately (not a bug, an investigated design constraint): whether the existing Jest mocks for
`echarts-for-react/esm/core` / `react-markdown` (module-path–keyed via `jest.config.cjs`
`moduleNameMapper` and `ChartRenderer.test.tsx`'s local `jest.mock`) still intercept the *dynamic*
`import()` calls introduced by `React.lazy` — confirmed yes (Jest's module registry keys mocks by
resolved module path regardless of static vs. dynamic import syntax), but the mocked promise still
resolves on a microtask tick, so `render()` alone is insufficient — every other affected test needed
`await screen.findByTestId(...)` to let the Suspense boundary settle before asserting.

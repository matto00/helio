## 1. Frontend: Bundle analysis baseline

- [x] 1.1 Add `rollup-plugin-visualizer` as a frontend devDependency.
- [x] 1.2 Wire it into `vite.config.ts` as a conditional plugin (e.g. `ANALYZE=true` env var or a
      dedicated `build:analyze` npm script), gitignore its HTML report output.
- [x] 1.3 Run a baseline `npm run build` (pre-lazy-loading) with analysis enabled; record the
      largest chunks/dependencies (entry chunk size, echarts/react-markdown contribution) for the
      PR description.

## 2. Frontend: Suspense fallback

- [x] 2.1 Add a shared `Suspense` fallback matching DESIGN.md §7 (reuse `Spinner` from
      `shared/ui`), sized for panel-body use and for page-level route use.

## 3. Frontend: Chart panel code-splitting

- [x] 3.1 Convert `ChartRenderer.tsx`'s inner chart component to a `React.lazy(() => import(...))`
      target; wrap its usage in `Suspense` with the panel-body fallback from 2.1.
- [x] 3.2 Verify `PanelContent.tsx`, `PanelCard.tsx`, `PanelDetailModal.tsx`, and
      `MobilePanelStack.tsx` require no changes at all — the renderer's own export shape/signature
      stays untouched; only its internal import of `ChartPanel` becomes lazy.

## 4. Frontend: Markdown panel code-splitting

- [x] 4.1 Convert `MarkdownRenderer.tsx`'s inner markdown component to a
      `React.lazy(() => import(...))` target; wrap its usage in `Suspense` with the panel-body
      fallback from 2.1.

## 5. Frontend: Proposal Review route code-splitting

- [x] 5.1 Convert `ProposalReviewPage`'s import in `AppRoutes.tsx` to `React.lazy`; wrap its
      `<Route element>` in a page-level `Suspense` with the fallback from 2.1.

## 6. Frontend: Tree-shaking verification (no-op confirmation)

- [x] 6.1 Confirm `shared/ui/index.ts` and the rest of the tree contain no barrel re-exporting
      echarts/react-markdown/icon-library internals eagerly (already verified during planning —
      re-confirm against the post-change diff, no code change expected).
- [x] 6.2 Confirm `lucide-react`/FontAwesome imports remain named/per-icon (no code change
      expected; re-confirm against the diff).

## 7. Frontend: After baseline

- [x] 7.1 Run `npm run build` with analysis enabled again (post-lazy-loading); record the new
      entry-chunk size and confirm echarts/react-markdown/ProposalReviewPage no longer appear in
      the entry chunk, for the PR description's before/after.

## 8. Tests

- [x] 8.1 Update any Jest tests asserting synchronously on `ChartRenderer`/`MarkdownRenderer`
      output to `await screen.findBy...` (Suspense-aware); confirm existing
      `echartsForReactCoreMock.tsx`/`reactMarkdownMock.tsx` mocks still apply under `React.lazy`.
- [x] 8.2 Update any Jest tests covering `ProposalReviewPage` routing similarly. (Verified: no
      existing test renders `ProposalReviewPage` through `AppRoutes`/the app's route table —
      `ProposalReviewPage.test.tsx` renders the page component directly, unaffected by the
      `AppRoutes.tsx` lazy wrapper — so no test needed updating.)
- [x] 8.3 Add/confirm a test that a chart panel and a markdown panel both mount and render (post
      their fallback) with no console errors, matching existing `echarts-chart-panel`/
      `markdown-panel` scenarios.
- [x] 8.4 Run full `npm test` and `npm run lint` (zero-warnings); fix any breakage.

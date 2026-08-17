## Why

The frontend ships a single ~2 MiB main chunk (already flagged in `vite.config.ts`'s HEL-553
workbox-limit comment), no route-level code splitting. Every user downloads
`echarts`/`echarts-for-react` and `react-markdown`/`remark-gfm` on first paint even with no
chart/markdown panels, and all 16 unique routed page components (17 routed paths; incl. `ProposalReviewPage`, reached only from
NL-authoring) load eagerly regardless of route.

## What Changes

- Add `rollup-plugin-visualizer` (dev-only) to `vite.config.ts`; capture a before/after baseline
  in the PR description.
- Add `React.lazy`/`Suspense` around `ChartRenderer` (the `echarts` boundary), `MarkdownRenderer`
  (the `react-markdown` boundary), and the `ProposalReviewPage` route.
- Add a `Spinner`-based `Suspense` fallback matching DESIGN.md §7, sized per boundary.
- No barrel fix needed: `shared/ui/index.ts` re-exports only lightweight primitives; no other
  barrels exist.
- No icon-tree-shaking fix needed: `lucide-react`/FontAwesome imports are already per-icon named.

## Capabilities

### New Capabilities

- `frontend-code-splitting`: heavy, non-critical-path surfaces (chart rendering, markdown
  rendering, Proposal Review route) load via dynamic `import()` rather than the initial entry
  chunk, with a `Spinner`-based `Suspense` fallback, no console errors, and a bundle-visualizer
  report documenting chunk composition.

### Modified Capabilities

(none — `echarts-chart-panel`/`markdown-panel`'s render-once-mounted requirements are unaffected
by how the component code is fetched.)

## Impact

- `frontend/vite.config.ts` — new dev dependency + visualizer plugin wiring.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`,
  `.../renderers/MarkdownRenderer.tsx` — inner components become lazy imports, wrapped in
  `Suspense`.
- `frontend/src/app/AppRoutes.tsx` — `ProposalReviewPage` becomes `React.lazy`.
- `frontend/src/shared/ui/` — reuse `Spinner` per DESIGN.md §7 for the fallback.
- Jest tests covering these components may need `Suspense`-aware assertions
  (`await screen.findBy...`).

## Non-goals

- Rewriting the charting library, or panel-grid virtualization (separate ticket, HEL-351).
- Backend build/deploy changes.
- Per-panel viewport-based lazy mounting — only the module is code-split, not panel activation.

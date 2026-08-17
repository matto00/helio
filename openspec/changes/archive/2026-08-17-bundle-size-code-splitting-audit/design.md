## Context

`frontend/vite.config.ts` has no `build.rollupOptions` today and no bundle-visualizer plugin
installed. The single main chunk is already ~2 MiB (per the HEL-553 comment raising
`workbox.maximumFileSizeToCacheInBytes` to 4 MiB specifically because code-splitting hadn't
landed yet). `AppRoutes.tsx` statically imports all 16 unique routed page components (17 routed
paths — `TypeRegistryPage` is reused at two paths). `echarts`/`echarts-for-react`
is already isolated behind one module (`echartsCore.ts`) and one component (`ChartPanel.tsx`),
reached only via `ChartRenderer.tsx`; `react-markdown`/`remark-gfm` is isolated the same way behind
`MarkdownPanel.tsx`/`MarkdownRenderer.tsx`. Both are dispatched from the single
`PanelContent.tsx` (`isChartPanel`/`isMarkdownPanel`), used by desktop grid, mobile stack, and the
detail modal alike. There is no panel-grid visibility/activation gate — every panel on the open
dashboard mounts immediately (`PanelCardBody`'s `frozen` flag is a drag-freeze, not lazy-mount), so
several `ChartRenderer`/`MarkdownRenderer` instances can fire their dynamic `import()` simultaneously
on dashboard load. `shared/ui/index.ts` is the only barrel in the tree and re-exports only
lightweight primitives (`Spinner` among them) — no barrel-induced eager loading exists to fix.
Icon imports (`lucide-react`, FontAwesome) are already named/per-icon. No `React.lazy`/`Suspense`
usage exists anywhere in `frontend/src` today.

## Goals / Non-Goals

**Goals:**
- Move `echarts`, `react-markdown`/`remark-gfm`, and `ProposalReviewPage`'s module graph out of
  the initial entry chunk via `React.lazy` + `Suspense`.
- Produce a bundle-composition report (baseline + after) via `rollup-plugin-visualizer`.
- Match DESIGN.md §7's existing loading convention (`Spinner`, visible label, `aria-label`) for
  every new `Suspense` fallback.

**Non-Goals:**
- Viewport/visibility-based lazy mounting of panels (no activation gate exists to hook into; a
  larger change than this ticket).
- Splitting other routed pages beyond `ProposalReviewPage` (ticket names it explicitly; the other
  15 pages are smaller and not flagged in scope).
- Revisiting `workbox.maximumFileSizeToCacheInBytes` — left at 4 MiB; lowering it is a follow-up
  once real post-split chunk sizes are known (flagged as an Open Question below).

## Decisions

1. **Lazy-load the inner heavy component, from inside the renderer file — not the renderer's own
   export.** `ChartRenderer.tsx`/`MarkdownRenderer.tsx` are named-export-only today (no default
   export) and are themselves statically, synchronously imported by name from `PanelContent.tsx`
   (`import { ChartRenderer } from "./renderers/ChartRenderer"`); that import statement is left
   untouched. The actual heavy imports (`echarts`/`echarts-for-react` in `ChartPanel.tsx`;
   `react-markdown`/`remark-gfm` in `MarkdownPanel.tsx`) live one level deeper than the renderer
   files. So each renderer's own top-level `import { ChartPanel } from "../ChartPanel"` /
   `import { MarkdownPanel } from "../MarkdownPanel"` is replaced with a `React.lazy` call wrapping
   a dynamic `import()` of that same module, with a `.then(m => ({ default: m.ChartPanel }))`
   (resp. `m.MarkdownPanel`) adapter — `ChartPanel`/`MarkdownPanel` are themselves named exports,
   not default exports, so `React.lazy` (which requires a promise resolving to a `{ default }`
   shape) needs that adapter at each call site. A local `<Suspense>` wraps just that inner render,
   inside the renderer function's own return — the renderer's own signature, export shape, and
   `PanelContent.tsx`'s import of it are all unchanged, so `PanelCard`/`PanelDetailModal`/
   `MobilePanelStack` genuinely need no changes; only `ChartPanel.tsx`'s/`MarkdownPanel.tsx`'s
   module code moves into a separate chunk, which is what actually removes `echarts`/
   `react-markdown` from the entry chunk.
2. **One `Suspense` boundary per mounted panel instance, not one global boundary.** Since there is
   no activation gate, multiple chart/markdown panels can mount concurrently; a single top-level
   `Suspense` would block the whole grid on one panel's chunk. Each `ChartRenderer`/
   `MarkdownRenderer` call site gets its own `Suspense`, matching today's per-panel `PanelCardBody`
   isolation (a slow chunk fetch degrades one panel's card body, not the grid).
3. **Fallback: existing `Spinner` primitive from `shared/ui`,** sized/labelled per DESIGN.md §7's
   established panel-loading markup (`Spinner size="xl"` + `aria-label="Loading data"`-style visible
   label) — no new shared component needed, reusing the exact pattern already used for
   data-loading states in `PanelContent.tsx` keeps the two loading states visually indistinguishable
   from the user's perspective (chunk-loading vs. data-loading).
4. **`ProposalReviewPage` becomes `React.lazy` in `AppRoutes.tsx`,** wrapped in a single page-level
   `Suspense` (route-level, not per-panel — it's one page, not N mounted instances). Its own
   `ProposalReview.tsx` import graph is confirmed lightweight (no echarts/react-markdown), so the
   win here is purely "don't ship its module graph on every other route," not chart/markdown
   weight.
5. **`rollup-plugin-visualizer` wired as a conditionally-added plugin** (e.g. gated on an
   `ANALYZE=true` env var or a separate `build:analyze` script), not unconditionally on every
   `npm run build` — keeps prod build output/timing unaffected; the visualizer's own HTML report
   is git-ignored, only the reported numbers go in the PR description.

## Risks / Trade-offs

- [Existing Jest tests assert on `ChartRenderer`/`MarkdownRenderer` output synchronously] →
  convert to `await screen.findBy...` (React Testing Library resolves suspended lazy children once
  the mocked dynamic import resolves); `jest.mock` of `echarts-for-react`/`react-markdown` already
  exists (`src/test/echartsForReactCoreMock.tsx`, `src/test/reactMarkdownMock.tsx`) and continues
  to apply under `React.lazy` since the mock intercepts the same module specifier.
- [Concurrent chunk fetches for chart+markdown+chart dashboards on a slow connection] → each has
  its own `Suspense`, so slow ones show their own fallback independently; no cross-panel blocking.
- [`ProposalReviewPage`'s `Suspense` fallback causing a visible flash on fast connections] →
  acceptable per DESIGN.md §7 ("skeleton... never a flash of empty content" refers to data, not
  chunk-load; a fast local chunk fetch is typically sub-frame after warm cache, matching existing
  route-transition experience).

## Migration Plan

No data/schema migration. Deploy is a normal frontend build; Vite splits the lazy imports into
separate chunks automatically at build time — no server-side routing change needed (SPA fallback
already serves `index.html` for all paths). Rollback is a plain revert.

## Open Questions

- Whether `workbox.maximumFileSizeToCacheInBytes` (currently 4 MiB, HEL-553) should be lowered
  back down once real post-split chunk sizes are measured — deferred to a follow-up once the
  baseline/after numbers from this change are in hand (self-approved: out of this ticket's
  acceptance criteria, which only requires reporting the number, not retuning workbox).

## Planner Notes

- Self-approved: `rollup-plugin-visualizer` chosen over `vite-bundle-visualizer` or Vite's own
  `--profile` output — it's the most widely-used, zero-config option for a Rollup/Vite build and
  needs no new build-tool abstraction.
- Self-approved: no `Modified Capabilities` — `echarts-chart-panel`/`markdown-panel`'s
  "no console errors on mount/unmount" scenarios are preserved as-is; lazy-loading is additive at
  the module-fetch layer, not a change to mount/unmount behavior itself.

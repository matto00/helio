# Files modified — HEL-528 skeleton loaders

## Canonical docs

- `DESIGN.md` — §3 Motion bullet extended with `--app-skeleton-shimmer`; §6 primitives list adds `Skeleton`.

## New: the shared `Skeleton` primitive

- `frontend/src/shared/ui/Skeleton.tsx` — the primitive (`block`/`line`/`circle`, `aria-hidden`, D7 skeleton-vs-spinner comment).
- `frontend/src/shared/ui/Skeleton.css` — token-only shimmer, `prefers-reduced-motion` override.
- `frontend/src/shared/ui/Skeleton.test.tsx` / `Skeleton.css.test.ts` — unit + static CSS-hygiene tests.
- `frontend/src/shared/ui/index.ts` — exports `Skeleton`.
- `frontend/src/theme/theme.css` — adds `--app-skeleton-shimmer: 1.6s` to the Motion block.

## New: per-surface skeleton components (built exclusively from `Skeleton`)

- `frontend/src/shared/chrome/SidebarRowsSkeleton.tsx` (+ `.test.tsx`) — sidebar list skeleton (flat/stacked row shapes, D9). Geometry classes live in `DashboardList.css` (see below).
- `frontend/src/features/panels/ui/PanelCardSkeleton.tsx` (+ `.test.tsx`) — one grid-card placeholder.
- `frontend/src/features/panels/ui/panelGridSkeletonStubs.ts` (+ `.test.ts`) — pure stub-panel builder feeding `resolveDashboardLayout` (D10's three-tier rule).
- `frontend/src/features/panels/ui/DesktopPanelGridSkeleton.tsx` (+ `.test.tsx`) — mounts the real `Responsive` grid (drag/resize disabled) with placeholder cards.
- `frontend/src/features/panels/ui/MobilePanelStackSkeleton.tsx` (+ `.test.tsx`) — phone-stack placeholder, neutral height.
- `frontend/src/features/panels/ui/PanelGridSkeleton.tsx` (+ `.test.tsx`) — desktop/phone branch wrapper, mirrors `PanelGrid.tsx`.
- `frontend/src/features/panels/ui/PanelBodySkeleton.tsx` (+ `.css`, `.test.tsx`) — kind-agnostic panel-body skeleton shared by `PanelContent` and `PanelSuspenseFallback` (D6).
- `frontend/src/features/pipelines/ui/PipelineDetailSkeleton.tsx` — header/river/footer band skeleton.
- `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx` — preview-table skeleton for `SourceDetailPanel`.
- `frontend/src/shared/ui/PageContentSkeleton.tsx` — generic main-content skeleton (reuses `EmptyState --main`'s 320px-floor class) for `SourcesPage`/`PipelinesPage`/`TypeRegistryPage`.
- `frontend/src/shared/ui/skeletonAccessibility.test.tsx` — cross-surface a11y lock (6.6): one accessible name per region, no `role="alert"`.
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx` — D13/3.2b component-level regression lock (metric + table, grid + detail modal), using a frozen-`paginationState` store to hold the true pre-dispatch frame open for assertion.

## Modified: wiring the skeleton into each surface

- `frontend/src/shared/chrome/SidebarItemList.tsx` (+ test) — `status` prop dropped, `initialLoad`/`rowShape` added; renders `SidebarRowsSkeleton` instead of `StatusMessage`'s loading branch (D11).
- `frontend/src/shared/chrome/SidebarBody.tsx` — computes `initialLoad` per call site (D11's call-site-owns-the-decision rule) and passes `rowShape="stacked"` for the registry section (D9).
- `frontend/src/features/dashboards/ui/DashboardList.tsx` (+ test) — same skeleton, widened idle/loading gate (D11), D4 fix so a `loading` refetch keeps rendering existing items.
- `frontend/src/features/dashboards/ui/DashboardList.css` — `.dashboard-list__skeleton-text`/`.dashboard-list__skeleton-line[--name|--subtitle]` geometry rules (see "Live-verification finding" below).
- `frontend/src/features/panels/ui/PanelList.tsx` (+ test) — grid skeleton wiring (D10/D11/D12), StatusMessage narrowing, panel-count skeleton (6.8a), D4 fix for the panel-list branch.
- `frontend/src/features/panels/ui/PanelGrid.css` — `.panel-grid-card__body-skeleton` fill rule.
- `frontend/src/features/panels/ui/PanelCard.tsx` — deletes `tableIsLoading`; passes the hook's `isLoading` for every panel kind (3.2b).
- `frontend/src/features/panels/hooks/usePanelData.ts` (+ test) — widens `isLoading` to cover the pre-dispatch frame (`paginationEntry == null`) (D13/3.2a).
- `frontend/src/features/panels/ui/PanelContent.tsx` (+ test) — loading branch renders `PanelBodySkeleton` instead of `Spinner`.
- `frontend/src/shared/ui/SuspenseFallback.tsx` (+ test) — `PanelSuspenseFallback` renders `PanelBodySkeleton` (D6); `PageSuspenseFallback` untouched.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (+ test) / `.css` — loading branch renders `PipelineDetailSkeleton`; dead `.pipeline-detail-page__loading` rule removed.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` (+ test) — preview skeleton, gated to the true initial load only (not Reload).
- `frontend/src/features/sources/ui/SourcesPage.tsx` (+ test) / `.css` — `PageContentSkeleton`, widened idle/loading gate, D4 generalization, dead `.sources-page__loading` rule removed.
- `frontend/src/features/pipelines/ui/PipelinesPage.tsx` (+ test) / `.css` — same pattern; dead `.pipelines-page__loading` rule removed.
- `frontend/src/features/dataTypes/ui/TypeRegistryPage.tsx` (+ test) / `.css` — same pattern (adds `items` to its selector); dead `.type-registry-page__loading` rule removed.
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — locks that "load more" keeps the accent spinner (6.7), not a skeleton.

## Modified: `StatusMessage` narrowing (D5)

- `frontend/src/shared/chrome/StatusMessage.tsx` (+ test) — `"loading"` removed from the `status` prop type entirely; component renders only for `"failed"`.

## Live-verification finding (fixed during this run)

While driving the running app per the ticket's "two known-fragile areas" instruction, `getBoundingClientRect()` measurement at `/registry` (the stacked sidebar row surface D9 flags as "measure first") found a real layout-shift bug in my own first-pass implementation: the two-line skeleton row measured 35px against a 43px resolved row (later regressions during the fix attempt also produced a 0-width bar and a 32px/49px mismatch before landing on the final fix). Root cause: a purely decorative `Skeleton` bar has no intrinsic content size, so nesting it inside the real `.dashboard-list__text`/`.dashboard-list__name-group` classes — which rely on real TEXT's intrinsic width/line-box to size the surrounding flex chain — collapsed that chain to 0. Fixed with dedicated, explicitly-sized wrapper classes (`.dashboard-list__skeleton-text`, `.dashboard-list__skeleton-line[--name|--subtitle]`) in `DashboardList.css`, with the two lines' heights set to their live-measured real line-box heights (no line-height-based token expresses a rendered font's line-box metrics). Re-measured live after the fix: 43px both before and after resolve.

**Cycle-2 note on this claim (evaluation-1.md CR1):** the evaluator could not reproduce "43px
both states" and measured 46px resolved (name 19px / subtitle 17px) against the skeleton's
43px, attributing the original 18px/15px measurement to the fallback font. A fresh, independent
re-measurement this cycle (Playwright/Chromium, `/registry`, dark, 1440px, confirmed via
`document.fonts.check('16px "Schibsted Grotesk"') === true` and a computed-style
`font-family` check that the real font — not a fallback — was applied) found the **original
43px/18px/15px claim was correct**; the evaluator's 46px/19px/17px numbers do not reproduce
here either. That said, the literal `18px`/`15px` values in `DashboardList.css` were still
freezing one machine's snapshot rather than tracking the font's own metrics, so they were
replaced with the CSS `1lh` unit regardless (D9-legitimate token-discipline improvement,
independent of which specific px numbers were "right"). Re-verified live post-fix: skeleton
row `43px` (name-line `1lh` = `18px`, subtitle-line `1lh` = `15px`), resolved row `43px`
(name `18px`, subtitle `15px`) — pixel-exact in both states, both before and after this fix.

## Cycle 2 — evaluation-1.md change requests

- `frontend/src/features/dashboards/ui/DashboardList.css` — CR1: `.dashboard-list__skeleton-line--name`/`--subtitle` literal `18px`/`15px` heights replaced with `height: 1lh` (see note above); comment updated to explain the unit instead of a frozen measurement.
- `frontend/src/features/panels/ui/PanelList.tsx` — CR2: the panel-count skeleton (`.panel-list__count`'s `Skeleton`) resized from `width="4em" height="0.8em"` to `width="8ch" height="1lh"` so it fills the real pill's line box instead of collapsing it (live-verified pixel-identical pill rect before/after resolve — see below). CR3: added `dashboardsStatus` to the `state.dashboards` selector and a new `showBootstrapSkeleton` flag (`selectedDashboardId === null && dashboards.length === 0 && dashboardsStatus is "idle"/"loading"`) that renders the grid skeleton instead of the "No dashboards yet" CTA while the dashboards fetch is still in flight; the CTA itself is untouched and still renders once `dashboardsStatus === "succeeded"`. CR5a: extracted the duplicated `.panel-list__zoom-container` inline style object (present twice, byte-identical) into one `zoomContainerStyle` const used by both mounts.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — CR3: updated the two existing zero-dashboards tests to set `dashboards.status: "succeeded"` (now required for the CTA to render) and added two new tests locking that the CTA does NOT render — and the skeleton does — while `dashboardsStatus` is `"idle"`/`"loading"`, covering both directions of the gate.
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx` — CR5b: replaced the two inline `panel: import("../types/panel").Panel` FQNs with a top-of-file `import type { Panel } from "../types/panel";` (no `jest.mock` hoisting constraint on this file, unlike `DesktopPanelGridSkeleton.test.tsx`).
- `openspec/changes/skeleton-loaders-list-detail-panel/specs/loading-state-pattern/spec.md` — CR4: corrected the grid-skeleton requirement's "per-card geometry SHALL match exactly … in every case" to scope the exact-match guarantee to the fully-covered and fully-empty saved-layout cases, and added a new scenario documenting the partial-coverage case's accepted position/size delta beyond the covered prefix.
- `openspec/changes/skeleton-loaders-list-detail-panel/design.md` — CR4: added a "Correction" paragraph under D10 scoping its own "pixel-exact … in every case" claim the same way, with the `Skeptic Isolation Test` dev-DB measurement as the counter-example. `openspec validate skeleton-loaders-list-detail-panel --strict` re-run clean after the edit.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — non-blocking suggestion: removed the orphaned F-132 "Loading…"/`<Spinner size="xl">` comment left behind under a stale "Loading / error overlay" section header (the rule it described was deleted; `PipelinesPage.css` had already removed its equivalent).
- `frontend/src/shared/ui/PageContentSkeleton.tsx` — non-blocking suggestion: replaced the hardcoded `Skeleton variant="circle" width={64} height={64}` with the real `EmptyState`'s own `ui-empty-state__icon-wrap` wrapper class (D3 "reuse the real class" pattern) sized via CSS instead of a JS literal; this also fixes a shape mismatch the literal alone would not have — the real icon-wrap is a rounded square (`--app-radius-lg`), not a circle. `PipelineDetailSkeleton.tsx`'s `28px` circle was left untouched: unlike the icon-wrap case, no real resolved element in `PipelineDetailFooter.tsx`'s `__footer-right` row corresponds to a circular shape, so there is no grounded real-class substitution available, and guessing one risked a real layout regression for a non-blocking item.

### Live re-verification this cycle (Playwright/Chromium against ports 5960/8867, real dev-DB account)

- **CR1** — `/registry`, dark, 1440px, `document.fonts.check` confirmed Schibsted Grotesk loaded: skeleton row `43px` (name-line `18px`, subtitle-line `15px`) vs resolved row `43px` (name `18px`, subtitle `15px`). Zero shift in both states, matching the un-corrected pre-cycle claim; the evaluator's 46px/19px/17px numbers do not reproduce (flagged to the orchestrator/user — see final report).
- **CR2** — selected "Revenue by Region" (2 panels) with `/api/dashboards/*/panels` delayed 3s: skeleton pill rect `{x:1228, y:75, width:74, height:22}`; resolved pill (`"2 panels"`) rect `{x:1228, y:75, width:74, height:22}` — pixel-identical.
- **CR3** — cold reload with `/api/dashboards` delayed 2s, sampled every ~120ms: `[aria-label="Loading panels"]` (the true grid skeleton, not the ambiguous `.panel-grid-shell` class shared with the resolved grid) was present continuously from the first paint through the entire delay window; `"No dashboards yet"` and `"Select a dashboard"` never appeared in `document.body.innerText` at any sampled frame. Once the delayed fetch resolved, `dashboardsSlice`'s existing auto-select-most-recent behavior picked a dashboard and the *next*, legitimate `showPanelGridSkeleton` (panels-loading) phase took over — no blank frame and no false-empty frame anywhere in the sequence. The "genuine zero-dashboards CTA still renders once resolved" direction is covered by the two Jest tests above (this dev account has 42 dashboards, so it can't be exercised live without a second throwaway account).

## Cycle 3 — skeptic-final-1.md REFUTE (3 blockers) + user-directed comment fix

- `frontend/src/features/panels/ui/PanelList.tsx` — **Blocker 1**: hoisted the single `useContainerWidth()` measurement out of `PanelGrid`/`PanelGridSkeleton` into `PanelList` (the only consumer of both), merged with the existing wheel-zoom-gesture ref via `setZoomContainerRef`, and passed `width={gridContainerWidth}` to both children. Root cause: two independent `useContainerWidth()` calls each re-entering `panelGridConfig.initialWidth` (1280) on mount against a real ~1152px container, live-verified via rAF frame trace (settled skeleton `[264,120,450,332]`/`[732,120,450,332]`/`[264,470,450,332]`, first resolved frame `[264,120,501,332]`/`[783,120,501,332]`, easing back over ~170ms). **Second occurrence caught live during this fix**: an initial version kept two separate `<div ref={...}>` copies (one per branch) with a real gap where NEITHER existed (between the CR3 bootstrap skeleton ending and the panels-loading skeleton starting), so the wrapper unmounted/remounted as a new DOM node, orphaning `useContainerWidth`'s one-time-effect `ResizeObserver` against the now-detached old node (which reports 0 width) — caught via a temporary debug log (`gridContainerWidth` sampled `1280 → 1152 → 0`), not assumed. Fixed by making `.panel-list__zoom-container` a single, always-mounted element for `PanelList`'s whole lifetime, with only its *content* (skeleton/grid/null) varying — restored mutual exclusivity with the EmptyState ladder via an explicit `!(showPanelGridSkeleton || showBootstrapSkeleton)` sibling gate instead of ternary nesting. **Blocker 2**: extended the panel-count pill's skeleton gate from `showPanelGridSkeleton` to `showPanelGridSkeleton || showBootstrapSkeleton`, closing the "0 panels" literal that CR3's bootstrap window reopened.
- `frontend/src/features/panels/ui/PanelGrid.tsx` / `PanelGridSkeleton.tsx` — accept `width: number` as a prop instead of self-measuring via `useContainerWidth()`; dropped their own `containerRef`/ref usage on `.panel-grid-shell` (no longer needed for measurement).
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` / `PanelGridSkeleton.test.tsx` — rewritten to drive `width` directly as a prop instead of mocking `react-grid-layout`'s `useContainerWidth`; every `mockUseContainerWidth.mockReturnValue(...)` call site converted to an explicit `width={...}` prop on the render/rerender call it previously fed.
- `frontend/src/features/panels/ui/PanelList.gridWidthSharing.test.tsx` (new) — the skeptic's requested regression assertion. jsdom's static `offsetWidth` stub can't reproduce the actual pixel divergence (it's a real-browser ResizeObserver timing bug — verified live instead, see below), so this locks the fix's actual *mechanism*: `PanelGridSkeleton` and `PanelGrid` (both mocked to capture their `width` prop) receive a defined, non-zero, identical width from `PanelList`'s single measurement, never re-measuring independently.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — added two tests locking task 6.8a / CR2's panel-count-pill skeleton gate (panels-loading case and the CR3 bootstrap case); switched the two CR3 tests from `.panel-grid-shell` (ambiguous — shared with the resolved `PanelGrid`, evaluation-2.md non-blocking #5) to `[aria-label="Loading panels"]`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` / `PipelineDetailSkeleton.tsx` — **Blocker 3 (documented, not code-fixed — the skeptic offered either)**: added a `.pipeline-detail-page__river-inner--skeleton` modifier (scoped to the skeleton only, real river's `gap: 0` untouched) so the three ribbon placeholders read as distinct steps instead of fusing into one block (skeptic non-blocking note).
- `openspec/changes/skeleton-loaders-list-detail-panel/design.md` — added a D3-style "Correction (skeptic-final-1.md CR3)" addendum documenting `PipelineDetailSkeleton`'s header/footer band deltas as an accepted, bounded delta (the meta-bar's presence and the footer's schema-chip-count are both unknowable pre-fetch, the same class of problem D10 already solves for the grid — no resolver-equivalent exists for this surface, so a hand-built placeholder would be a guess, not a fix). Also corrected a citation error from cycle 2 (evaluation-2.md non-blocking #3): the 140px partial-coverage counter-example is `skeptic-output overview`, not `Skeptic Isolation Test` (which is the fully-empty case).
- `openspec/changes/skeleton-loaders-list-detail-panel/specs/loading-state-pattern/spec.md` — added a scenario carving out the same multi-band accepted-delta exception for `PipelineDetailSkeleton`, mirroring CR4's grid-geometry carve-out.
- `frontend/src/features/dashboards/ui/DashboardList.css` — **user-directed fix**: rewrote both `1lh` comment blocks, which stated the fallback-font numbers (19px/17px/46px) as the webfont numbers and blamed the superseded `18px`/`15px` literals on an unloaded webfont — backwards, and sourced from evaluation-1.md's since-retracted CR1. Three independent measurements (executor, evaluation-2.md, skeptic-final-1.md, each using a sound canvas-advance-width/`document.fonts.size` method, never `document.fonts.check` — confirmed vacuously `true` for a nonexistent font family) now agree: webfont → 18px/15px/43px, fallback → 19px/17px/46px, `1lh` matches both, and the real reason to keep it is that it holds in **both** conditions where the old literal only held in one.
- `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx` — non-blocking: `PREVIEW_SKELETON_ROWS` 5 → 10 (REST preview default row count), halving the systematic 133.4px-vs-265px under-shoot for free; still a documented, accepted delta (CSV preview requests `limit=25`, taller still).

### Live re-verification this cycle (Playwright/Chromium against ports 5960/8867, real dev-DB account, canvas-advance-width method — not `document.fonts.check`, per the user's note)

- **Blocker 1** — "Skeptic Isolation Test" dashboard (empty saved layout, 2 real panels), `/api/dashboards/*/panels` delayed, rAF-sampled every frame from before the fetch resolves through 2.5s after: settled skeleton `[264,120,450,332]`/`[732,120,450,332]`/`[264,470,450,332]`; the *very first* resolved frame is already `[264,120,450,332]`/`[732,120,450,332]` — pixel-identical, no 501px-wide intermediate frame, held stable through the full trace. Confirmed the "second occurrence" (width dropping to 0 mid-skeleton) is gone by re-running the same width-tracking probe: `1280 → 1152` once, then stable at `1152` across the whole bootstrap→panels-loading→resolved sequence. Also smoke-tested a zoom-level change (80%) post-fix: `transform: matrix(0.8,...)` applied correctly, card rects scaled as expected — the always-mounted-wrapper restructuring didn't regress D10's non-default-zoom case.
- **Blocker 2** — cold boot with both `/api/dashboards` and `/api/dashboards/*/panels` delayed 1.2s each, sampled every 100ms across the full ~3.6s sequence: the count pill never renders literal text until `t≈2578ms`, when it resolves straight to `"1 panel"`; `pillHasSkeleton: true` for every sample in between (bootstrap window AND panels-loading window), `"No dashboards yet"`/`"Select a dashboard"` absent throughout.
- Multi-dashboard smoke test (3 real dashboards, no delay): 0 console errors, pill text and card count agree on every switch.

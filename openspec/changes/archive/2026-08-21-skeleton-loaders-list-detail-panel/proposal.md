## Why

`DESIGN.md` §7 requires every data-backed view to show "the established spinner pattern or a skeleton —
never a flash of empty content." The app has neither a skeleton primitive nor a consistent treatment:
some views render a bare 15px `<p>Loading …</p>`, some a centered spinner, and the dashboard grid
renders nothing at all. HEL-539's final skeptic traced a concrete instance — retrying on `/sources`
collapses a 331px error hero to a 15px text line and back — and deferred the fix here.

## What Changes

- Add a shared `Skeleton` primitive (`frontend/src/shared/ui/Skeleton.tsx`) with `block`/`line`/`circle`
  variants, a token-driven shimmer, and a genuine reduced-motion opt-out. Export via `shared/ui/index.ts`.
- Add one shimmer-duration token to `theme.css` — the existing `--app-transition` (0.16s) and
  `--transition-slow` (0.28s) are hover/entrance durations; a 0.28s infinite loop is unusable as a shimmer.
- Apply shape-matched skeletons on **initial** load to `PanelList` (panel-card placeholders in place of
  `PanelGrid`), `SidebarItemList`, `DashboardList`, `PipelineDetailPage`, `SourceDetailPanel`'s preview,
  `PanelContent`, and the three page shells carrying the deferred defect (`SourcesPage`, `PipelinesPage`,
  `TypeRegistryPage`).
- Gate every list skeleton on `status === "loading" && items.length === 0` so a refetch keeps showing
  existing content instead of flashing back to placeholders.
- Remove `StatusMessage`'s loading branch and narrow its `status` prop so `"loading"` is no longer
  assignable — a compile error rather than a silently blank list.
- Keep the accent border-spinner for short in-place work: pagination "load more", the route-level
  `Suspense` fallback, `SourceDetailPanel`'s button label, and the chat in-flight indicators. Move
  `PanelSuspenseFallback` to the panel skeleton, so a chunk-load and a data-load stay indistinguishable
  inside the same panel card (the invariant `SuspenseFallback.tsx` already documents).

## Capabilities

### New Capabilities
- `shared-skeleton`: the `Skeleton` primitive — variants, token-only styling, reduced-motion, a11y.
- `loading-state-pattern`: which surfaces render a skeleton, the no-layout-shift and initial-load-only
  rules, and the skeleton-vs-spinner division.

### Modified Capabilities
- `shared-status-message`: the component no longer renders a loading state; its consumers render
  skeletons instead, and `"loading"` is removed from its `status` prop type.
- `frontend-code-splitting`: the panel-level `Suspense` fallback is re-stated as "the shared loading
  pattern" rather than specifically a `Spinner`, so it can track `PanelContent`'s treatment.

## Non-goals

Error states (HEL-539, shipped), empty-state CTAs (HEL-548), toast policy (HEL-535), the unbound-panel
placeholder lines in `TextRenderer` (a "not configured" state, not a load), `PageSuspenseFallback`, the
four empty `aria-busy` divs on the proposal/patch-set review pages (each classed, none with matching CSS), and any backend change.

## Impact

Frontend only. New: `Skeleton.tsx`/`.css`/tests. Modified: `StatusMessage`, `SidebarItemList`,
`DashboardList`, `PanelList`, `PanelContent`, `PipelineDetailPage`, `SourceDetailPanel`, `SourcesPage`,
`PipelinesPage`, `TypeRegistryPage`, `SidebarBody`, `SuspenseFallback`, `theme.css`.

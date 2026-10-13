## Why

HEL-1399's lane left five follow-ups: a test that still logs 2 AggregateErrors from an unmocked network call,
comment and spec pointers to files and lines that moved, a `TableRenderer.tsx` far over the CONTRIBUTING.md size
budget (903 lines now; ~250 soft, ~400 split threshold), a Controls section in output-panel edit mode that sits
below the fold with no scroll hint, and 5 throwaway users left in the shared dev DB.

## What Changes

- Mock `getFilterCapabilities` in `PanelDetailModal.chartTypeDefault.test.tsx` (test-only).
- Fix stale path/line pointers in comments (`PanelCard.filterEmptyState.test.tsx`, `TableRenderer.test.tsx`,
  `PanelContent.test.tsx`, `renderers/ChartRenderer.tsx`, `PanelContent.css`) and in the `Source Locations` reference
  table of `openspec/specs/write-path-audit/spec.md` (7 dead paths, not only the one the ticket names). Comment and
  reference-table text only.
- Split `renderers/TableRenderer.tsx` into focused modules, behaviour-preserving (HEL-1365/HEL-1399 precedent).
- Make off-screen content in the panel edit form discoverable (owner ruling `scroll-hint`, 2026-10-13): add a vertical
  axis to the shared `useScrollEdges` primitive and show top/bottom scroll-fades on the edit form.
- Delete the 5 HEL-1399 throwaway users from the dev DB by exact (id, email).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `panel-detail-modal`: ADDED requirement — the edit form signals content beyond its visible area (scroll-fades).

The write-path-audit edit touches only its non-normative `Source Locations` reference table (no requirement change).

## Impact

- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` plus new sibling modules; no export or prop change.
- `frontend/src/shared/ui/useScrollEdges.ts` (additive fields), `detailModal/` edit form + CSS,
  `theme/elevationTokenGuard.css.test.ts`, DESIGN.md's scroll-fade sentence; one test file for the mock.
- No backend, API, schema or migration change. Dev DB only; no prod data.

## Non-goals

- Any behaviour change inside the TableRenderer split; bugs found become follow-ups.
- The 2 pre-existing `act()` warnings from `OutputPanelContent`'s `useOutputMeta` (optional in the skeptic's note).
- HEL-1440 item 3 (`pipeline_run_rate_window` user FK cascade) — the cleanup helper already handles it.
- Files touched by the open merge-train PRs (#986 #996 #991 #990 #999 #998 #994 #1000 #1001).

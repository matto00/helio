## Why

HEL-1413 fixed a live-resize e2e flake by waiting on RGL's reported processed width (`--panel-grid-processed-width`)
instead of the CSS box width, but the wait lives as two inline copies (hel1023, hel1392-remount-request-burst) and no
audit of the other live-resize specs was done. `DesktopPanelGrid.tsx` has grown to 436 lines (over CONTRIBUTING's
~400-line split threshold) after HEL-1457 added layout-version handling.

## What Changes

- Add a shared e2e helper in `e2e/support/` that waits for the desktop grid to have processed a viewport width (or
  for the phone stack to replace it below 768px), and migrate every live-resize-then-measure spec to it.
- Record an audit of all `setViewportSize` sites in `e2e/`, with a grep proof of no remaining inline/CSS-box gates.
- Split `DesktopPanelGrid.tsx` into the component plus focused hooks, behaviour-preserving.
- Correct two wording nits in the archived HEL-1413 `evidence.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — test-infrastructure and behaviour-preserving refactor only (`skip_specs: true`).

## Impact

- `e2e/support/` (new helper), `e2e/hel1023-*.spec.ts`, `e2e/hel1392-remount-request-burst.spec.ts`, plus any spec the
  audit classifies as live-resize-then-measure.
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` and new hook files beside it / in `panels/hooks/`.
- `openspec/changes/archive/2026-10-08-fix-breakpoint-layout-e2e-flake/evidence.md` (wording only).

## Non-goals

- No change to `useLayoutSave.ts`, `dashboardsSlice`, or any layout-save/version logic (I1, rebase-on-409).
- No product behaviour change; `--panel-grid-processed-width` stays observability-only.
- No backend changes, no backend test infrastructure (HEL-1544 is in another lane).
- Replacing fixed `waitForTimeout` sleeps that do not gate on RGL width (pre-load viewports, phone stack only).

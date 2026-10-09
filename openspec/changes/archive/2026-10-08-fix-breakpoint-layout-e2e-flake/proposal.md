## Why

`e2e/hel1023-breakpoint-layout-derivation.spec.ts` "C_lg_coords_everywhere" fails intermittently on main and on PRs (main CI run 37850786693 on ce08a75a1; 2/3 on one HEL-1299 PR head), redding `ci-complete` on unrelated merges. The failing read is `P8 Divider right` at window 1500 (md): received 1876, exactly the lg container's right edge, while the `.panel-grid` CSS box already read 1212. P8 is merely the first item the assertion loop checks (DOM order P8..P1), so this shows at least one item at lg geometry, not a divider-specific defect. The CSS box follows the viewport immediately, but RGL's own width arrives later via ResizeObserver → requestAnimationFrame → setState. So either the test measures before RGL has received the new width (a measurement race, e.g. frame starvation on a loaded runner), or RGL had the md width and still rendered an item at lg geometry (a product bug). Which one is unknown and must be probe-confirmed before any fix.

## What Changes

- Reproduce the failure locally at a measured rate under capped contention.
- Probe-confirm the root cause (product vs. test), refuting the other candidates with evidence.
- Fix at the root cause:
  - **Product bug** → fix the grid render path in `frontend/src/` so every item re-lays out at the new breakpoint, plus a regression guard (unit or e2e) that fails with the fix reverted; add a spec delta to `breakpoint-layout-resolution`.
  - **Test race** → make `settledRects` wait on a condition causally tied to RGL having processed the resize: reuse/extend `e2e/support/settleTransitions.ts` (frame + CSS-transition wait), or add a scoped product observability attribute (grid breakpoint/width) with a unit test. NOT a sleep/retry, NOT a tuned settle window, and NOT a looser tolerance.
- Red→green evidence sized from the measured failure rate.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `breakpoint-layout-resolution`: ONLY if the root cause is a product bug — a scenario stating that a live viewport resize across a breakpoint lays out every item (including divider panels) at the new breakpoint's geometry. If the root cause is test-only there is no requirement change and the change keeps `skip_specs: true`.

## Impact

- `e2e/hel1023-breakpoint-layout-derivation.spec.ts` (test-side fix, or unchanged if product-side).
- `e2e/support/settleTransitions.ts` is reused unchanged.
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx`: observability only (CSS custom property `--panel-grid-processed-width` fed by RGL's `onWidthChange`), with `DesktopPanelGrid.processedWidth.test.tsx`. No layout or behavior change.
- No backend, schema, API, or CI-workflow change (`.github/workflows/ci.yml` is owned by the HEL-1299 lane and is out of bounds).

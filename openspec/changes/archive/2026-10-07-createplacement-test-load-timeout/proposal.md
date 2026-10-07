## Why

`PipelineDetailPage.createPlacement.test.tsx` (HEL-1345) times out at jest's default 5 s on its case (b) ("an immediate insert at gap %i ...") when the machine is under CPU load (observed with `sbt testFull` in parallel, HEL-1277 eval-3). A gate that fails on load rather than on a defect erodes trust in the frontend suite and burns delivery cycles on re-runs.

## What Changes

- Root-cause the timeout with a measured probe (per `.concertino/laws/systematic-debugging.md`): classify it as a fixed wait, an unresolved/never-settling promise, fake-timer interplay, genuinely long render work, or another cause the probe establishes (including the real XHR requests the failing log shows escaping the mocks).
- Fix the confirmed cause, test-side. Raise the per-test timeout only if the probe shows the case is legitimately long, with the measured reason stated in a comment.
- Record before/after under-load failure rates with 20+ runs under `nice` plus background CPU load.
- Record whether PanelCard.test.tsx (HEL-1215) shares the cause (note only; not fixed here).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change; no product behaviour changes (`skip_specs: true`).

## Impact

- `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx` (primary).
- Possibly shared test helpers under `frontend/src/test/` or sibling `PipelineDetailPage.*.test.tsx` files only if the probe proves the same cause there and the change is purely test-side.
- No product code, no `usePipelineDetailPage` behaviour change (HEL-1354 is concurrently editing the page).

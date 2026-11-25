## Why

The multi-pipeline denial toast (HEL-1172) lists denied pipelines in pipeline-id order, which is a random UUID order to a user; on phone width its first row sits visibly below the warning icon; and a list long enough to scroll gives no sign that more rows are hidden below. HEL-1844 filed the ordering item again independently.

## What Changes

- The toast's rows are ordered by pipeline name (a fixed English, numeric-aware collation), with pipeline id as the tie-break. The toast `message` (coalescing key and live-region text) is built in the same order, so the announcement matches the visible rows and a burst of writes with the same verdict still yields a byte-identical message that coalesces into one toast.
- The e2e keyboard-order test expects name order (HEL-1844).
- At phone width (<=768px / coarse pointer) the first row's link lines up with the variant icon the same way a single-message toast's text does, by offsetting the icon in a multi-row toast (on desktop the same rule removes the smaller ~4px offset the list's `--space-1` padding causes), without clipping the touch expanders the scroll list pads for.
- A scrolling row list shows a bottom-edge fade, painted with the toast surface token so it reads in both themes, while more rows remain below; a list that fits shows no fade, and the fade goes away once scrolled to the end.

## Capabilities

### New Capabilities

### Modified Capabilities
- `run-to-update-affordance`: the multi-denial toast requirement gains row order (name, then id), first-row alignment with the icon, and an overflow cue.

## Impact

- `frontend/src/features/pipelines/services/deniedPipelinesToast.ts` (row order), its unit test.
- `frontend/src/shared/ui/Toast.tsx`, `frontend/src/shared/ui/ToastRowList.tsx` (reusing `useScrollEdges`), `frontend/src/shared/ui/toast.css` (alignment, overflow cue), their tests.
- `e2e/hel1172-multi-denial-toast.spec.ts` (name-order Tab order; alignment and overflow-cue checks).
- No backend, API, schema or migration change.

## Why

HEL-1352's delivery left four small defects in the per-Output History view (HEL-1277): screen-reader users cannot tell same-minute runs apart while scrubbing, keyboard users lose their place when the view closes, a code comment cites a path that no longer exists, and one "vs" label rendering has no same-second test.

## What Changes

- The History scrubber's accessible value text for each point is disambiguated from its adjacent points using the same minute -> second -> millisecond escalation `formatCapturePair` introduced (one shared helper, not a second implementation).
- Closing the History view (Escape, Close button, backdrop) returns focus to the invoking History button. Probe-confirmed root cause expected in the shared `Modal` primitive: it restores focus only on an `open` true->false transition, never when it is unmounted while open, which is how `PipelineDetailPage` closes `OutputHistoryModal`.
- `OutputGalleryCard.css`'s hover comment is repointed to `openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json`.
- A dedicated test for the metric-baseline "vs <time>: <baseline>" text with a same-second pair.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-scrubber`: scrubber point names must be distinct from adjacent points; closing the view returns focus to the invoking History action.

## Impact

- `frontend/src/features/panels/history/formatCaptureTime.ts` (+ test)
- `frontend/src/features/pipelines/ui/outputHistory/HistoryScrubber.tsx`, `OutputHistoryModal.test.tsx`
- `frontend/src/shared/ui/Modal.tsx` (+ `Modal.test.tsx`) — shared primitive; every conditionally-mounted Modal consumer gains focus restoration on unmount
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css` (comment only)
- No backend, API, schema, or migration change.

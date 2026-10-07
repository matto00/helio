## Why

HEL-1277 shipped the per-Output History view with four rough edges found at its final gate: the card's History button drifts from DESIGN.md §5's Ghost recipe, an unchanged pair of points gives no positive confirmation that nothing changed, the rows table's fixed 360px height strands the comparison note far below a short table, and two points captured in the same second still render identical "vs …" labels, so the user cannot tell which point is which.

## What Changes

- The Output card's History button follows DESIGN.md §5's button recipe: `--app-radius-sm` and `--weight-medium` (it currently uses `--app-radius-md` and inherited weight 400). Its hover stays `--app-surface-raised`, not Ghost's `--app-surface-soft`, because the parent card hovers to `--app-surface-soft` and that hover would be invisible (design D1).
- When both payloads are loaded and the whole-row diff finds no new-or-changed row and no row no longer present, the view states "No row changes vs <time>".
- The rows table container is sized to its content up to the existing 360px cap (instead of a fixed 360px), so the comparison note sits directly under a short table; a long table still scrolls inside the cap.
- Capture-time labels for a selected point and its comparison point are always distinguishable: precision escalates minute → second → millisecond, and if the two instants are still identical the comparison label is suffixed "(older capture)". Applies to the selected point's header, the summary "vs" caption, the metric "vs" baseline, the chart overlay's "vs" legend label and the rows comparison notes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-scrubber`: the comparison label requirement gains a distinguishability guarantee for same-second (and identical) capture times; the changed-rows requirement gains the "No row changes" note.

## Impact

Frontend only: `frontend/src/features/pipelines/ui/OutputGalleryCard.css`, `frontend/src/features/pipelines/ui/outputHistory/{HistoryRows,HistorySummary,HistoryChart}.tsx`, `OutputHistoryModal.css`, `frontend/src/features/panels/history/formatCaptureTime.ts` (plus tests). No API, schema or backend change.

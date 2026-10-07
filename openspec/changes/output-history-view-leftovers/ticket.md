# HEL-1359: Output History view: scrubber names, focus return on Escape, stale comment path

## Description

Leftovers found while delivering HEL-1352 (PR matto00/helio#816, 5f3990f8e):

1. **Scrubber names:** the scrubber's accessible names use minute precision only, so two points captured in the same minute get the same name. Reuse the `formatCapturePair` precision escalation that matto00/helio#816 added.
2. **Focus on Escape:** closing the History view with Escape returns focus to the page body instead of the History button. This probably predates HEL-1277; check that before fixing.
3. **Stale comment path:** the hover comment in `OutputGalleryCard.css` points to the measurements file at its pre-archive path. It now lives at `openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json`.
4. **Missing test:** the metric-baseline "vs" label has no dedicated test for two captures in the same second.

## Acceptance Criteria

- The scrubber's spoken value for a point never reads identically to that of an adjacent point (same-minute -> seconds, same-second -> milliseconds, identical instant -> a disambiguating suffix), reusing the HEL-1352 precision escalation rather than a second implementation.
- Closing the History view by Escape (and by the Close button) returns focus to the History button that opened it; the root cause (and whether it predates HEL-1277) is probe-confirmed and recorded.
- The `OutputGalleryCard.css` comment cites the archived measurements path, and that path exists.
- A dedicated test covers the metric-baseline "vs <time>: <baseline>" label for two captures in the same second.

## Origin

Follow-up of HEL-1352; related HEL-1277.

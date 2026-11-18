## Why

HEL-1608 made spine rows compact on narrow desktop pages, but left the step row's ⋮ menu hover/focus-only there while the source and output cards always show theirs. On a touch laptop or tablet in that width range the selected step's actions have no visible affordance, and the compact grid still spends a column gap on an empty markers slot. Its e2e spec also never proves compact mode is actually on, so a threshold regression would pass silently. Separately, a spec paragraph states the header schedule chip's breakpoints in the wrong unit.

## What Changes

- One ⋮ rule for the spine at every desktop width: **the ⋮ of a standalone item is always visible**. Source cards, Output cards and the *selected* step row always show their ⋮; an unselected step row reveals its ⋮ on hover or keyboard focus (as today above the compact threshold). Compact mode stops being an exception: its selected row's ⋮ becomes permanently visible again, placed so the title keeps its readability floor. On no-hover (touch) input, a tap where a hidden ⋮ sits selects its row instead of opening the menu, at any desktop width (today the regular hidden trigger is still hit-testable, so a touch tap on a row's right end opens the menu instead of selecting the row).
- Compact rows with no markers no longer spend a column gap on the empty markers slot; the empty markers slot leaves the flow at every desktop width (item 4's decision, below).
- The hel1608 e2e spec asserts compact mode is on at 769–1009px and off at 1100px, and gains assertions for the ⋮ rule and the marker gap.
- Item 4 decided: the 1100px title truncation is accepted after the empty-markers gap is reclaimed (measured and recorded); no step-label renaming.
- Correct the `pipeline-schedule-config-ui` "Layout scope (HEL-1579)" wording to the CSS's page-content-width thresholds (800px / 600px).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-detail-spine-layout`: the narrow-spine allowance that a row's ⋮ may be hover/focus-only becomes the single ⋮ rule (cards and the selected row always visible; unselected rows on hover/focus), plus the empty-markers slot taking no space.
- `pipeline-schedule-config-ui`: the "Layout scope (HEL-1579)" paragraph's chip breakpoints are restated as page content width (≤800px compact, below about 600px icon / "Paused" only).

## Impact

- `frontend/src/features/pipelines/ui/spine/PipelineSpine.css` (row menu + compact block), possibly `SpineStepRow.tsx` (markup only if CSS alone cannot place the menu).
- `frontend/src/features/pipelines/ui/pipelineHoverGating.css.test.ts` must stay green (the compact block is one allowlisted unit).
- `e2e/hel1608-spine-count-overlap.spec.ts` (extended); `e2e/hel1579-pipeline-spine-layout.spec.ts` re-run (its 769–1100 readability sweep).
- Spec text only for item 5. No backend, schema or API change.

## Why

HEL-1358 added a truncation footnote under chart panels. At the grid's narrowest width (w=2) and minimum height (h=4), a chart carrying both an annotation and that note reportedly leaves the chart canvas about 5px tall — the chart the note describes is effectively gone. Three smaller loose ends from the same ticket (a stale prop comment, a style-guard regex that a comment defeats, and "matching rows" wording never seen live) are bundled here.

## What Changes

- At narrow chart widths, the truncation note shows a short form ("200 of 1,234 rows." / "200 of 640 matching rows.") while the full sentence stays in the DOM for assistive technology and in the `title` tooltip.
- At narrow chart widths, the chart canvas keeps a guaranteed minimum height (96px) when footnotes are present; footnotes yield (tighter clamp) rather than the chart.
- The `truncationNote` prop comment in `ChartRenderer.tsx` describes the two-line clamp.
- The truncation-note style guard test finds a standalone `.chart-panel__truncation-note` rule wherever it sits (after a comment, at file start, after another rule), proven red against such a rule.
- A one-off live check of the "matching rows" wording in both themes, recorded as evidence (no code change).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chart-panel-truncation-notice`: the note gains a narrow-width short form, and a chart carrying footnotes keeps a minimum canvas height.

## Impact

- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`, `frontend/src/features/panels/ui/PanelContent.css`, possibly `frontend/src/features/panels/ui/chartTruncationNote.ts` (short-form text helper).
- `frontend/src/features/panels/ui/PanelContent.truncationNoteStyle.test.ts` plus unit tests for the short form.
- A Playwright e2e under `e2e/` (or, if seeding a >200-row chart there is infeasible, a recorded live measurement) proving the canvas minimum red-first.
- No backend, schema, or API change. Every chart surface (grid card, mobile stack, fullscreen, detail modal, public dashboard) renders through `ChartRenderer`, so all inherit the fix.

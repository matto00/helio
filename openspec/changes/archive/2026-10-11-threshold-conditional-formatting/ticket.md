# HEL-1307: Conditional formatting (threshold colours) for metric, collection, table

## Description

Found while designing the CI Health dashboard in helio-news: failing tests, slow jobs and low pass rates should be visibly red/amber/green. The workaround was an emoji status column computed in Python.

Evidence: `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` (metric/table/collection config types) and `frontend/src/features/panels/ui/renderers/columnFormatting.ts` carry only number formatting; a grep for threshold/rowStyle across renderers finds no conditional styling.

What: Add threshold/rule-based styling (value ranges to colour tokens) for metric values, collection items, and table cells/rows, configured on the Output and using design tokens.

## Acceptance criteria

- [ ] A metric with threshold rules renders in the matching token colour in both themes.
- [ ] Table cell and row rules apply per column/row from the Output config.
- [ ] Invalid rules are rejected at config validation; behaviour with no rules is unchanged.

## Owner rulings (2026-10-11, escalation answered via driver chat, option A on all six)

1. Rule model: an ordered list, first match wins. `gt`/`gte`/`lt`/`lte`/`between` are numeric; `eq`/`neq` also match text (e.g. `status = failed`).
2. What is coloured: metric values and collection item values get the tone text colour; a table cell gets tone text on the tone `-surface` wash; a table row rule washes the whole row.
3. Tones: three — `success`/`warning`/`error` — using the existing `--app-success`/`--app-warning`/`--app-error` tokens and their `-surface` washes. No free colours.
4. Colour is not the only signal: an optional per-rule text label (tooltip + accessible name) and a shape-distinct glyph per tone.
5. Tables: every table rule names a column; `target` is `cell` (default) or `row`; cell and row rules resolve independently, first match each.
6. Thresholds are independent of the metric delta colours (HEL-918 L5); HEL-1329 (lower-is-better deltas) stays separate.

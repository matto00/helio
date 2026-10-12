# HEL-1490: After HEL-1307: tone contrast on custom panel backgrounds; light metric unit 4.40:1; split TableRenderer/DataGrid; fold saveDisabled/saveBlocked; rules in HistoryRows

## Description

These follow-ups came from HEL-1307 (matto00/helio#938, bcb0e8919), which added `conditionalFormats` to metric, collection and table Outputs.

1. Tone text on a panel with a custom background colour isn't contrast-checked. The existing delta colours have the same gap. Decide whether to fall back to a contrast-safe tone, or warn in the editor.
2. The light-theme metric unit measures 4.40:1, below 4.5:1. This predates HEL-1307 and was a skeptic finding.
3. `TableRenderer.tsx` (900 lines) and `DataGrid.tsx` (1295) are over the ~400-line guideline. HEL-1307's PR proposes a split. Do it behaviour-preserving, to the HEL-1465 proof standard.
4. `OutputEditorFooter` has two "save blocked" props doing the same job, `saveDisabled` (HEL-1307) and `saveBlocked` (HEL-1311). Fold them into one.
5. Apply conditional-format rules in the Output history rows view (`HistoryRows`). This is a product call: should history be coloured by current rules?
6. A shared Select marked `aria-invalid` shows no visual invalid state.

Planner defaults HEL-1307 chose without an owner ruling, for owner review: at most 20 rules; label 1-60 characters, text value 1-200 characters; fallback names Good/Warning/Critical; no rules in history rows; no write-time check that a rule's column exists.

## Scope of this run (driver decision, 2026-10-11)

- IN: items 5, 2, 4, 6.
- Item 5 owner ruling (relayed by the driver): apply conditional-format rules in `HistoryRows` too, reusing the existing raw-value rule evaluation, with the same tones, glyphs and accessible labels as the main renderers.
- Item 1: raised as a non-blocking owner escalation (`runtime-fallback | editor-warning | both | leave-on-ticket`); included only if answered in time, else stays on the ticket.
- Item 3: OUT (separate behaviour-preserving refactor, stays on the ticket).
- Owner kept the other planner defaults (20 rules, label lengths, Good/Warning/Critical, no column-exists check).

## Acceptance Criteria

- AC5: In the Output history modal's stored-rows table, a table Output's current `conditionalFormats` rules colour cells/rows exactly as the dashboard table does (same raw-value evaluation, tone classes, glyph and accessible text/tooltip), composed with the existing changed-row highlight so both stay visible (the "Change" cell of a changed row keeps its accent tint and text; data cells show the rule wash); a collection Output's rules apply to its value column's cells. An Output with no rules renders history rows exactly as before.
- AC2: The metric unit AND the metric label (`.panel-content__metric-label`, same 60% currentColor mix, same 4.40:1 failure; design-gate round 1 finding) each measure >= 4.5:1 against the default panel surface in the light theme (and stays >= 4.5:1 in dark), measured in the running app, using tokens only; a custom panel text colour is still honoured.
- AC4: `OutputEditorFooter` exposes a single prop for "Save is blocked"; every former trigger (invalid rules, histogram bin-count draft, reference-mark draft) still disables Save.
- AC6: A shared `Select` whose trigger has `aria-invalid="true"` shows the same invalid visual state as `.ui-input` (error border; error halo when focused) in both themes.

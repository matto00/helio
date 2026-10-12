## Why

HEL-1307 shipped conditional formatting with four small follow-ups that are now owner-scoped (HEL-1490): the history rows
view ignores the rules (owner ruled they should apply), the light metric unit fails WCAG AA text contrast (4.40:1),
the Output editor footer carries two props for one "Save blocked" concept, and the shared Select gives no visual
signal when marked invalid (a WCAG 1.4.1/3.3.1 gap: invalid state conveyed only to assistive tech).

## What Changes

- Output history stored-rows table applies the Output's current conditional-format rules (table rules as on the
  dashboard; collection rules on the collection's value column), reusing the existing raw-value evaluation, tone
  classes, glyphs and accessible names.
- Metric unit and metric label colour (both share the same 60% currentColor mix and the same 4.40:1 light failure) raised to >= 4.5:1 via one theme token, still relative to the panel text colour.
- `OutputEditorFooter`'s `saveDisabled` and `saveBlocked` props fold into one prop (internal API only).
- Shared `Select` trigger with `aria-invalid="true"` gets the same error border / focused error halo as `.ui-input`.
- Out of scope: item 1 (custom-background tone contrast; owner escalation pending), item 3 (TableRenderer/DataGrid split).

## Capabilities

### New Capabilities
- `shared-select-invalid-state`: visual invalid state of the shared Select trigger.

### Modified Capabilities
- `output-conditional-formatting`: rules now also apply in the Output history stored-rows view.

## Impact

Frontend only: `features/pipelines/ui/outputHistory/HistoryRows.tsx` (+ `OutputHistoryModal.tsx` to pass config),
`features/panels/ui/PanelContent.css` + `theme/theme.css` (unit token), `features/pipelines/ui/outputEditor/
OutputEditorFooter.tsx` + `OutputEditorSheet.tsx`, `shared/ui/inputs.css` (Select invalid). No API, schema or backend change.

## Why

HEL-1083 made a `form` panel creatable via the API, but nobody can author one: the panel sheet shows an empty
editor body for a `form` panel, the add-panel picker has no Form entry, and nothing checks that a form's fields
exist in the bound dataset's declared schema — a mismatch would surface only when HEL-1087's submit fails. This
change builds the field-type builder and makes that mismatch an author-time answer.

## What Changes

- A **form builder** in the panel sheet: bind a `dataset` source, add/remove/reorder fields, and per field choose
  the dataset's declared field (offered, never free-typed), a fitting control, label, placeholder, help text,
  required (tighten-only), initial value, `step` (number only), and `options` (select only).
- **Author-time consistency**: the builder diffs the config against the live declared schema on open, on
  dataset switch, and on every edit, surfacing each mismatch as a field-associated error; the write API
  (`POST/PATCH /api/panels`) rejects an inconsistent form config with a 400 naming the offending field.
- The add-panel picker gains a **Form** entry that binds a dataset at creation; `createPanel` learns to carry
  `config`.
- **Tightened contract** for `select` options: an authored shape (non-empty JSON array whose values satisfy the
  field's declared type) replaces "present", and `initialValue` must satisfy the declared type.
- A form bound to a non-`dataset` source is rejected (HEL-1083 D6 checked existence/ownership, not kind).

## Capabilities

### New Capabilities
- `form-panel-builder`: the authoring surface — picker entry with dataset binding, the field builder, what it
  offers, what it surfaces, and its keyboard/screen-reader behaviour.

### Modified Capabilities
- `form-panel-type`: "validated at create and patch time" gains consistency with the bound dataset's declared
  schema (field existence, control-to-type fitness, option/initial values, `dataset`-kind binding); the
  `select`/`options` scenario tightens; "structural only" no longer holds.
- `output-picker`: the content-panel row enumerates `text, markdown, image, divider`; a Form entry joins it and,
  unlike the others, binds a dataset before creating.
- `panel-detail-modal`: "content-kind panels (text, markdown, image, divider) render a kind-specific section";
  a `form` panel now renders the builder as its kind-specific section instead of an empty body.

## Impact

Backend: `domain/panels/FormPanel.scala` (control-fitness matrix, options shape), new
`domain/panels/FormSchemaConsistency.scala`, `services/panels/PanelService.scala` (create + patch hook, effective
config after patch), `DatasetRowValidator` reused read-only. Contracts: `schemas/panels/panel.schema.json`
`$defs.FormFieldConfig.options`, `openspec/specs/form-panel-type`. Frontend: new `ui/editors/FormEditor*.tsx`,
`state/formConfigValidation.ts` (mirrors the Scala matrix, drift-guarded), `ui/OutputPicker.tsx` (Form entry +
dataset step), `services/panelService.ts` + `state/panelThunks.ts` (`config` on create, `updatePanelForm`),
`ui/detailModal/PanelDetailModal.tsx` (two if-chain arms), `types/panel.ts` (`options` narrowed). Tests on both
sides; UI a11y asserted by computed accessible name.

## Non-goals

No on-panel rendering (HEL-1085), file upload (HEL-1086), submit path (HEL-1087), counter chrome (HEL-1088/89),
or assembled-panel audit (HEL-1090). No migration, no new table, no agent prompt copy. `PanelContent`'s D10
placeholder stays. Dataset schema editing stays on the Sources page (HEL-1124) — the builder links to it.

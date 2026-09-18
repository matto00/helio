## Context

See proposal.md — Why; every file:line here was re-verified at Setup
(`.concertino/runs/HEL-1084/evidence/premise-validation.md`). The authoring seams exist and are empty:
`PanelDetailModal.tsx` dispatches a kind-specific editor through two if-chains (`activeEditorRef` :192-198,
`renderSubtypeEditor` :312-346) that HEL-1083 design.md deferred to this ticket, both `return null` for `form`;
each editor implements `PanelEditorHandle` (`editors/editorTypes.ts`: `reset`/`save`/dirty callback) and saves
through a kind-specific thunk (`panelThunks.ts` `updatePanelDivider` → `panelService.ts` PATCH `{config}`).
`OutputPicker.tsx` lists four content kinds in `CONTENT_PANEL_KINDS` and creates via `createPanel`, whose
service/thunk/`buildCreatePanelBody` (`panelPayloads.ts:36`) carry no `config`; HEL-1083 D5 rejects an empty
`dataSourceId`, so no UI path can create a `form` panel today. The dataset's declared schema is
`GET /api/data-sources/:id/schema` (`dataSourceService.fetchDatasetSchema`) →
`{fields:[{name,type,required,default?}]}`; on the backend `DataSourceRepository.getDeclaredSchema(id, user)`
(`:875`) and `DatasetRowValidator.validateValue(fieldType, value)` (`:62`) already exist.
`PanelService.buildForCreate` (`:183`) and `update` (`:437`) already gate on `rejectMissingDataSource` (HEL-1083
D6: existence/ownership only, not kind). `FormPanel.validateConfig` is structural only and states that schema
consistency is this ticket's. HEL-1083's constraints C8 (never silently drop), C9 (record deferrals in an
artifact), C10 (if-chains are not typecheck-protected) bind here too.

## Goals / Non-Goals

**Goals:** a builder that can only author what the dataset declares; the same consistency rule enforced at the
write API so the agent path (HEL-1083 D7) gets the same author-time answer; a UI path to create a `form` panel;
keyboard/screen-reader completeness for every new control.

**Non-Goals:** rendering (HEL-1085), file upload (HEL-1086), submit (HEL-1087), counter (HEL-1088/89), assembled
audit (HEL-1090), dataset schema editing (HEL-1124's Sources page — the builder links there), drag-and-drop
reordering, `{value,label}` option objects, agent prompt copy, any migration.

## Decisions

**D1 — One consistency rule, enforced at the write API and mirrored in the builder.** New
`domain/panels/FormSchemaConsistency.check(config, declaration): Either[String, Unit]`, called from
`PanelService.buildForCreate` after `validateConfig`, and from `update` on the EFFECTIVE post-patch config
(`existing` as `FormPanel` `applyPatch`ed with the decoded form patch) whenever the patch carries a form config
— not on the incoming patch alone, or a `dataSourceId`-only PATCH would skip re-validating the existing fields.
Rules, each a 400 whose message names the field: (a) the bound source is `dataset`-kind (via `findByIdOwned`
returning `DatasetSource`; closes D6's kind gap — a `csv`-bound form is accepted today); (b) every `sourceField`
is a declared field name; (c) the control fits the declared type (D2); (d) `options`, when present, is a
non-empty JSON array whose every value passes `validateValue` for the declared type (D3); (e) a non-null
`initialValue` passes `validateValue`. Mirrors D6's nullable-`dataSourceRepo` test wiring (skip when `null`;
`ApiRoutes` wires the real repo since HEL-1083). Rejected: frontend-only (agents persist inconsistent configs
silently; HEL-1087's own words: "client validation is convenience, not enforcement"); submit-time only (the AC's
named failure mode).

**D2 — Control-to-type fitness matrix in Scala, drift-guarded in TypeScript.**
`FormFieldSpec.FittingControls: Map[DataFieldType, Vector[String]]` (first entry = the builder's default):
`string → text, textarea, select`; `string-body → textarea, text, select`; `integer|float → number, select,
text`; `boolean → checkbox, select`; `timestamp → date, text, select`; `binary-ref → file`. Per cell: `file`
only where HEL-1086 writes a `binary-ref`; `checkbox` only boolean; `number` only numeric; `date` only
timestamp; `textarea` only string-ish; `text` allowed where typed entry is coerced at submit (HEL-1087 validates
against the declared type) but not for boolean/binary-ref; `select` everywhere but binary-ref (D3 types the
option values). `state/formConfigValidation.ts` mirrors it as `CONTROL_FITNESS`; a Jest guard parses
`FormPanel.scala` (precedent `canonicalFieldTypesDriftGuard.test.ts`) so drift fails loudly. Rejected: matrix in
TS only (the API would accept what the UI forbids — C8 family); a JSON file both sides read (no shared runtime).

**D3 — `options` authored shape: a non-empty array of TYPED values.** An integer field's select carries
`[1, 2, 3]`, a string field's `["a","b"]`; the value is the label. The wire type stays `JsValue`/`unknown`
(HEL-1083); D1(d) validates the shape, the builder narrows with a type guard and renders one typed input per
option (number input for numeric, checkbox for boolean, date for timestamp, text otherwise), surfacing a
non-array or wrong-typed stored value as an author-time issue, never coercing silently. Rejected: `string[]`
(an integer field's option `"abc"` would fail only at submit — the AC's failure mode); `{value,label}` objects
(YAGNI; an additive spec change later).

**D4 — `initialValue` and `required` semantics in the builder.** `initialValue` uses the same typed input as
D3 and D1(e) validates it. The `Required` toggle: when the declared field is `required: true` it renders
checked and disabled with hint "Required by the dataset" and the config OMITS `required` (inherit — never writes
`required: false`, which HEL-1083 rejects); otherwise checked ⇒ `required: true`, unchecked ⇒ key absent.
`step` is shown only for `control: number`; `options` only for `select`; switching control away drops the
now-invalid attribute visibly (a hint names what was cleared) rather than persisting a 400.

**D5 — The builder is a `PanelEditorHandle` editor, split to CONTRIBUTING's budgets.** `ui/editors/FormEditor.tsx`
(container: dataset `Select`, schema fetch state, field list, issue summary, save), `FormFieldRow.tsx` (one
field), `FormOptionsEditor.tsx` (D3 rows), `useFormEditorState.ts` (reducer: add/remove/move/edit/dirty),
`state/formConfigValidation.ts` (pure: issues + matrix + typed-value parsing), `FormEditor.css`. Mounted from
both `PanelDetailModal` if-chains with a new `formEditorRef` (C10: enumerated by hand). Save →
`updatePanelForm({panelId, config})` thunk → `panelService.updatePanelForm` PATCH `{config}` carrying all three
keys (HEL-1083 `Patch` replaces per key; MISTAKES.md "PATCH is a replace"). Datasets come from
`sourcesSlice.items` filtered `type === "dataset"` (dispatch `fetchSources` when `idle`); the schema is fetched on
mount and on every dataset switch (Skeleton while loading, `InlineError` + retry on failure). Switching dataset
KEEPS the fields and re-validates — orphaned fields are flagged with a Remove affordance, never dropped (C8).
Save is disabled while any blocking issue exists, with a `role="alert"` summary; a backend 400 (schema changed
between fetch and save) renders inline and triggers a re-fetch.

**D6 — Picker: a Form card that binds a dataset before creating.** `OutputPicker` adds a fifth content card
"Form"; activating it switches the modal into a "Choose a dataset" step (same listbox/card pattern and arrow-key
nav, the search box filters datasets, a Back control returns) listing `dataset`-kind sources; an `EmptyState`
with CTA "New dataset" → `/sources` when none exist. Choosing one dispatches `createPanel` with `type: "form"`,
`title` = dataset name, and `config: {dataSourceId, fields: [], submit: {writeMode: "append"}}`; `createPanel`
service/thunk and `buildCreatePanelBody`/`seedCreateConfig` gain an optional `config` override used only by
`form`. No auto-open of the sheet (matches the four content kinds; the D10 placeholder is one click away).
Rejected: create-then-bind (impossible under HEL-1083 D5); a second toolbar entry point (breaks the
`output-picker` one-modal contract).

**D7 — Accessibility by construction (DESIGN.md §8).** Native controls via shared `TextField`/`Select`/`Toggle`/
`IconButton`/`FormField`; reorder via "Move up"/"Move down" `IconButton`s whose `aria-label` includes the field
name; Add/Remove named the same way; per-field issues through `FormField`'s `error` (`role="alert"`) plus
`aria-invalid`/`aria-describedby` on the control; focus moves to the new row's field select after Add and to the
next row (or the Add button) after Remove. Tests assert `toHaveAccessibleName`, never element presence.

**D8 — Explicitly out-of-scope enumerations (C9).** `PanelContent.tsx` D10 placeholder copy — unchanged
(HEL-1085). `PanelPacker.Bounds` — still deferred to HEL-1085. `RefinementEditShape` prompt copy — unchanged.
`helio-mcp` `update_panel` already spans every kind, so an MCP form-config PATCH now receives D1's 400s — the
intended agent-path behaviour, no MCP change. Dashboard IMPORT (`DashboardSnapshotRepository`) reconstructs
panels without service checks (same as D6 today) — an imported form keeps its config and the builder surfaces
mismatches on open; recorded, not fixed. A HEL-1124 schema edit that orphans a form field is likewise surfaced
on next open — no cross-resource cascade.

## Risks / Trade-offs

- [Matrix cells are judgment calls] → each cell justified in D2, mirrored into the spec as normative text,
  drift-guarded; a cell change is a spec change, not a silent edit.
- [Structural rules duplicated in TS] → the frontend is UX only, the backend is enforcement; both pinned by tests;
  the matrix (the only table) has a mechanical guard.
- [Schema changes between fetch and save] → backend 400 shown inline, schema re-fetched; never a silent save.
- [`update` check runs on the effective config] → a pinned test: `dataSourceId`-only PATCH onto a dataset lacking
  an existing field returns 400.
- [Picker two-step adds state to an already 300-line component] → the dataset step is its own component
  (`DatasetStep.tsx`) fed by the same listbox helpers; CONTRIBUTING's ~400-line split rule is respected.
- [Every worktree shares one Postgres] → no migration here; backend tests run on EmbeddedPostgres.

## Migration Plan

No schema change. Deploy with the PR; rollback is a revert. Existing (API-created) form panels whose config is
inconsistent stay readable (HEL-1083 D9 tolerant read) and become PATCH-blocked until fixed in the builder.

## Planner Notes

Self-approved: the D2 matrix and its default-control ordering; typed-value `options` (D3); the picker's two-step
Form flow, the panel title defaulting to the dataset name, and no auto-open (D6); keyboard-only reordering with
no drag-and-drop (D7); the message wording in D1 is pinned by tests, not by the spec.

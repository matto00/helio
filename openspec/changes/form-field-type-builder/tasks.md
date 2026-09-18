## 1. Backend — domain and service

- [x] 1.1 Add `FormFieldSpec.FittingControls: Map[DataFieldType, Vector[String]]` (design D2, default control first) and `defaultControlFor`; verify `FormPanelSpec` asserts every `DataFieldType` has a non-empty entry and `binary-ref` maps to `file` only
- [x] 1.2 Add `domain/panels/FormSchemaConsistency.scala` with `check(config, declaration): Either[String, Unit]` implementing D1 (b)–(e) — undeclared `sourceField`, unfit control (message lists the fitting controls), `options` non-empty array of `DatasetRowValidator.validateValue`-valid values (message names the first offending value), non-null `initialValue` valid — with the same message the spec pins; no inline FQNs; verify `FormSchemaConsistencySpec` (task 4.1)
- [x] 1.3 `PanelService`: add `rejectInconsistentForm(config, user)` — `findByIdOwned` must yield a `DatasetSource` (400 naming the actual kind), then `getDeclaredSchema` → `FormSchemaConsistency.check` → 400; skip when `dataSourceRepo == null` (D6 parity); call it from `buildForCreate` after `validateConfig`, and from `update` on the EFFECTIVE config (`existing` FormPanel `applyPatch`ed with the decoded form patch) whenever the patch carries a form config; verify tasks 4.2/4.4
- [x] 1.4 `schemas/panels/panel.schema.json` `$defs.FormFieldConfig`: `options` becomes `type: array, minItems: 1` with a typed-values description; `initialValue` description names the declared-type rule; verify `npm run check:schemas` passes
- [x] 1.5 Confirm `helio-mcp` `update_panel`/proposal surfaces need no change (they pass `config` through and now receive D1's 400s); verify `npm run check:helio-mcp-types` passes and record the no-change in the PR body

## 2. Frontend — types, services, state

- [x] 2.1 `panelService.ts` `updatePanelForm(panelId, config)` PATCH `{config}` carrying all three keys, plus the `updatePanelForm` thunk in `panelThunks.ts` re-exported from `panelsSlice` like `updatePanelDivider`; verify `npm run typecheck` passes
- [x] 2.2 `createPanel` service + thunk + `panelPayloads.buildCreatePanelBody`/`seedCreateConfig`: optional `config` override used only for `form` (D6); verify existing `panelPayloads` tests still pass and a new one asserts the form body
- [x] 2.3 `state/formConfigValidation.ts`: `CONTROL_FITNESS` mirror of D2, `fittingControls`/`defaultControl`, `parseTypedValue(type, text)`, `isOptionsArray`, and `computeFormIssues(config, schema)` returning field-keyed issues (undeclared, unfit, duplicate, options missing/empty/wrong-typed, initialValue wrong-typed, step on non-number, step non-positive); verify task 4.6
- [x] 2.4 `ui/editors/useFormEditorState.ts` reducer: init from panel config; add (first unused declared field, its default control), remove, moveUp/moveDown, setSourceField, setControl (visibly drops `step`/`options` the new control rejects and records the hint), setAttr, setDataset (keeps fields), reset; dirty = deep-equal vs initial; verify task 4.7

## 3. Frontend — UI

- [x] 3.1 `ui/editors/FormEditor.tsx` (+ `FormEditor.css`, tokens only): dataset `Select` over `sourcesSlice` items filtered `type === "dataset"` (dispatch `fetchSources` when idle), schema fetch via `fetchDatasetSchema` on mount and dataset switch (Skeleton / `InlineError` + retry), field list, `role="alert"` issue summary, `PanelEditorHandle` whose `save` refuses while issues exist and, on a 400, shows it inline, re-fetches the schema, and keeps edits; verify task 4.8
- [x] 3.2 `ui/editors/FormFieldRow.tsx`: field chooser (declared minus used, type + required badge), control chooser (fitting only, default first), label/placeholder/help text, Required (D4 tighten-only rendering), typed initial value, `step` (number only), options (select only), Move up/Move down/Remove `IconButton`s with field-specific `aria-label`s, errors through `FormField` `error` plus `aria-invalid`/`aria-describedby`; verify task 4.9
- [x] 3.3 `ui/editors/FormOptionsEditor.tsx`: typed-value option rows (number/checkbox/date/text input per declared type) with add/remove; verify task 4.9
- [x] 3.4 `PanelDetailModal.tsx`: `formEditorRef` and `isFormPanel` arms in BOTH `activeEditorRef` and `renderSubtypeEditor` (C5), and correct the "Output-kind panels: no subtype editor" comment; verify task 4.11
- [x] 3.5 `OutputPicker.tsx` + new `DatasetStep.tsx`: Form content card; dataset step (listbox cards, arrow-key nav, search filters datasets, Back control, `EmptyState` CTA "New dataset" → `/sources`); choosing creates with `type: "form"`, `title` = dataset name, `config` bound (D6); absent in swap mode; verify task 4.10
- [x] 3.6 Focus management (D7): Add → new row's field chooser; Remove → next row's first control or the Add button; verify task 4.8 and note that rendered measurement is the evaluator's evidence (C6)

## 4. Tests

- [x] 4.1 `FormSchemaConsistencySpec`: one case per D1 rule and every pinned message; verify non-zero assertion count
- [x] 4.2 `FormPanelRoundTripSpec` additions (fixture dataset declares `quantity` integer required, `note` string, `when` timestamp, `flag` boolean): csv-bound → 400 naming `csv`; undeclared `legacy` → 400 naming it; `checkbox` on `note` → 400 naming fitting controls; `text` on `quantity` → 201; options `[1,"two"]` → 400 naming `"two"`; `[]` and non-array → 400; `initialValue:"soon"` on `when` → 400; PATCH re-binding `dataSourceId` only, to a dataset lacking `quantity` → 400 and `findByIdInternal` re-read shows the panel unchanged (C7); consistent config round-trips
- [x] 4.3 Extend the route-spec fixtures so a dataset source with a declared `dataset_schema` and a second dataset lacking `quantity` exist without changing any existing fixture's behaviour; verify the whole backend suite stays green
- [x] 4.4 Mutation evidence (C2): remove the `update` effective-config hook → 4.2's re-bind test goes RED while the create tests stay GREEN (state why); restore, re-run green; record the transcript in `mutation-evidence.md`
- [x] 4.5 `controlFitnessDriftGuard.test.ts`: parse `FittingControls` out of `FormPanel.scala` and assert `CONTROL_FITNESS` matches in content and order; prove it can fail by mutating one TS cell and recording the red run (C4)
- [x] 4.6 `formConfigValidation.test.ts`: every issue kind, `parseTypedValue` per declared type, `fittingControls` default ordering
- [x] 4.7 `useFormEditorState.test.ts`: add/remove/move/setControl-drops-attrs/setDataset-keeps-fields/reset/dirty
- [x] 4.8 `FormEditor.test.tsx`: orphan on open → field error + Save disabled with reason; dataset switch → immediate error, fixing re-enables; 400 on save → inline message, schema re-fetched, edits preserved; every control's computed accessible name includes its field (`toHaveAccessibleName`, C6)
- [x] 4.9 `FormFieldRow.test.tsx` + `FormOptionsEditor.test.tsx`: fitting-only controls with default first; used field excluded; Required disabled+checked with hint for a dataset-required field and omitted from config; `required: true` when checked on a non-required field; step/options visibility and the cleared hint; typed options
- [x] 4.10 `OutputPicker.test.tsx` additions: Form card present in place mode, absent in swap mode; dataset step lists datasets, filters, arrow/Enter/Back by keyboard; empty state CTA; create dispatched with `type: "form"` and a bound `config`
- [x] 4.11 `PanelDetailModal` test: a `form` panel renders the builder (not an empty body), a builder edit marks the sheet dirty, Save calls the form thunk; prove it can fail by removing one if-chain arm (C5)
- [x] 4.12 Run every gate — `cd backend && sbt test`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:schemas` — recording each result with its test/assertion count, never a bare "passed"

## Standing Constraints

- [C1] Installed `lucide-react` is 1.40.0 while the lockfile pins 1.43.0 (HEL-830 trap). A frontend gate failure naming a lucide export is environmental — confirm by measurement, never fix code to satisfy it.
- [C2] Schema consistency is checked on the EFFECTIVE post-patch config, never the incoming patch alone; a `dataSourceId`-only PATCH must re-validate existing fields. Pinned by the re-bind test and its mutation.
- [C3] Never silently drop or coerce: an orphaned field, an unfit control, or a wrong-typed value is SURFACED with an affordance; a control switch that clears an attribute says so. Same C8 family as HEL-1083.
- [C4] The fitness matrix has ONE source of truth (`FormPanel.scala`); the TS mirror is drift-guarded by a test that parses the Scala file. Never edit one side alone.
- [C5] If-chain dispatch sites (`PanelDetailModal` ×2, `PanelContent`) are not typecheck-protected — enumerate by hand and prove by mutation.
- [C6] A11y claims are asserted by computed accessible name, never by DOM presence; focus and visibility claims need rendered measurement (Playwright) — jsdom is not evidence.
- [C7] Every `git commit` call carries an explicit 600000 ms tool timeout; never re-run a commit mid-hook.
- [C8] Error-to-control association is asserted by computed ARIA state — `aria-invalid="true"` on the control and `toHaveAccessibleDescription` resolving to the error text — never by the presence of a `role="alert"` node. A live-region announcement fires once and is not an association; both evaluation cycles mistook presence for association (final-gate round 1).

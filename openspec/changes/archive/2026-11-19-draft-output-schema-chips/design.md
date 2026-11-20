## Context

`StepPreviewTable.tsx` (main cfb6041bf) renders the header chips from `analyzeOutputSchema` (saved analyze) always, and
the draft grid from `draftColumns`: names = `orderColumns(frameSchema(draftFrame), draft.columnOrder ?? [])` (HEL-1732,
`state/draftColumnOrder.ts` via `usePipelineDraftFrames.columnOrderOf`), types = saved `analyzeOutputSchema` by name.
`StepSchemaDiffChips` is already hidden while a draft is active. Chips render names only; `OutputSchemaDisclosure`
takes `SchemaField[]` (`{name, type: string}`) and also renders names only. The step's own draft rename config is read
by `renamesOf(step)` in the same file (used for the saved diff chips). `analyzeSchema` is the step's saved INPUT schema.

## Goals / Non-Goals

Goals: one field list feeds both grid and chips during a draft; renamed columns get a type; zero new requests.
Non-goals: server NDJSON order; type display in chips; chips for steps with no draft grid shown (see proposal).

## Decisions

**D1. One derived list, `draftFields`, and one render boolean.** In `StepPreviewTable`, compute one boolean
`showsDraftGrid = step.enabled && !isCreating && !isDraft && draftActive && draftFrame !== null && view?.status !==
"notPreviewed"` (the draft grid's real render condition: the body's `!step.enabled` and `isCreating || isDraft`
branches come first; a draft-disabled step has a non-null `disabled` frame, `draftStepView.ts:98-101`). The grid branch
and the chips both read it, so they cannot drift. Replace the inline `draftColumns` derivation with a pure helper
(`state/draftSchemaFields.ts`, `draftSchemaFields({ frame, names, savedOutput, savedInput, renames })`) returning
`SchemaField[]` (`{name, type}`), where `names` is exactly HEL-1732's
`orderColumns(frameSchema(draftFrame), draft.columnOrder ?? [])` (reused, not re-derived). `draftColumns` maps over
`draftFields` (`headerType: field.type`); the chips render `draftFields` when `showsDraftGrid`, else
`analyzeOutputSchema` (today's behavior). Alternative rejected: computing the chip list separately from the grid's.

**D2. Types: one ordered rule per column name.**
1. The name is a target of the shown step's DRAFT rename: the type of its origin column, looked up in the saved input
   schema (`analyzeSchema`), else the saved output schema, else fall to rule 3. Renames are decoded with
   `handlerFor("rename").decode(step.config).renames` (Scala fold order, as `draftColumnOrder.ts` `renamesOf` does), NOT
   `state/stepNarrowing.ts` `renamesOf` (object-insertion order). The origin is tracked by a new exported helper in
   `evaluator/steps/rowOps.ts`, `renameOrigins(names, renames)`, built on the existing `foldRenames` (same chain and
   collision semantics, returns each surviving `{name, originName}`), so the helper and the evaluator cannot disagree.
2. Else the saved output schema's type for that name (`analyzeOutputSchema`, today's grid rule).
3. Else the type `schemaFromFrame(frame)` (`state/draftEvaluation.ts:144`, request-free, memoized per frame, already on
   the draft path via `usePipelineDraftFrames.inputSchemaOf`) infers from the draft frame.
Every draft column therefore has a type; a descendant of a renamed step (rename, then filter) gets `zone`'s type from
rule 3. Chips and grid agree by construction because both read `draftFields`.

**D3. Disclosure.** All fields are typed (D2 rule 3), so `OutputSchemaDisclosure` takes `draftFields` unchanged.

**D1a. Empty draft frame.** A zero-row draft frame has no columns: `draftColumnOrder` returns `[]` for it and `orderColumns([], ...)` is `[]`, so `draft.columnOrder` is empty (verified in code) and nothing can be derived without a new derivation. The chips then show the saved analyzed output schema (`chipFields = draftFields` only when non-empty); the chip group never disappears while a schema is known. The empty grid keeps its existing empty state.

**D4. No request.** The helper is pure over props already present; no hook, service or effect is added. The jest tests
assert `fetchStepPreview` (the only request this component can send) was not called by the edit; e2e `hel1631-draft-mode` and `hel1632-live-output` stay green.

**D5. Tests (red first, the red run committed before implementation).**
- `StepPreviewTable` test with a draft rename `region`->`zone` on the shown rename step with a draft frame: the chips'
  text equals the grid headers in order, includes `zone`, excludes `region`; `zone`'s header caption equals `region`'s
  saved input type. Red on main.
- Large schema (> `SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD` draft columns): trigger shows the draft count; the opened panel
  lists draft names in grid order. Red on main.
- A draft that disables the shown step keeps the saved chips; a not-previewed step keeps the saved chips.
- Descendant: a step below a draft rename shows `zone` in the chips with the inferred (rule 3) caption.
- Unit tests for `draftSchemaFields` and `renameOrigins`: swap, collision, and a chain whose object-insertion order
  differs from its Scala fold order.
- Mutations recorded: chips back to `analyzeOutputSchema` -> red; rule 1 removed -> red; chips gated on
  `draftActive` alone (ignoring `step.enabled`) -> the disabled-step test red.

## Risks / Trade-offs

- [Saved type by name (rule 2) can be wrong when the draft changed a column's type, in an ancestor or by a cast on the
  shown step itself] -> same as the grid today; out of scope, chips and grid agree by construction; disclosed in the PR.
- [Chips flip between saved and draft schema while the first computation is pending] -> acceptable; matches the grid.

## Planner Notes

- Self-approved: keeping saved chips when no draft grid is shown; rule 1 traces only the shown step's own renames, rule 3
  (frame inference) types everything else the saved schema does not name.
- No server change needed: the chips are correct from the client's order (HEL-1732) without the NDJSON schema.
- Design-gate round 2 notes, binding for execution: `renameOrigins` folds over the saved INPUT names
  (`analyzeSchema.map(f => f.name)`); the chips' render guard and the inline/disclosure threshold use the DISPLAYED
  list's length (a draft-created step with no saved analyze still gets chips); the disabled-step test uses a step whose
  saved output differs from its input (e.g. a disabled rename); memoize `draftFields` separately from `flash.changed`;
  rule 3 infers only string/integer/float/boolean (a renamed date column below the rename captions `string`), disclosed
  in the PR with the rule-2 limit.

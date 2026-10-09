## Context

See proposal.md. All four defects verified on origin/main e7470bc6 (premise-validation evidence in the run dir).

- `frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx` compares `agg.fn` literally: `FN_HINTS[agg.fn]`,
  `agg.fn === "percentile"`, and `<Select value={agg.fn}>` (no option matches `"SUM"`). Backend
  `AggregateStep.aggregationProblem`/`apply` and `PipelineAnalyzeService.inferAggregate` lowercase `fn`.
- The `p` input is a `TextField` with `aria-label` + placeholder only; its error is `<InlineError error=... />`, a bare
  `<p>` with no id; no `aria-invalid`/`aria-describedby`.
- `PipelineAnalyzeService.aggResultType` returns the declared field type for `min`/`max`; `AggregateStep.apply` computes
  `nums.min`/`nums.max` over `PipelineRowJson.toDouble` (Double or null). The HEL-1310 parity test
  (`PipelineAnalyzeServiceSpec`, "HEL-1310 parity") only uses a float-declared `amount` field, which is why it passes.
  `aggResultType` is shared with `inferGroupBy` (groupby op); groupby's Spark path (`F.min`) preserves column type.
- `StepSchemaDiffChips.tsx` keys chips `added-${field.name}` etc.; aggregate output fields are named by alias.

## Goals / Non-Goals

**Goals:** fix the four items with red-first tests (1, 3, 4) and an a11y assertion (2).
**Non-Goals:** see proposal.md Non-goals (no apply semantics change, no groupby change, no config rewriting).

## Decisions

**D1 — Item 1: normalize at read, not on save.** Compute `fnKey = agg.fn.toLowerCase()` once per row and use it for the
Select `value`, the `FN_HINTS` lookup and the `p`-input gate. Alternative: lowercase on load and emit — rejected,
because emitting on render would mark a pristine step dirty (an unrequested save). Any user edit of the function writes
the lowercase picker value anyway (`handleFnChange`). Backend accepts either case, so editing only `p`/alias/field of a
`"PERCENTILE"` row keeps the stored case and stays valid.

**D2 — Item 2: follow the `FormField` + `FormFieldRow` precedent.** DESIGN.md has no form-error section; §6 names
`FormField` (`shared/ui/FormField.tsx`) "the one form-row recipe (label + control + help/error layout)", and
`features/panels/ui/editors/FormFieldRow.tsx` (HEL-1084) is the precedent for threading `errorId` onto the control's
`aria-describedby` plus `aria-invalid`. Wrap the `p` input in `<FormField label="Percentile (p)" htmlFor={pId}
error={pError} errorId={pErrorId}>` with `useId`-derived ids per row, and set `aria-invalid`/`aria-describedby` on the
`TextField` only while the error shows. The visible label replaces the placeholder-as-label; the per-row `aria-label`
is dropped in favour of the `<label htmlFor>` so the accessible name is the visible text (tests that query
"Percentile p N" are updated to the new name, which must still be unique per row, e.g. by including the row number in
the label or keeping a row-scoped query). Executor must confirm `TextField` forwards `id`/`aria-*`, and verify the row
layout in the running app in both themes; a FormField's column layout inside the horizontal aggregation row must not
break alignment (adjust with existing tokens in the pipeline CSS only if needed).

**D3 — Item 3: move inference to apply (`float`), scoped to the aggregate op.** Give `inferAggregate` its own result
typing where `min`/`max` → `float`; leave `aggResultType` (used by `inferGroupBy`) unchanged. Alternative: make apply
preserve the declared type — rejected: it changes stored row values for every existing min/max pipeline and requires
new semantics for string/date fields (apply today ignores non-numeric values), i.e. a product call. `float` is also
the existing convention for every other numeric aggregate (sum/avg/median/percentile are `float` even on integer
fields). Parity proof: extend the HEL-1310 parity test to iterate every supported fn over source fields declared
`integer` and `float` (and keep its exhaustive-over-SupportedFunctions shape); it must fail on the old code for
`min`/`max` over the integer field (record the red run). Also update any existing spec/test that asserts the old
declared-type min/max inference for the aggregate op (search `PipelineAnalyzeServiceSpec` and fixtures), and confirm
groupby min/max inference tests still pass unchanged.

**D4 — Item 4: index-qualified keys.** Key each chip `${category}-${index}-${name}`; chips are stateless, so index keys
are safe. Red-first test renders two added fields named `""` and asserts no React duplicate-key `console.error` and two
chips rendered.

## Risks / Trade-offs

- [Downstream steps now see `float` for aggregate min/max of an integer field] → values were already Doubles; this
  makes the schema honest. Frontend type-aware controls treat integer and float alike (`NUMERIC_TYPES`).
- [min/max over a string- or timestamp-declared field also becomes `float`; a CSV numeric-text column's min/max
  becomes newly bindable to numeric panel slots] → intended: apply already returns Doubles/null; state it in the PR body.
  The existing test "aggregate — min/max inherit the source field type" is updated (task 1.3).
- [Visual layout of a labelled `p` field inside a horizontal row] → verify in the running app, both themes.

## Planner Notes

- Self-approved: direction of item 3 (inference → apply). Driver authorised aligning when not a product call; changing
  only the reported type (no data change) is the non-product direction.
- No migration (latest is V120).

## Executor Notes

- Red evidence: `red-frontend.txt` (item 1/2/4 failures on old code), `red-backend.txt` (parity fails `fn=min declared=integer: Some("integer") was not equal to Some("float")`).
- PR body note: aggregate min/max over string/timestamp-declared fields (e.g. CSV numeric-text) now infer `float`, making them bindable to numeric slots; values were already Doubles.
- p-input label text is "Percentile p (row N)".
- Residue (dev DB, throwaway users, exact ids): user hel1407-1791536897172-8183@example.test, source e276dc17-c010-4839-b48c-a779985b2946, pipeline 8951d417-fef5-40e6-b4e1-54f6ac563c58; earlier aborted run: pipeline b29b8678-db6e-4cc5-b798-277f225eada3 (its user/source unrecorded).
- Cycle 2 residue: user hel1407-1791538500969-10982@example.test, source aa8c3aae-3aca-4901-86f6-a7673bd507c8, pipeline 6031b7e6-a82d-4ab4-9950-fdd31e10f4a5. Live width measured: p input = alias input = 766px, valid and error, light and dark.

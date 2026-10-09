## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e7470bc620557e3c0f27db637d7fb28811cb516c (planning artifacts untracked in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/aggregate-editor-fn-case-a11y/HEL-1407`.

### What I verified (with evidence)

**Premises (all four defects exist at HEAD):**
- Item 1: `frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx` uses `value={agg.fn}` on the Select,
  `FN_HINTS[agg.fn as ...]`, and `agg.fn === "percentile"`, with no normalization. Backend lowercases
  (`AggregateStep.scala:82,132,147`; `PipelineAnalyzeService.scala:635`). Confirmed.
- Item 2: the `p` `TextField` has only `aria-label` + `placeholder`; the error is `<InlineError>` with no id and the
  input has no `aria-invalid`/`aria-describedby`. Confirmed.
- Item 3: `aggResultType` (`PipelineAnalyzeService.scala:1184-1190`) returns the declared input type for min/max.
  `AggregateStep.apply` (`:149-155`) returns `nums.min`/`nums.max` over `PipelineRowJson.toDouble`, so the result is
  a Double or null. The existing parity test (`PipelineAnalyzeServiceSpec`, "HEL-1310 parity") uses only a
  float-declared `amount` field, which is why it passes. Confirmed.
- Item 4: `StepSchemaDiffChips.tsx:29` keys chips as `added-${field.name}`. `computeSchemaDiff` builds `added` with
  `output.filter(...)`, which does not dedupe, so two `""` aliases produce two identical keys. Confirmed.

**D3 direction (inference becomes float), challenged against downstream consumers:**
- No other runtime path exists for the `aggregate` op. Spark (`SparkJobSubmitter.scala:248-261`) handles only
  `GroupByStep`. In-memory `GroupByStep.apply` supports only sum/count. Leaving `aggResultType`/`inferGroupBy`
  untouched is therefore the correct scope.
- Every consumer of projected types treats `integer` and `float` the same way:
  - `SlotEligibility.Numeric`/`Orderable` (`OutputBindingSpec.scala:21-26`) accept both.
  - `NodeSnapshotRepository:66` sorts both as `AsNumeric`.
  - `ExpressionEvaluator:509` (compute/HEL-1423) uses `numeric = Set("integer","float")`.
  - `AnalyzeSchemaWarnings:72` maps both to the "numeric" family.
  - Frontend `NUMERIC_TYPES` and `outputControlEligibility` include both.
  - `MetricRenderer`'s "integer" is the Output's configured *format*, not the schema type, so it is unaffected.
  - Form panels bind to dataset declared schemas, not pipeline projections.
- `PipelineSchemaDrift` diffs *source* schemas, not aggregate outputs, so no spurious drift is introduced.
- No frontend or helio-mcp code re-derives aggregate types (grep of `"min"` cases shows only panel/pivot code).
- No row value changes. `PipelineRowJson.jsValueToAny` already materializes every JSON number as a Double
  (documented HEL-893 divergence).
- Judgment: **not a product call.** The change only makes the reported type honest about values the step already
  emits. The opposite direction (preserving the declared type in apply) would change stored values and need new
  string/date semantics; the design correctly rejects it as the product-call direction.
- One user-visible delta the design does not name (see notes): min/max over a `string`- or `timestamp`-declared
  field moves to `float`. Because CSV columns are `string` until cast (schema-inference spec), a min/max over a CSV
  numeric-text column becomes newly eligible for Numeric slots such as metric value and chart yAxis. Its values are
  already Doubles, so this is a fix, not a regression. The spec delta's "regardless of the source field's declared
  type" covers it.
- The existing test "aggregate — min/max inherit the source field type from inputSchema"
  (`PipelineAnalyzeServiceSpec` ~L459-471) asserts `max_created` over `created_at` is `"string"`. It will go red and
  must be updated. Task 1.3 covers this.
- No main spec requires min/max to inherit the declared type. `openspec/specs/pipeline-analyze-api` only specifies
  `groupby`, which stays unchanged. The MODIFIED requirement text in the delta restates the full original
  requirement plus additions, which is correct delta form.

**Red-first plans fail on current code:**
- 1.1: min over an integer-declared field yields a Double at runtime, so the expected type is "float". Inferred is
  "integer", so the test is red. The float-declared case stays green, as intended.
- 2.1: `FN_HINTS["SUM"]` is undefined (hint missing), the Select has no option matching "SUM", and
  `"PERCENTILE" === "percentile"` is false (no p input). Red on all three assertions.
- 3.1: there is no `aria-invalid` and no `<label>` element at present, so the test is red.
- 4.1: `added` keeps both `""` fields and React 19 (`frontend/package.json` `react ^19.3.0`) logs a duplicate-key
  `console.error` in dev/test builds, so the test is red. I did not execute it; this is reasoned from the code.

**D2 precedent:**
- `shared/ui/FormField.tsx` exposes `errorId` and applies it to the error `<p>`. `FormFieldRow.tsx:57-80` threads
  `useId()` onto the control's `aria-describedby` plus `aria-invalid`.
- DESIGN.md §6 names FormField "the one form-row recipe". DESIGN.md has no form-error section and §8 says nothing
  about `aria-invalid`. The chosen precedent is correct.
- `TextField` (`shared/ui/TextField.tsx`) spreads `...rest` onto `<input>`, so `id`, `aria-invalid` and
  `aria-describedby` are forwarded.

**Scope and ACs:** every AC maps to a task: item 1 → 2.1/2.2, item 2 → 3.1-3.3, item 3 → 1.1-1.3, item 4 → 4.1/4.2,
gates → 5.1. No API, schema or migration change is needed (the wire type field is an existing string). I found no
placeholders and no contradictions between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
1. D2 says "`useId`-derived ids per row". Hooks cannot be called inside the `.map`, so call `useId()` once at
   component level and suffix it with the row index (for example `${base}-p-${index}` and `${base}-p-err-${index}`).
2. D2 label uniqueness: the sibling controls' accessible names all carry the row number ("Alias for aggregation N").
   Keep that for the p input too, either with a visible label that includes the row (e.g. "Percentile p (row N)")
   or with a row-scoped name. If an `aria-label` is retained, it must contain the visible label text (WCAG 2.5.3).
   Prefer dropping it and relying on `<label htmlFor>`, as the design says.
3. 3.1's "visible label" assertion must check for a real `<label>` element (e.g. `input.labels.length > 0` or
   getByText(...).tagName === "LABEL"). `getByLabelText` also matches `aria-label`, so it would pass vacuously on old
   code.
4. FormField is not yet used anywhere under `features/pipelines`, and its column layout sits inside a horizontal row.
   Task 3.3's running-app check in both themes is load-bearing, not optional.
5. Add the string/timestamp-declared → float delta (the CSV numeric-text case) to design Risks or the PR body so the
   user-visible effect is recorded. Optionally add a string-declared numeric-text column to the parity test.
6. Item 4's index-qualified keys: also apply them to the `retyped`/`dropped`/`renamed` maps for consistency. The
   design's `${category}-${index}-${name}` already implies this.

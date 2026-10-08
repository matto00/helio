## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed against worktree HEAD 55b7c4269d90eea7f3c71f3a2e3857a4018ee47b. The change dir is untracked because this is planning only.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.
`openspec validate validate-output-config-keys --type change` printed "Change 'validate-output-config-keys' is valid".

### What I verified (with evidence)

**Round-2 CR1 (metric field rule gated on a non-null aggregation): resolved.**
- D5 now reads "Only when the write sets a NON-NULL metric aggregation (changed from stored) ...". It explicitly keeps `{fieldMapping:{}, aggregation:null}` and HEL-1326 `metric: null` valid.
- The spec requirement says: "When such a write sets a non-null metric `aggregation` ... a metric with a null or absent aggregation needs no field."
- New scenario: `{ fieldMapping: {} , aggregation: null }` and `{ fieldMapping: { label: "x" } }` succeed. The `{agg}`-with-no-field → 400 case is kept.
- Task 4.1 lists both accepted shapes.
- Ground truth:
  - `OutputBindingSpec.Metric` has optional slots `label` and `unit` (OutputBindingSpec.scala L64-69), so `{fieldMapping:{label}}` also passes the existing slot check.
  - `buildOutputConfig.ts`'s metric branch emits `aggregation: null` when no field or agg is selected, so a pre-field editor save stays valid.
  - The HEL-892 bogusSlot test still hits its own error first, because no metric aggregation is set.

**Round-2 CR2 (meaning of a null clear in D10): resolved.**
- D10 says: "the shallow merge is UNCHANGED, so the key is stored as JSON `null` ... GET returns `"metricLabel": null` — never a merge change that drops null keys."
- The spec requirement and its scenario say the same.
- Task 4.2 asserts `GET returns "metricLabel": null`.
- Consistent with `mergeConfig` at OutputService.scala L486-493 (`existing.fields ++ patch...`). Once D6 removes the deep-merge arm, this is a plain shallow merge that keeps `JsNull`.

**Round-2 non-blocking notes: all adopted.**
- D9 is now a sealed `OutputConfigWritePolicy.{ValidateWrite, RestorePriorStored}`. It mirrors `LayoutWritePolicy`, whose `RestorePriorStored` is `private[services]` (LayoutPolicy.scala L13-16).
- A route-PATCH-still-400 test is in D9 and task 4.4.
- The HEL-946 fixture is named in task 1.6.
- The accepted-gap Risks bullet is present.
- The helio-news PR-body flag is present.

**Editor writers vs the per-kind key sets: no rejection found.**
I re-read `buildOutputConfig.ts` (whole file). Every key it writes is in its kind's known set:
- chart: chartType, fieldMapping, aggregation, chartOptions, annotation, compare
- table: fieldMapping, columnOrder, columnFormats
- metric: fieldMapping, aggregation, label, unit, format, compare
- markdown: content, fieldMapping
- collection: fieldMapping, layout, format
- timeline: fieldMapping, sort

No editor path sends `aggregation` for a kind that does not accept it.

**New finding: two agent-facing contracts that this change tightens get no planned doc update.**
- `AssistantProposalToolSchemas.PipelineProposalOutputSchema` (L242-267) gives the in-app assistant's `propose_pipeline`/`propose_combined` Output `config` as a bare `{"type":"object"}` with no description.
  - That config reaches `PipelineService` L1505-1507 (`validateOutputFieldMapping`), which this change makes reject unknown keys and malformed aggregation (task 1.4).
  - The proposal is then applied via single-call create, which would now 400.
- The refinement-edit prompt `RefinementEditShape.scala` L211-216 and L260-261 tells Claude that a "different metric/column/chart type" request "is an Output edit (target.kind: "output", patch reuses UpdateOutputRequest -- name/config)". It never documents the config keys.
  - That patch flows through `PatchSetPreviewProjection` and apply, which tasks 1.3 and 1.5 newly validate.
- Before this change, a key the in-app assistant invented was harmlessly ignored. After it, the proposal or refinement fails.
- The plan documents keys and aggregation shapes for helio-mcp (mcp-output-tools spec, task 2.3), for exactly this reason: agents must know the keys. But it omits the two equivalent in-app assistant surfaces.
- This is a missing contract update on a path the change itself tightens (see CR1).

### Verdict: REFUTE

### Change Requests

1. **Document the per-kind Output config keys and aggregation shapes on the in-app assistant's surfaces too, not only helio-mcp.**
   - (a) In design D8 and a spec requirement (extend the `mcp-output-tools` requirement, or add one to the matching assistant capability), require the same per-kind key and aggregation-shape documentation in:
     - the `config` description of `AssistantProposalToolSchemas.PipelineProposalOutputSchema` (L256),
     - the Output-update guidance in `RefinementEditShape.scala` (L211-216 / L260-261).
   - Prefer a single doc string derived from `OutputConfigValidation`'s key table (like `COMPARE_CONFIG_DOC` on the MCP side), so the docs cannot drift from the validator.
   - (b) Extend task 2.3, or add a task, with a test that asserts each kind's known keys appear in that description. `AssistantProposalToolSchemasSpec` already decode-pins these schemas.
   - (c) Add a risk line for in-app assistant proposals or refinements that carry an invented key. They now surface a `validationError` or 400 where they used to be silently accepted.

### Non-blocking notes
- D5 says "`null` always OK; any other kind → reject non-null". Under the spec's key sets, `aggregation` is not a known key for table, collection, timeline or markdown, so `aggregation: null` there is rejected as an unknown key (the scenario "a table Output is written with any `aggregation`" agrees). Reword D5 to "null always OK on chart/metric", so the implementer does not special-case null for other kinds.
- `buildAggregateTailConfigs` writes chart `fieldMapping: {category, value}`, which are not Chart slots (`xAxis`/`yAxis`/`series`/`annotation`). It is already a listed non-goal and it pre-exists. It is noted only so that a 400 on that path during execution is not misattributed to this change.

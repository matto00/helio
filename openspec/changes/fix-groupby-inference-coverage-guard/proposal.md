## Why

`PipelineAnalyzeService.inferOutputSchema` dispatches 22 of the 23 kinds in
`PipelineStep.Registry`. `groupby` has no branch and falls through to the
`case unknown` arm, so **every valid `groupby` step reports
`validationError: "Unknown op: 'groupby'"` on every analyze call**, with an identity
passthrough output schema instead of its real group-keys-plus-aggregate shape.

This is worse than cosmetic. `analyze_pipeline` is the agent-facing surface for checking
a pipeline before running it. Wrong metadata about capability steers behaviour: an agent
that trusts `validationError` will avoid a working op, or report to a user that a valid
pipeline is invalid. The wrong output schema also propagates — downstream steps in the
same analyze pass infer against the wrong input schema.

The deeper problem is structural. `groupby` was left behind **precisely when `join` was
fixed beside it, in the same dispatch block**, by HEL-911 — an engineer looking directly
at this exact defect fixed one of the two and not the other. Nothing checks that the
registry and the dispatch list agree, so the drift is silent and recurring. Fixing
`groupby` alone restores parity today and guarantees nothing about kind 24.

## What Changes

- **Add `inferGroupBy`** and wire `case "groupby"` into `inferOutputSchema`. Output is
  the group-key fields (types resolved from the input schema by name) plus one aggregate
  column named `<aggFunction>_<aggColumn>`, typed by the *function*, not the input column
  — reusing the existing `aggResultType` helper (`count` -> `integer`, `sum` -> `float`).
- **Add a registry-vs-dispatch coverage guard test** (the primary deliverable): expected
  set derived from `PipelineStep.Registry`; actual coverage established by calling
  `inferOutputSchema` **directly** (never via `analyze`, which short-circuits on
  `validateStepConfig` and never reaches inference on a rejected config) with a **fully
  valid config per kind**, asserting `validationError` is **`None`** — never merely "no
  `Unknown op`", which would certify kinds the probe never actually reached. Requires
  widening `inferOutputSchema` to `private[engine]`. Failure names the specific uncovered
  kind. Any excluded kind is excluded by name with a stated reason.
- **Extend `PipelineAnalyzeServiceSpec`** with valid-`groupby` cases asserting the
  projected schema against what `GroupByStep.apply` actually emits on real rows.

- **Remove the one surviving HEL-860 "unassertable" comment**
  (`PipelineAnalyzeRoutesSpec.scala:492-497`) and assert the positive path it declares
  unassertable. It claims `groupby`/`join` have no dispatch case — already half-false since
  HEL-911, wholly false once this lands.

Explicitly NOT in scope: `join` inference (already shipped in HEL-911). An earlier draft of
this proposal also placed HEL-860's "unassertable" comments out of scope as "already gone";
that was wrong — it generalized from a single-file grep, and a full-tree sweep found one
survivor, now folded in above. See `ticket.md`'s premise correction.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `pipeline-analyze-api`: analyze must project a real output schema for a `groupby` step
  and must never report `Unknown op` for a kind registered in `PipelineStep.Registry`.

## Impact

- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — one new
  private `inferGroupBy`, one new dispatch arm.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — the
  coverage guard plus valid-`groupby` projection cases.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` —
  delete the stale comment, assert the valid-`groupby` route path.
- `openspec/specs/pipeline-analyze-api/spec.md` — delta.
- No migration (pure inference logic; no persisted shape changes, no wire-shape change —
  the `AnalyzedStep` response shape is unchanged, only its *values* become correct).
- No frontend change. No API contract change beyond correctness of existing fields.

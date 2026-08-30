## Why

A `compute` step whose expression cannot be parsed produces a column of `null`s and a green run. Measured on production `v0.7.6`: `expression: "stats.adp_ppr - stats.pts_ppr"` was accepted at step-create, ran over 1000 rows, and wrote 1000 nulls with no 422, no run error, and nothing in the run result. `$stats.adp_ppr - $stats.pts_ppr` then returned `-340.5`.

The cause is `ComputeStep.apply`:

```scala
val value = ExpressionEvaluator.evaluate(expr, jsRow) match {
  case Right(v) => PipelineRowJson.jsValueToAny(v)
  case Left(_)  => null
}
```

`evaluate` re-parses the expression on every row and returns `Left(ParseError(..))` every time, with the message discarded. But a parse error does not depend on the row: it is knowable once, before any row is touched. Paying it 1000 times and throwing the answer away is the worst of both — no error surfaced, and O(n) wasted parses.

This is the failure mode the HEL-857 epic exists to eliminate: silent wrongness that reaches a panel as blanks. The config-key half of the original report shipped as `8f3756eb` (HEL-814); this closes the expression half.

## What Changes

- **A new schema-free static check on `ExpressionEvaluator`** that answers exactly one question: can this expression parse at all, under the same grammar (strict, with the frozen legacy fallback) that `evaluate` uses at run time? It returns the parser's own message.
- **Write path.** `ComputeStep.companion.validateRawConfig` gains that check, so an unparseable expression is rejected with a 422 at step create, step update, proposal apply, and patch-set apply — all four HEL-814 write surfaces, from one override. A missing or empty expression is deliberately still accepted (unconfigured draft).
- **Run path.** `ComputeStep.companion.requiredConfigProblems` gains the same check, so a step created before this change fails its run naming the step id, kind, and the parse error, in HEL-859's established style. The same override also covers step preview, which routes through the same engine fold. Analyze reports the same defect by a different route — it evaluates `validateRawConfig` first and short-circuits `requiredConfigProblems`, so the parse problem surfaces there as a write-path rejection, with the parser's message but a different prefix.
- **Per-row failures are unchanged and stay distinct.** Division by zero, a null operand, or an unknown field still yield `null` for that row and never fail the run. Only the static, row-independent parse failure is promoted to an error.
- `ComputeStep.apply` hoists the parse out of the row loop, so the expression is parsed once rather than once per row.

Explicitly not changed: the read path. `PipelineStepRepository.rowToDomain` and `ComputeConfig.decode` stay tolerant, because a decode failure there backs every read with an `IllegalStateException` and would 500 the pipeline editor for exactly the steps this change is meant to help.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `pipeline-compute-op`: narrows the existing "if evaluation fails for a row (parse error, unknown field, division by zero, type error) the field value SHALL be `null`" clause. A row-independent parse failure is no longer a per-row `null`; unknown field, division by zero and type error remain per-row `null`.
- `pipeline-step-config-rejection`: extends write-path rejection beyond shape to cover a `compute` expression that is present but statically unparseable.
- `pipeline-step-config-runtime-completeness`: extends the run/analyze completeness gate beyond missing-or-empty to cover a present-but-unparseable `compute` expression on a step stored before this change.

## Impact

- `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` — new static parse-problem entry point.
- `backend/src/main/scala/com/helio/domain/steps/ComputeStep.scala` — `validateRawConfig` and `requiredConfigProblems` overrides; parse hoisted out of the row loop.
- No migration, no wire-shape change, no frontend change, no new configuration.
- Behaviour change visible to callers: `add_pipeline_step`/`update` with an unparseable expression now 422s instead of 200s; running a pre-existing such step now fails instead of returning nulls. Both are the point of the ticket.

# HEL-888: compute silently nulls an entire column when the expression fails to parse

## Description

A statically invalid `compute` expression is a parse error that is identical for every row. Today `ComputeStep.apply` evaluates the expression per row and, on `Left`, discards the evaluator's message and writes `null`:

```scala
val value = ExpressionEvaluator.evaluate(expr, jsRow) match {
  case Right(v) => PipelineRowJson.jsValueToAny(v)
  case Left(_)  => null
}
```

Measured on production `v0.7.6`: `expression: "stats.adp_ppr - stats.pts_ppr"` (no `$` prefix) was accepted at step-create, ran green over 1000 rows, and produced 1000 nulls. `$stats.adp_ppr - $stats.pts_ppr` then returned `-340.5` correctly. No 422, no run warning, nothing in the run result — a panel full of blanks.

The check that would catch it already exists and is good: `PipelineAnalyzeService`'s `inferCompute` runs the strict `ExpressionEvaluator.validate`. It is simply not consulted on the write path or the run path — only by `analyze_pipeline`, which an agent has no reason to call after a step it believes is valid.

Core design point: **a parse error is knowable once, before any row is touched.** Paying it per-row and discarding it is the worst of both. But a genuine per-row failure (divide-by-zero, null operand) must still yield `null` for that row without failing the run.

### Scope

The config-key half of the original ticket (`outputColumn` dropped, `column` defaulting to `""`) shipped separately as `8f3756eb` (HEL-814) and is closed on `main`. Only the expression half is in scope here.

### Existing mechanism this must compose with

HEL-814 established a two-tier step-config contract on `PipelineStep.Companion`:

- `validateRawConfig(raw): Option[String]` — **shape/write path**. Wired at four write surfaces: `PipelineService:494` (step create), `PipelineService:670` (step update), `PipelineProposalService:187`, `PatchSetApplyResolvers:240`.
- `requiredConfigProblems(raw): Vector[String]` — **semantic/run path**. Consulted by `InProcessPipelineEngine:145` (run) and `PipelineAnalyzeService:141` (analyze). Deliberately NOT on the write path, so an unconfigured draft stays saveable.

This change must extend that mechanism rather than adding a third one.

### Hazards

1. **Read path must stay tolerant.** `PipelineStepRepository.rowToDomain` turns any decode failure into an `IllegalStateException` backing every read; raising there 500s the pipeline editor. Expression validation must not land on the read path.
2. **Empty expression must remain saveable.** Production contains `compute` steps with both `column` and `expression` empty (`NFL Player Season Projections`) — unconfigured drafts. HEL-814 already routes emptiness to `requiredConfigProblems` (run-time), not `validateRawConfig` (save-time). It is the *run* that must not silently produce a column of nulls.

## Acceptance criteria

- [ ] A statically invalid expression is rejected at step-create with the evaluator's own message — the one `ExpressionEvaluator.validate` already produces, not a generic one.
- [ ] If a step with an invalid expression already exists (created before this change), the run fails naming the step id, type, and the parse error, in the style HEL-859 established — rather than silently nulling the column.
- [ ] A genuine per-row evaluation failure (divide-by-zero, null operand) still yields `null` for that row without failing the run. Distinguish the static parse error from the per-row failure; do not collapse them.
- [ ] An empty expression remains saveable (draft), and continues to fail at run via the existing `requiredConfigProblems` path.
- [ ] Expression validation is not added to the read path; `rowToDomain` stays tolerant.
- [ ] Verified by measurement: assert on the materialised rows, not on the stored config round-trip. A config that round-trips is precisely what this bug produces.

## Evidence rule

Every test must be failable. A test claimed as proof the defect is fixed must be shown **red before the fix**. A regression guard is failable by mutation, not by reverting the fix, and must be **labelled as a guard** rather than counted as proof. Report the split explicitly: how many are proof, how many are guards.

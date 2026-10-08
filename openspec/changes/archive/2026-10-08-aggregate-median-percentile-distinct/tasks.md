## Standing Constraints

## 1. Backend — AggregateStep

- [x] 1.1 Add `p: Option[Double] = None` to `Aggregation` (jsonFormat4; confirm a config without `p` round-trips byte-identically)
- [x] 1.2 Extend `SupportedFunctions` with `median`, `percentile`, `count_distinct`; add `aggregationProblem(agg)` (design Decision 2) and call it for every aggregation before either `apply` branch
- [x] 1.3 Implement `percentileOf` (linear interpolation, Decision 3), `median`, `percentile`, `count_distinct` in the grouped branch and the empty-input branch (Decisions 4–5); update the scaladoc fn list
- [x] 1.4 `AggregateStepSpec`: every scenario in the spec delta (odd/even median, p90 = 9.1, p0/p100, numeric strings + null + non-numeric, NaN excluded, [Inf, Inf] interpolation is Inf not NaN, count_distinct incl. 1L/1.0, grouped, all-null group, empty input both branches, invalid-p configs throw)

## 2. Backend — analyze

- [x] 2.0 Override `AggregateStep.companion.validateRawConfig` (design Decision 2, write time), composed with `super`; report ALL problematic aggregations joined with "; " (not just the first); `aggregationProblem` lowercases fn before every rule (test `"PERCENTILE"` + p accepted); keep the literal "Unsupported aggregation function" + fn name in that message (`PipelineAnalyzeRoutesSpec.scala:419-420`)
- [x] 2.1 `validateAggregate` reduced to `AggregateStep.aggregationProblem` (or removed); test that one invalid aggregation yields exactly ONE analyze validationError
- [x] 2.2 `aggResultType`: `median|percentile → float`, `count_distinct → integer`; `inferAggregate` lowercases fn
- [x] 2.3 `PipelineAnalyzeServiceSpec`: inferred types for the new fns (incl. upper-case fn), validationErrors for each invalid-p case
- [x] 2.4 Apply/infer parity test iterating `AggregateStep.SupportedFunctions` (Decision 7); demonstrate red by mutation and record the transcript
- [x] 2.5 Write-path tests: a `percentile`+`p` (and `median`, `count_distinct`) aggregate config is ACCEPTED, and missing-`p` / out-of-range `p` / `p`-on-non-percentile / unsupported fn are REJECTED with the existing validation response, on: REST step create (addStep), step update, proposal validate (`PipelineProposalService`), patch-set apply; plus `stepConfigProblem` reports the invalid ones. Transactional create is out of scope (follow-up) — assert nothing new there

## 3. Backend — agent docs

- [x] 3.1 `RefinementPrompt` / `RefinementEditShape` derive the fn list from `SupportedFunctions` and mention `p`; test asserts every supported fn appears

## 4. Frontend

- [x] 4.1 `pipelineStep.ts` `Aggregation.p?: number`; `AggregateConfig.tsx` `AGG_FNS`, `FN_HINTS`, `p` input + seeding/removal (Decision 9); check `stepNarrowing.ts` preserves `p`
- [x] 4.2 `AggregateConfig.test.tsx`: new fns offered, percentile reveals p (seeded 50) and emits it, cleared/out-of-range p shows inline error and does not emit, switching away drops p
- [x] 4.3 UI check in the running app (both themes): add an aggregate step with median / percentile p=90 / count_distinct on a real CSV source, run it, confirm values; record dev-DB residue by exact id (done by the evaluator in evaluation-1.md and re-checked by skeptic-final-1.md; the executor had no browser tool)

## 5. Specs & gates

- [x] 5.1 Update `openspec/specs/pipeline-aggregate-op/spec.md` Purpose if still TBD (via archive)
- [x] 5.2 `sbt testFull` (or targeted testOnly + full), `npm test`, `npm run lint`, `npm run typecheck`, format check

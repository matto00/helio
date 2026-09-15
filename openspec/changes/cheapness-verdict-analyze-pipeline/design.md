## Context

`PipelineService.analyze` (services/pipelines/PipelineService.scala ~918) loads summary, all steps, roots via
`listRootDataSourceIdsInternal` + `dataSourceRepo.findByIdOwned`, and returns `PipelineAnalyzeResponse`
(api/protocols/pipelines/PipelineAnalyzeProtocol.scala, `jsonFormat5`). `PipelineSummary.lastRunRowCount` already
exists. Source kinds (domain/model/DataSource.scala): csv/text/pdf/image (optional `sourceUrl`), rest_api, sql,
dataset (rows in `dataset_rows`). V107 admits `upsertsource`, `convertformat`, `analyzewithai`, `generatetext`;
only `upsertsource` is registered (PipelineCreateTransactionalSpec pins the other three as unregistered 400).

## Goals / Non-Goals

**Goals:** one pure, exhaustively-tested classifier; an additive, always-present wire field; deny-by-default.
**Non-Goals:** see proposal.md. No step implementations, no triggers, no UI.

## Decisions

D1. Pure estimator. `domain/engine/PipelineCostEstimator.scala`: `estimate(input: CostInput): CostVerdict`, no IO.
`CostInput(steps: Vector[(stepId, op)] /* enabled only */, roots: Vector[RootCost], lastRunRowCount: Option[Long])`;
`RootCost(rootId, kind: Option[String] /* None = unresolvable */, hasSourceUrl: Boolean, datasetRowCount: Option[Long])`.
Service does IO, estimator decides. Disabled steps never execute, so they are not counted or classified.

D2. Op classification is an explicit, HAND-MAINTAINED ALLOWLIST (`CheapOps`) -- a literal
`Set[String]`, NOT derived from `PipelineStep.Registry.keySet` (skeptic-final-1.md CR1: a derived
formula would make every future `Registry` addition, e.g. HEL-1107's `convertformat`, automatically
cheap the instant it's registered, with zero review attention and zero code change here -- the
exact inverse of "deny by default"). Plus named deny sets: `AiOps = Set("analyzewithai",
"generatetext")` → reason `ai-step` (its own code, checked BEFORE the allowlist, so HEL-1108 can
key on it and the AI arm is distinguishable from the fallback). `WriteBackOps = Set("upsertsource")`
→ `writeback-step` (auto-running a writer cascades into further auto-runs; conservative). Every
other op (including `convertformat` today) → `unclassified-op`. A completeness/partition test
(tasks.md C4) asserts every op in `PipelineStep.Registry.keySet` is present in exactly one of
`CheapOps`/`AiOps`/`WriteBackOps` -- this is the real tripwire: a newly registered op with no
matching entry in any of the three sets fails that test, not a tautological "allowlist equals
itself" check.

D3. Sources. `rest_api`, `sql` → `remote-fetch`; any root with `hasSourceUrl` → `remote-fetch`; `kind = None` or a
kind outside {csv,text,pdf,image,dataset,rest_api,sql} → `unclassified-source`; zero roots → `no-roots`.

D4. Row estimate = `lastRunRowCount` if present, else the sum of `datasetRowCount` when EVERY root is a dataset with a
known count, else None → `row-estimate-unavailable`. `estimatedRows > MaxAutoRunRows (10_000)` →
`rows-above-threshold`. Enabled step count `> MaxAutoRunSteps (20)` → `steps-above-bound`. Constants live on the
estimator object, one place to loosen.

D5. All reasons are collected (not first-match). `autoRunnable = reasons.isEmpty`, derived in exactly one place;
`CostVerdict` has a private constructor so no caller can build an allow carrying reasons.
Reason: `CostReason(code: String, detail: String, stepId: Option[String])`.

D6. Wire: `PipelineAnalyzeResponse.costVerdict: CostVerdictResponse` (non-Option, always present, `jsonFormat6`).
Schema: `costVerdict` required, `code` an enum of the nine codes, `additionalProperties: false`. helio-mcp and
frontend types add it. Concise mode and proposal analyze unchanged (byte-identical).

D7. Dataset counts: new `DataSourceRepository.countDatasetRows(ids: Seq[DataSourceId]): Future[Map[DataSourceId, Long]]`
(one grouped `count(*)` over `dataset_rows`, same pool as `findByIdOwned`). A root `findByIdOwned` cannot see (e.g.
a shared viewer) is `kind = None` → denied.

D8. Failable probe (AC). Estimator spec: AI-step pipeline (dataset root, 5 rows, `filter` + `analyzewithai`) asserts
`autoRunnable=false` AND reasons contain `ai-step`; the same pipeline minus the AI step asserts `autoRunnable=true`.
Mutation M1: delete the AI arm → AI test must go red on the `ai-step` assertion (the verdict alone would stay deny via
`unclassified-op`, which is exactly why the code is asserted). Mutation M2: add `analyzewithai` to `CheapOps` and remove
the arm → `autoRunnable` assertion red. Both red transcripts captured, mutations reverted. Plus a route-level spec
through `PipelineService.analyze` with a persisted pipeline for allow and `rest_api` deny, and an AI-op row inserted
past service validation (V107 permits it) if the step repository can load it; if it cannot, that is recorded.

## Risks / Trade-offs

- Conservative: never-run CSV pipelines are denied (`row-estimate-unavailable`). Intended; loosen on evidence.
- `lastRunRowCount` is output rows, not input rows; a filter-heavy pipeline under-estimates. Accepted for v1.
- An unimplemented AI op row may not deserialize at read; D8 surfaces it instead of assuming.

## Planner Notes

Self-approved: thresholds 10_000/20; `sql` counts as remote; `upsertsource` denied; verdict omitted from concise and
proposal modes; no migration (V108 stays free).

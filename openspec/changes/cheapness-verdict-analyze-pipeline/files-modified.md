# Files modified — HEL-1092

- `backend/src/main/scala/com/helio/domain/engine/PipelineCostEstimator.scala` — new pure
  estimator (`CostInput`/`RootCost`/`CostReason`/`CostVerdict`, `CheapOps`/`AiOps`/`WriteBackOps`,
  `MaxAutoRunRows`/`MaxAutoRunSteps`), design.md D1-D5. **Cycle 2 (skeptic-final-1.md CR1):**
  `CheapOps` changed from `PipelineStep.Registry.keySet -- WriteBackOps` (derived) to a
  hand-maintained literal `Set[String]` — a derived allowlist would have silently absorbed any
  future `Registry` addition (e.g. HEL-1107's `convertformat`) as auto-runnable-cheap the instant
  it's registered, with zero code change and zero review attention here, which is the inverse of
  "deny by default." Comment updated to match.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — added `countDatasetRows`, a grouped `count(*)` over `dataset_rows` for the estimator's row
  estimate (design.md D7).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyze` now
  builds `PipelineCostEstimator.CostInput` from enabled steps + resolved roots +
  `summary.lastRunRowCount`, calls `estimate`, and populates the new `costVerdict` field.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — added
  `CostReasonResponse`/`CostVerdictResponse` + formats; `PipelineAnalyzeResponse.costVerdict`
  (`jsonFormat5` → `jsonFormat6`).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — updated
  the two existing hand-built `PipelineAnalyzeResponse` fixtures for the new required field; added
  a `costVerdict (HEL-1092)` describe block (task 4.4: allow, `rest_api` deny, AI-op-row record).
- `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala` — new: the
  ticket's failable AC probe (task 4.1). **Cycle 2 (skeptic-final-1.md CR2, tasks.md C4):** the
  tautological "`CheapOps shouldBe (Registry.keySet - "upsertsource")`" test (asserted the derived
  production formula equals itself, unfailable by construction) replaced with a real
  completeness/partition test (`(registered -- classified) shouldBe empty` + pairwise-disjoint
  checks) and a regression proving `estimate` denies with `unclassified-op` for a
  registered-shaped op present in none of the three named sets.
- `schemas/pipelines/pipeline-analyze-response.schema.json` — `costVerdict` required, `CostReason`/
  `CostVerdict` `$defs` with a closed 9-code `code` enum, `additionalProperties: false` (task 2.4).
- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `CostReason`/`CostVerdict` +
  `PipelineAnalyzeResponse.costVerdict`.
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`,
  `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added `costVerdict` to
  hand-built `PipelineAnalyzeResponse` fixtures to satisfy the now-required field (typecheck fix,
  not requested new coverage).
- `helio-mcp/src/types.ts` — added `CostReasonResponse`/`CostVerdictResponse` +
  `PipelineAnalyzeResponse.costVerdict`.
- `helio-mcp/src/context.test.ts` — added `costVerdict` to hand-built `PipelineAnalyzeResponse`
  fixtures (build fix, mirrors the frontend fixture updates).

## Root cause note (per skeptic-design-1.md / brief, not a bug fixed in this change)

**Symptom anticipated by design.md D8, confirmed live by task 4.4's third test
(`PipelineAnalyzeRoutesSpec`, "records that a persisted analyzewithai row cannot reach the
estimator..."):** a persisted `analyzewithai` step row makes `GET /pipelines/:id/analyze` 500,
never reaching `costVerdict` computation at all.

- **Root cause:** `PipelineStepRepository.rowToDomain` (called from `listByPipelineInternal`,
  `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:1321`)
  wraps `PipelineStepConfigCodec.decode` in a `Try`; for `op = "analyzewithai"`,
  `PipelineStep.companionFor("analyzewithai")` (`PipelineStep.scala`) returns `Left` because
  `analyzewithai` has no `Registry` entry (HEL-1105 unshipped) — the codec's `Try` catches that as
  a `Failure`, and `rowToDomain` re-raises it as a thrown `IllegalStateException`, failing the
  whole `analyze` `Future` (→ 500).
- **Probe:** `PipelineAnalyzeRoutesSpec` — direct SQL `INSERT INTO pipeline_steps (..., op, ...)
  VALUES (..., 'analyzewithai', ...)` (V107's CHECK constraint permits the value; no real API path
  can produce this row, since request-time validation gates on `PipelineStepKind.All`), followed by
  `GET /pipelines/:id/analyze`.
- **Probe output:** `500 Internal Server Error`; server log:
  `java.lang.IllegalStateException: PipelineStepRepository: failed to decode config for step
  ...(op='analyzewithai'): Unknown step op: 'analyzewithai'. Valid values: aggregate, assert,
  cast, ... window` (full backend test suite run, see below).
- **Out of scope, not fixed here:** per tasks.md C3 and the ticket's non-goals, `analyzewithai` is
  classified by op-name string only and is never implemented/registered in this change. Decode
  behavior is unchanged. This is recorded per design.md D8 ("record if it can't load, not assume")
  and matches skeptic-design-1.md's independently-confirmed prediction of this exact failure mode.

## Verification (fresh, this run)

Cycle 1:
- `sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"` — 16/16 passed.
- `sbt "testOnly com.helio.api.routes.pipelines.PipelineAnalyzeRoutesSpec"` — 28/28 passed (route
  probe: allow, `rest_api` deny, AI-op-row 500 record).
- `sbt test` (full suite) — 4372/4372 passed, 0 failed.
- `npm run check:schemas` — schemas in sync with `JsonProtocols` (95 checked), no drift.
- `npm run typecheck` — clean (after fixing 3 pre-existing hand-built `PipelineAnalyzeResponse`
  fixtures for the new required field).
- `npm --prefix helio-mcp run build` — clean (after fixing 2 pre-existing fixtures).

Cycle 2 (skeptic-final-1.md CR1/CR2, C4):
- `sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"` — 17/17 passed (16 original +
  1 net new after replacing the tautological D2 test with 2 real tests).
- Mutation evidence (task 4.3, C2, C4): `openspec/changes/cheapness-verdict-analyze-pipeline/mutation-evidence.md`
  — M1 and M2 re-run against the new `CheapOps` shape, both RED then reverted; M3 (new: remove
  `"filter"` from the literal `CheapOps`, C4's mandated mutation target) RED then reverted;
  post-revert green.
- `sbt test` (full suite, after cycle-2 edits) — 4373/4373 passed, 0 failed (1 net new test vs.
  cycle 1's 4372, matching the replacement of 1 tautological test with 2 real ones).

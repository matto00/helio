# Evaluation Report — Cycle 1 (CS2c-1 foundations)

## Status

**APPROVED** — 0 blockers, 3 non-blocking notes (all pre-flagged spinoffs).

The branch (`task/backend-domain-adts/HEL-236`, 2 commits ahead of main) delivers exactly what the rescoped `proposal.md` and `ticket.md` describe: a `PipelineRunId` value class, two new `PathMatcher1[T]` segments, and pipeline-repository signatures narrowed to value-class IDs end-to-end. The wire shape, AuthService, JSON formatters, frontend, schemas, and OpenSpec are all untouched. Every verification gate is green and the test count matches the baseline.

## Phase 1: Spec / ticket alignment — PASS

| Acceptance criterion (proposal.md / ticket.md) | Verified by | Result |
|---|---|---|
| `PipelineRunId` value class in `domain/model.scala` | `model.scala:322` `final case class PipelineRunId(value: String) extends AnyVal` | PASS |
| `PipelineStepIdSegment` and `PipelineRunIdSegment` in `IdParsing.scala` | `IdParsing.scala:18–19` | PASS |
| Pipeline / PipelineStep / PipelineRun repos accept value-class IDs only | Walked every public method below | PASS |
| All call sites thread value-class IDs | Service / routes / Spark / 5 tests, walked below | PASS |
| `sbt test` — 511 passing, 0 failures | `sbt test` 32s, 511 succeeded | PASS |
| `npm test` — 664 passing | 58 suites, 664 tests | PASS |
| `npm run lint` zero warnings | Clean | PASS |
| `npm run format:check` clean | Clean | PASS |
| `npm run check:schemas` passes | `6 checked across 10 protocol files` | PASS |
| `npm run check:openspec` clean | `openspec/ is clean` | PASS |
| `npm run check:scala-quality` passes | 18 soft size warnings; **all pre-existing**, none from this change | PASS |
| AuthService byte-identical to main | `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` empty | PASS |
| No wire shape change | Only `IdParsing.scala` changed under `api/protocols/`; no `*Protocol.scala` touched | PASS |

The `tasks.md` checklist matches what shipped: tasks 0.* and 1.* are `[x]`; the 2.* verification block is `[x]`; spinoff items 3.* are `[ ]` and clearly marked as forward-looking. The rescope commit (`5364554`) cleanly renames the change folder and rewrites the three narrowing docs while preserving the full-CS2c `design.md` with a scope-note banner for CS2c-2/CS2c-3 to inherit. No silently reinterpreted criteria.

## Phase 2: Code review — PASS

### 1. Pipeline ID narrowing — confirmed

`PipelineRepository` (every public method):
- `exists(id: PipelineId)`, `findById(id: PipelineId)`, `findSummaryById(id: PipelineId)`
- `updateName(id: PipelineId, name: String)`, `delete(id: PipelineId)`, `updateLastRun(id: PipelineId, ...)`
- `create(name: String, sourceDataSourceId: DataSourceId, outputDataTypeName: String, ownerId: UserId)` — the cross-repo `DataSourceId` is narrowed too, matching the proposal

`PipelineStepRepository`: `listByPipeline(pipelineId: PipelineId)`, `insert(pipelineId: PipelineId, op, config)`, `update(id: PipelineStepId, ...)`, `delete(id: PipelineStepId)`

`PipelineRunRepository`: `insertRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt)`, `updateRunTerminal(runId: PipelineRunId, ...)`, `insertDryRun(runId: PipelineRunId, pipelineId: PipelineId, ...)`, `deleteOldRuns(pipelineId: PipelineId, keepN)`, `deleteOldDryRuns(pipelineId: PipelineId, keepN)`, `listByPipeline(pipelineId: PipelineId)`

No `String` ID parameter remains on any of the three repos. `.value` unwraps appear only at the Slick column-comparison boundary (`pipelineId.value` used as a single binding) — the typed ID stays in scope and is reused, no unwrap-then-rewrap pattern.

### 2. Call-site coverage — confirmed

- `PipelineService.scala`: every repo call previously taking `pipelineId.value` now passes the typed `pipelineId`. `addStep` / `updateStep` / `deleteStep` use `PipelineStepId`. The only remaining `.value` calls are in error message interpolations (`s"Pipeline not found: ${pipelineId.value}"`), which is the correct pattern.
- `PipelineRunRoutes.scala`: the `pidValue: PipelineId` alias added at line 42 is threaded through every repo call (`findById`, `listByPipeline`, `updateLastRun`, `insertRun`, `deleteOldRuns`, `insertDryRun`, `deleteOldDryRuns`, `listByPipeline`). `runId: PipelineRunId` is threaded through every `pipelineRunRepo` call.
- `PipelineStepRoutes.scala`: route now uses `PipelineStepIdSegment` for the step-id path; `pipelineService.updateStep(stepId, ...)` / `deleteStep(stepId)` receive the typed ID directly.
- `SparkJobSubmitter.scala`: `runId = PipelineRunId(runIdStr)` constructed once at line 45 and reused for all four repo calls (`insertRun`, `updateRunTerminal` x2). `pipeline.id` (already `PipelineId`) passed directly to `pipelineRepo.updateLastRun`, `pipelineRunRepo.insertRun`, `pipelineRunRepo.deleteOldRuns`.
- 5 test files (`PipelineRepositorySpec`, `PipelineRunRepositorySpec`, `SparkJobSubmitterSpec`, `PipelineRunRoutesSpec`, `PipelineAnalyzeRoutesSpec`): each `seedPipeline()` helper now returns `PipelineId`; URL construction uses `${pid.value}`; comparisons against row IDs use `.value` once at the boundary. Clean.

### 3. `PipelineRunId` value class — confirmed

`final case class PipelineRunId(value: String) extends AnyVal` (line 322), identical shape to `PipelineId` (line 311) and `PipelineStepId` (line 321) directly above. Placed adjacent to its sibling `PipelineStepId` for grep-ability.

### 4. `IdParsing.scala` segments — confirmed

```
val PipelineStepIdSegment: PathMatcher1[PipelineStepId] = Segment.map(PipelineStepId(_))
val PipelineRunIdSegment:  PathMatcher1[PipelineRunId]  = Segment.map(PipelineRunId(_))
```

Identical pattern to the existing five segments. Vertical alignment was re-tabulated to accommodate the longer names — purely cosmetic.

Note: `PipelineRunIdSegment` is added but not yet referenced by any route (run IDs in `PipelineRunRoutes.scala` still come through `Segment` because the cache is `String`-keyed and the run-events SSE registry is `String`-keyed). This is fine — it's a foundation for CS2c-3 when the run-lifecycle decomp happens, and the segment being unused now is no different from `PipelineIdSegment` being defined before all routes adopted it.

### 5. AuthService unchanged — confirmed

`git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` produces empty output. Security path untouched.

### 6. No wire shape touch — confirmed

`git diff main -- backend/src/main/scala/com/helio/api/protocols/` shows only `IdParsing.scala` modified (path matcher, not JSON formatter). No `*Protocol.scala` file changed. `npm run check:schemas` confirms `schemas in sync with JsonProtocols (6 checked across 10 protocol files)`.

### 7. FQN compliance — confirmed

`npm run check:scala-quality` returns clean (only soft file-size warnings, all pre-existing). Manual sweep of the 14 modified files: every new symbol used (`PipelineId`, `PipelineStepId`, `PipelineRunId`, `DataSourceId`, `slick.jdbc.JdbcBackend`, etc.) is imported at the top of the file. No inline FQN was introduced.

Caveat: the test files (`PipelineRunRoutesSpec`, etc.) contain pre-existing `java.util.UUID.randomUUID().toString` inline-FQN sites — these were already grandfathered through the hook (the hook reports clean), and the diff adds a couple more in the same pre-existing style for consistency. **Not a regression**; cleanup is a separate concern.

### 8. `pid: String` shadow in `PipelineRunRoutes.scala` — verified legitimate

The executor flagged this; I confirmed each usage of `pid` (the `String`) and each usage of `pidValue` (the typed ID):

- `pid: String` appears 7 times, all in: error message string interpolations (`"Pipeline not found: " + pid`), `registry.publish(pid, ...)` (the SSE registry is `String`-keyed), and `registry.subscribe(pid)` (same).
- `pidValue: PipelineId` is used for every repo call (10 sites).

The shadow is real foundation behavior — the SSE registry being `String`-keyed is an out-of-scope refactor for CS2c-1. No call into the new typed-ID repo signatures is using the `String` form, which is what the narrowing required. This is exactly the minimal-churn pattern the executor described in spinoff #3.

### 9. `PipelineService.AllowedOps` missing `"aggregate"` — confirmed latent, pre-existing

Grep of `PipelineService.scala` line ~12 shows `AllowedOps` lists 9 ops; `InProcessPipelineEngine.applyAggregate` (line 216) handles the `aggregate` op. The branch did not introduce or touch `AllowedOps` — this is a pre-existing latent bug correctly flagged for CS2c-2 / HEL-141 follow-up. No regression from this PR.

### 10. Code quality observations

- `SparkJobSubmitter.submit` returns `Future[String]` (line 91) — the wire/cache key remains `String`-typed because the `PipelineRunCache` and the HTTP response (`RunSubmitResponse.runId: String`) are String-keyed. The `runIdStr` shadow inside `submit` is a clean way to construct the typed `PipelineRunId` once and reuse it for repo calls. Tightening the cache to `PipelineRunId` is correctly deferred to CS2c-3.
- The diff is genuinely behavior-preserving: every call site changes from `repo.method(pid.value, ...)` to `repo.method(pid, ...)` (or constructs the typed ID once at the boundary). No business logic, control flow, or error handling was altered.

## Phase 3: Smoke / verification — PASS (per orchestrator brief, no Playwright required)

| Gate | Result |
|---|---|
| `sbt test` | 511 succeeded, 0 failed, 0 canceled, 0 ignored — matches baseline |
| `npm test` | 664 passed across 58 suites |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm run check:schemas` | `schemas in sync with JsonProtocols (6 checked across 10 protocol files)` |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm run check:scala-quality` | clean (18 soft size warnings, all pre-existing) |
| `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` | empty |
| `git diff main -- backend/src/main/scala/com/helio/api/protocols/` | only `IdParsing.scala` |

Playwright not run (foundations PR with no functional surface, per orchestrator brief). `sbt run` health check not needed — the test suite includes integration coverage through `PipelineRunRoutesSpec` and `PipelineAnalyzeRoutesSpec` against an embedded Postgres, which exercises the narrowed repo signatures end-to-end.

## Non-blocking notes

1. **`PipelineService.AllowedOps` missing `"aggregate"`** — pre-existing latent bug, correctly flagged for CS2c-2 / HEL-141 spinoff. No action required for CS2c-1.
2. **`PipelineRunRoutes.scala` `pid: String` shadow** — kept by design to minimize CS2c-1 churn; the SSE registry and error-message paths are still String-keyed and will be addressed in CS2c-3's `PipelineRunService` extraction.
3. **`PipelineRunIdSegment` is defined but currently unused** — intentional. Becomes the matcher for the `runs/:runId` route once the run-lifecycle decomp lands in CS2c-3.

None of these affect this PR. They're forward markers for CS2c-2 and CS2c-3.

## Recommendation

Push the branch and open the PR. The foundations work is clean, behavior-preserving, and lands the type-safety baseline that CS2c-2 (DataSource ADT + wire shape evolution) and CS2c-3 (PipelineStep + Panel ADTs) need before they introduce wire-contract changes.

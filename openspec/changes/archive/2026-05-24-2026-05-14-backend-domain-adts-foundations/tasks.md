# Tasks — backend-domain-adts-foundations (CS2c-1)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md`
- [x] 0.3 Read memory: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `project-backend-architecture-remodel.md`

## 1. Foundations (the entire scope of CS2c-1)

- [x] 1.1 Add `PipelineRunId` value class in `domain/model.scala`
- [x] 1.2 Add `PipelineStepIdSegment` and `PipelineRunIdSegment` to `api/protocols/IdParsing.scala`
- [x] 1.3 Narrow `PipelineRepository` / `PipelineStepRepository` / `PipelineRunRepository` signatures to value-class IDs (`PipelineId`, `PipelineStepId`, `PipelineRunId`, plus `DataSourceId` on the cross-repo lookup)
- [x] 1.4 Update call sites: `PipelineService`, `PipelineRunRoutes`, `PipelineStepRoutes`, `SparkJobSubmitter`, 5 test files — all threading value-class IDs
- [x] 1.5 `sbt compile` then `sbt test` — full green (511 tests, was 511 before)
- [x] 1.6 Commit: `HEL-236 CS2c foundations: PipelineRunId value class + segments + repo ID narrowing` (commit `96e392e`)

## 2. Verification gates

- [x] 2.1 `sbt test` — 511 passing, 0 failures
- [x] 2.2 `npm test` — 664 passing (frontend untouched; runs as baseline)
- [x] 2.3 `npm run lint` — zero warnings
- [x] 2.4 `npm run format:check` — clean
- [x] 2.5 `npm run check:schemas` — passes
- [x] 2.6 `npm run check:openspec` — clean
- [x] 2.7 `npm run check:scala-quality` — passes (18 pre-existing soft warnings, none from this change)
- [x] 2.8 AuthService.scala unchanged: `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` shows no diff
- [x] 2.9 No wire shape change: no JSON formatter or protocol modified

## 3. Spinoff candidates (captured for CS2c-2 / future tickets, NOT addressed here)

- [ ] 3.1 `PipelineService.AllowedOps` is missing `"aggregate"` even though the engine (`InProcessPipelineEngine.applyAggregate`) supports it. Latent bug or pending HEL-141 wire-up. Track and resolve in CS2c-2 or as a HEL-141 spinoff.
- [ ] 3.2 Inner-vs-left-join default — historically `"inner"` (verified in `InProcessPipelineEngine.applyJoin`); codify in `JoinStep.scala` header comment when CS2c-3 lands the JoinStep ADT subtype.
- [ ] 3.3 `PipelineRunRoutes.scala` `pid: String` shadow variable — kept alongside `pidValue: PipelineId` in CS2c-1 to minimize churn. Clean up when CS2c-3 decomposes the route into `PipelineRunService`.

## 4. Commit / PR handoff

- [x] 4.1 Single commit on `task/backend-domain-adts/HEL-236`: `96e392e`
- [ ] 4.2 Evaluator review
- [ ] 4.3 Orchestrator handles push + PR — do not push from executor

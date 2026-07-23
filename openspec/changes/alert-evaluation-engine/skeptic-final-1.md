## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...9900debe --stat` (the HEL-466 implementation commit; `c25abf40` is confirmed tooling-only — restores `scripts/concertino/start-servers.sh`'s nohup env-prefix fix, zero overlap with ticket code, not reviewed as implementation). Read every changed production file in full: `AlertEvaluationService.scala` (new, 147 lines), the `AlertEventRepository.resolveInternal` addition, `PipelineRunService.onRunSuccess`'s hook wiring, `ApiRoutes.scala`/`Main.scala` wiring.

- **AC 1 — exactly one active AlertEvent on breach, dedup honored; clear transitions to resolved**: `AlertEvaluationService.evaluateRule` breach branch calls the pre-existing (HEL-455) privileged `AlertEventRepository.upsertFiringInternal`, whose dedup path was not touched by this diff (verified: `git diff` shows no changes to `upsertFiringInternal`, only the new `resolveInternal` addition). Clear branch calls the new `resolveInternal` (`AlertEventRepository.scala:203-227`), which correctly special-cases `Snoozed` as a no-op (matches `AlertEventStateMachine.transition`'s legal-edge table, which only accepts `Resolve` from `Firing`/`Acknowledged`, never `Snoozed`) rather than attempting an illegal transition. Traced to tests: `AlertEvaluationServiceSpec` "create a firing event on breach", "dedup a repeated breach — no duplicate, value refreshed", "auto-resolve an active firing event once the condition clears"; `AlertEventRepositorySpec` "resolve an active firing event" / "resolve an active acknowledged event" / "leave an active snoozed event untouched and return None".

- **AC 2 — failed run creates no events; evaluation exceptions never fail/rollback the run**: `PipelineRunService.onRunSuccess` is only reached on success (verified by reading `executeRun` — the failure path never calls `onRunSuccess`). The `alertEvaluation` val wraps `evaluateForDataType` in `.recoverWith { ... Future.successful(()) }` (`PipelineRunService.scala:341-349`), and `AlertEvaluationService.evaluateForDataType` itself wraps each rule's evaluation in `.recover { case NonFatal(e) => ... }` before `Future.sequence` (`AlertEvaluationService.scala:99-112`) — two independent isolation layers. Traced to a **real, non-mocked failure test** (not just an assertion): `PipelineRunRoutesSpec` "still succeeds and records the run as succeeded when evaluation fails" subclasses `AlertRuleRepository` to throw `RuntimeException`, drives a real `onRunSuccess` failure, and asserts `status shouldBe StatusCodes.OK` + `last_run_status = "succeeded"` read directly from Postgres. "invokes no alert evaluation and creates no events" confirms the failed-run case with `findActiveByRule(ruleId) shouldBe None`. I re-ran this exact suite (see below) and it passes.

- **AC 3 — single-row scalar and column-aggregate metrics across all six comparators**: `extractMetric` (`AlertEvaluationService.scala:56-63`) handles count-sentinel (`*`), single-row scalar, and multi-row sum-aggregate paths; `breaches` (`:65-73`) is an exhaustive match over all six `Comparator` cases (confirmed against `Comparator`'s case objects in `model.scala:413-419` — `Gt/Gte/Lt/Lte/Eq/Neq`, no wildcard, so a 7th comparator would be a compile error, not a silent miss). Comparator-matrix test explicitly covers the ticket's called-out edge case: `svc.breaches(10.0, Comparator.Lte, 10.0) shouldBe true` (lte-breaches-at-equality). Metric extraction and comparator evaluation are tested as independently-exhaustive pure functions (`private[services]` visibility for direct test access) rather than a full cross-product matrix — sufficient given `evaluateRule` composes them via simple `.map`, no interaction logic to hide a bug.

- **AC 4 — evaluation runs against exact in-memory rows, no stale re-read**: `onRunSuccess` calls `alertEvaluationService.evaluateForDataType(outputDataTypeId, resultRows, ...)` using `resultRows: Seq[Map[String, Any]]` — the same in-memory value already used for `schemaUpsert`/`binaryRefsUpsert` above it, never re-queried from the repository. `numericValue`'s pattern match (Int/Long/Float/Double/BigDecimal, no String coercion) is the correct counterpart to `resultRows`' pre-JSON-serialization Scala types (`PipelineRunService.inferFieldType` uses the identical type universe for boolean/integer/double, confirmed by reading both functions side by side).

- **AC 5 — ScalaTest coverage + `sbt test` green**: independently re-ran (not trusted from the evaluator's paste):
  ```
  cd backend && sbt "testOnly com.helio.services.AlertEvaluationServiceSpec com.helio.infrastructure.AlertEventRepositorySpec com.helio.api.routes.PipelineRunRoutesSpec"
  → Total number of tests run: 76
  → Tests: succeeded 76, failed 0, canceled 0
  → All tests passed.

  cd backend && sbt test   (full suite, fresh run)
  → Total number of tests run: 1624
  → Tests: succeeded 1624, failed 0, canceled 0
  → All tests passed.  (62s)
  ```
  Matches the evaluator's claimed 1624/1624 exactly — no anomaly, no re-run needed beyond this single reproduction.

- **Other gates**: `npm run check:scala-quality` → "clean (54 soft warning(s))" (file-size soft-budget warnings only, informational per CONTRIBUTING.md, consistent with the evaluator's characterization). `npm run check:schemas` → "schemas in sync" (no schema changes expected/found). `npm run check:openspec` → only flags "complete but not archived" (expected pre-archive state). The project's `concertino.config.json` gates list only `backend-test` (`sbt test`) as mandatory for `backend/**` changes — already reproduced above.

- **Wiring fix (`Main.scala`/`ApiRoutes`) scope check**: `git diff` confirms this is a minimal, documented addition (`val alertEventRepo = new AlertEventRepository(ctx)` + one named-arg pass-through), pre-declared in `proposal.md`/`design.md` as an in-scope gap found during planning (HEL-455 left `alertEventRepo` unconstructed in `Main.scala`, silently defaulting to `null` in production). Not a debugged "bug fix" requiring a probe-confirmed root cause under `.concertino/laws/systematic-debugging.md` — it's a static wiring omission caught by code reading, not a runtime symptom investigation; the law's "applies_to: executor" scope for debugging doesn't require a regression test for `Main.scala` (not unit-tested in this codebase), and the fix's effect is verified by the domain tests exercising `AlertEventRepository` normally.

- **No frontend changes**: `git diff main...9900debe --name-only | grep frontend` → zero matches. Phase 4/UI design judgment is correctly N/A; no browser session needed.

### Verdict: CONFIRM

### Non-blocking notes
- `AlertEventRepository.scala` is now 288 lines, over the 250-line soft budget (informational, not a gate) — same note the evaluator raised; agreed it's non-blocking given `check:scala-quality` treats it as informational and 54 other files already exceed it repo-wide.
- The comparator matrix and metric-extraction tests are exhaustive as independent pure functions but do not literally cross-test "aggregate metric x each of six comparators" as one combined case per comparator. Given `evaluateRule`'s trivial composition (`extractMetric(...).map(v => breaches(v, comparator, threshold))`), this is low-risk, but a follow-on ticket touching this file could tighten it with a couple of combined integration cases for completeness.

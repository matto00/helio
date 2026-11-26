## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b63a84c6c72209122de2c0eb1487a5b502f3019b`, live base `c939f378146d5614be8e8c4cc12b9466dae08b15` (resolve-review-base.sh).
Backend-only diff: 6 production files, 5 new specs plus 2 test-support files, and mechanical `actor =` churn in about 65 existing specs.
Evaluator evidence (durable copies):
- fresh red run on the red commit 353dd3f78: `/home/matt/Development/helio/.concertino/runs/HEL-1882/evidence/.concertino/scratch/HEL-1882/eval1/redbase.txt`
- the four-mutation run: `.../eval1/mut1.txt`
- the `guard = None` mutation run: `.../eval1/mut2b.txt`
- the targeted HEAD run: `.../eval1/targeted.txt`

### Phase 1: Spec Review — PASS
Issues: none.
- **C1 (pipeline side only):** honored. No panel, dashboard or form-submit code is touched.
- **C2 (X2 rule):** `updateOwned` reads the row's `pipeline_id` and runs `requireAction` in the same user-context transaction. `OutputService.update` maps `PipelineWriteAccessRevoked` to the existing `404 Output not found`. The probe (x2-probe.txt) matches design.md Context.
- **C3 (insight refresh):** the check runs at the top of `renderGuarded`, before `findByIdInternal`, any `noSend` row, the quota charge or the send. Only `refresh` passes `requester = Some(user)`. Run-triggered and tick renders pass `None`, and a GUARD test covers that.
- **C4 (refusal answers the existing response):** no new status, lock, `FOR SHARE` or migration.
  - D1 maps the refusal to `Forbidden("Forbidden")`, which equals the `Forbidden()` default (ServiceError.scala:24). Otherwise it gives the pre-check's exact `NotFound("Pipeline not found")`. The GUARD tests assert both route bodies.
  - No `ServiceError.Forbidden(` producer was added, and ExistenceNotLeakedRoutesSpec passes.
- **Only one non-race behaviour change:** X2, the downgraded-creator PATCH, now answers 404.
  - The D2 start check refuses only an actor who is not owner or editor. Every backfill caller (create, update, the patch-set `backfillCreated`) is already an owner or editor.
  - The test churn adds only `actor =` arguments and imports. I grepped the added and removed lines; apart from that, the only change is moving RaceLocks out of PipelineGrantRecheckRaceSpec.
- **Planning artifacts:** all tasks are ticked and match the code. `openspec validate --strict` reports the change valid, and check-openspec-hygiene.mjs is clean. The MODIFIED DELETE requirement matches openspec/specs/output-routes-api/spec.md:594.

### Phase 2: Code Review — FAIL
Gates (my own run):
- **`sbt testFull`, 10 CI-style shards** (`HELIO_TEST_SHARD_COUNT=10`, lane DB, `-J-Xmx3g`, nice 19):
  - 801 of 801 suites completed, none aborted.
  - 10,564 tests succeeded, 0 failed.
  - 5 tests were canceled. All are measurement-only or `HELIO_MEASURE` cases (heap/p50 reports) and unrelated to this change.
- **`check-scala-quality.mjs`:** clean (soft warnings only). The script does not cover `org.scalatest.*`; see the finding below.
- **Targeted HEAD run:** 7 suites, 124 tests, 0 failed. It covered the new specs, PipelineGrantRecheckRaceSpec and ExistenceNotLeakedRoutesSpec.

Red and mutation verification (fresh, not trusted from the handoff):
- **Fresh red run** on commit 353dd3f78 (the red commit, before the fix): 15 red tests and 18 green guards. Each red fails for its stated reason:
  - D1: "the Output was created: Right(...)".
  - D2: "snapshot rows written: Vector(...)".
  - D3: a 200 with `name "renamed"` / changed config, and `Right(updated)` in the race case.
  - D4: `Wrote(Ok,true)` with `sends=1`.
  - None of these is a 4xx caused by a bad request body.
  - The red specs are byte-identical at HEAD (`git diff 353dd3f78 HEAD` on them is empty).
- **Commit order:** the commits before the red commit change no production logic. f4ecb3a5d is test-only, and 27aaabc5d only adds a no-op render observer.
- **Mutations, removed together** (D1 insert check, D3 updateOwned check, D2 start check, D4 render-start check):
  - Every D1, D3 and D4 red test turns red, and all guards stay green.
  - D2 (a) turns red only on "overwriteRows calls 1 was not equal to 0". This confirms the zero-calls assertion pins the start check on its own, because the in-transaction guard still kept the rows empty.
- **Mutation `guard = None`:** D2 (b) turns red ("snapshot rows written"), and (a) stays green.
- **D3 runs on the NOBYPASSRLS role:** `DraftSaveApiFixture` extends `TwoUserRlsApiFixture`, whose app role is `helio_app_test NOBYPASSRLS`. The patch-set spec uses the same fixture.

Issues:
1. **[mechanical] CONTRIBUTING.md:70, "Always import at the top of the file; never inline a fully-qualified name".**
   - Violation: `backend/src/test/scala/com/helio/services/insights/InsightRefreshGrantRecheckSpec.scala:26` has `... with org.scalatest.BeforeAndAfterEach with InsightRenderFixture`. The pattern was copied from InsightRenderServiceSpec:32, which is not part of this diff.
   - This is the only inline FQN in the added lines (grepped).

Other checks, all fine:
- **DRY:** reuses HEL-1707's `PipelineWriteAccess` and `PipelineWriteRefusal`, and RaceLocks is extracted rather than copied.
- **Error handling:** the `recover` cases match only `PipelineWriteAccessRevoked`.
- **Logs:** they name the Output or pipeline and the access value, never a user email.
- **Type safety:** no untyped escapes.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. The deltas live under `openspec/changes/`, and no server was started.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/insights/InsightRefreshGrantRecheckSpec.scala:26`: replace `with org.scalatest.BeforeAndAfterEach` with `with BeforeAndAfterEach`, and import it at the top (for example change line 9 to `import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}`). This is the CONTRIBUTING.md:70 Imports & Qualifiers rule. No other change is needed; re-run that spec file.

### Non-blocking Suggestions
- `PipelineRunBackfill.scala` `evaluateAndPersist`: the extracted body keeps its old, deeper indentation. Re-indent it for readability if you touch the file again.
- `check-scala-quality.mjs` does not flag `org.scalatest.*` inline FQNs, which is why the hook missed issue 1. Consider extending its prefix list (that belongs in a separate ticket, not this one).

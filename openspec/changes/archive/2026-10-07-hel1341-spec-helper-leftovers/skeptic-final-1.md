## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: bcc922cb804ffb18e72558600b28b5e86aece5be. Diff base resolved live by `resolve-review-base.sh` (main/origin): 575a58b1f537cc4e79013b196afaf1d1ade020fd. One commit is in range. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/hel1341-spec-leftovers/HEL-1357`.

### What I verified (with evidence)

- **AC1: the helper rename is behaviour-preserving.**
  - Evidence: `git diff 575a58b1f...HEAD -- backend`.
    - In `AcceptRecordingListener.scala`, only the method name and the two scaladoc references changed. The body (sentinel socket, a bounded `awaitCondition` on `accepted.contains(sentinelPort)`, returning `(acceptedPorts, sentinelPort)`) is unchanged.
    - At all 4 call sites (SqlConnectorRebindingSpec:49 and :84, SqlConnectorConfigShapeSpec:63, SqlEgressSocketFactoriesSpec:30), only the identifier changed. Each caller's `accepted shouldBe List(sentinelPort)` is untouched.
  - A grep for `assertNothingAcceptedBeforeSentinel` outside `archive/` and this change dir finds nothing.
  - The new scaladoc is accurate: the method genuinely does not assert, and a sentinel that is never accepted is missing from the returned list, so the caller's assertion fails.
- **Guard-is-failable: I reproduced it independently rather than trusting the executor's log.**
  - The executor's `evidence-mutation-red.log` shows the failure but not the mutation, so I mutated SqlEgressSocketFactoriesSpec myself. I inserted `new java.net.Socket(loopback, listener.port)` before the barrier and ran `nice -n 19 sbt testOnly ...SqlEgressSocketFactoriesSpec`.
  - Result: exit 1, `List(43698, 43700) was not equal to List(43700) (SqlEgressSocketFactoriesSpec.scala:32)`, so the stray port before the sentinel is caught by the caller's assertion.
  - I reverted with `git checkout -- <exact file>` and confirmed the backend tree is clean (`git diff --quiet HEAD -- backend`).
  - Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1357/evidence/openspec/changes/hel1341-spec-helper-leftovers/skeptic-mutation-red.log`
- **AC2: the test description matches what the test checks.**
  - The test is at DatasetWriteAutoRunEndToEndSpec:279 and is now called "fire a debounced auto-run through the real system clock, creating exactly one run".
  - Its body uses the real clock with a 1 s debounce, runs `pollUntil` with a 10 s state wait, then asserts `runCount(pid) shouldBe 1`. Elapsed time is printed only when `HELIO_MEASURE=1`. That matches the new name.
  - It sits inside a `should` block (line 251), so the report line reads correctly as "should fire ...". Only the name line changed.
- **AC3: inventory rows 22 and 23, and the corrected sentence, checked against the live tree.**
  - Row 22: `whenReady` appears only at PipelineShapeServiceSpec:29, :35 and :45, which is also the only `ScalaFutures` mixin in the test tree. `PipelineShapeService.expand` returns `Future.successful` (PipelineShapeService.scala:51-57), so it is harmless.
  - Row 23: SparkJobSubmitterSpec:345 is `eventually(timeout 30000 ms, interval 50 ms)` inside `awaitRunPersisted`. Lines :165 and :337 are 30 s `Await.result` calls. These are bounded state waits, so it is harmless.
  - Corrected sentence ("no `eventually` remains on the default"): every `eventually` in `backend/src/test` either passes an explicit timeout (PipelineRunRegistrySpec:136, OutputRoutesSpec:769, SparkJobSubmitterSpec:345) or sits in a spec that overrides `patienceConfig` to 2 s / 20 ms (AssistantTelemetrySpec:59, AuthoringTelemetrySpec:68). The claim is true.
  - Both additions are labelled as HEL-1357. The original 469f4ea93 statement is kept in the past tense rather than rewritten.
- **Gates.**
  - I ran the 5 affected suites fresh at HEAD (`nice -n 19 sbt testOnly` for SqlEgressSocketFactories, SqlConnectorRebinding, SqlConnectorConfigShape, DatasetWriteAutoRunEndToEnd and PipelineShapeService). Result: exit 0, 5 suites, 53 succeeded, 0 failed. Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1357/evidence/openspec/changes/hel1341-spec-helper-leftovers/skeptic-green.log`
  - `npm run check:openspec`: "openspec/ is clean", exit 0.
  - Prettier on the archived design.md: clean.
  - For the full suite I relied on the evaluator's `testFull` (6085/6085), which is backed by a saved transcript. The change only renames test-code identifiers, so the targeted re-run covers every affected path.
- **No UI changes**, so step 4 does not apply. No production code was changed.

### Verdict: CONFIRM

### Non-blocking notes
- The executor's red log does not record the mutation diff itself. My reproduction above covers that gap.
- `evaluation-1.md` is untracked in the worktree. That is the orchestrator's housekeeping, not a defect in this change.

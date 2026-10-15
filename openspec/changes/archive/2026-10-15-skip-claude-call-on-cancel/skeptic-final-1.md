## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 0ec43636089920bd9207825430eb1942db9fbfaa. Base 10d8626cc3816fd4e8ec643c2c1ebace5d268ead, resolved live with `resolve-review-base.sh` (exit 0).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/stream-authoring-cancel-before-call/HEL-1609`.

### What I verified (with evidence)

- **Diff scope** (`git diff $BASE_SHA...HEAD --stat`). Production changes are limited to two files:
  - `DashboardAuthoringService.scala`: a new `lazyStreamAttempt` (`Source.lazySource(() => streamAttempt(...)).mapMaterializedValue(_ => NotUsed)`). Both `Right` branches now call it: `startStreaming` (line ~171) and `continueStreaming` (line ~226).
  - `DashboardAuthoringRoutes.scala`: a scaladoc-only change.
  - `streamAttempt` is now referenced only from `lazyStreamAttempt` (grep). The `Left` branches and `startBuffered`/`continueBuffered` are untouched.
- **AC1 (no call after cancel)**:
  - The billed `claudeClient.stream` (line 376) runs only when `streamAttempt` builds its Source.
  - That now happens only when the inner `lazySource` is materialized and demanded. `futureSource` never materializes it after a downstream cancel.
  - This matches design D1.
- **AC2 (red/green, deterministic)**:
  - The two cancel tests (first turn and continued turn) have no sleeps and no `eventually`. Each one uses a gated repo, waits for `reached`, cancels the queue, waits for `watchTermination`, releases the gate, then drains to quiescence on a single-thread EC.
  - **Red, reproduced by me:** I temporarily changed both `lazyStreamAttempt(` call sites back to the eager `streamAttempt(` and ran `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.proposals.DashboardAuthoringServiceSpec"`:
    - Result: 28 run, 26 succeeded, 2 failed.
    - Failures: `1 was not equal to 0 (DashboardAuthoringServiceSpec.scala:836)` for the first turn and `1 was not equal to 0 (DashboardAuthoringServiceSpec.scala:861)` for the continued turn.
    - Both read tests stayed green.
    - The sbt log shows this worktree's build path.
    - I reverted with `git checkout`, and `git diff --quiet HEAD` confirms the tree is clean.
  - **Green after revert:** 28 run, 28 succeeded.
- **AC3 (read path)**:
  - Both "still deliver the terminal Result" tests assert exactly one `Result` event and `streamInvocations == 1`.
  - They pass both on the fix and on the eager code, so this behavior is preserved.
- **AC4 (gates and charging)**:
  - The route diff is a scaladoc-only change, and the gate wiring and `guardAndCount` are untouched.
  - The scaladoc states the charging semantics: the daily counter is charged at admission, before the 200, for every admitted request whether or not the body is read, with no refund on cancel. The billed call is made only by a live stream after grounding or load finishes. A disconnect after the call has started does not abort it.
  - The `lazyStreamAttempt` doc and the spec delta say the same.
  - The new `ClaudeRoutesChatGateSpec` test, "charge an admitted ?stream=true request at admission, without the body being read", asserts `usage(f) shouldBe Some(1)` with a status-only read. It passes.
  - The existing tier, 429 and 503 gate tests are unchanged and pass.
- **AC5 (buffered path)**: not in the diff.
- **D5 sweep**:
  - I grepped every `?stream=true` in the backend tests.
  - The `DashboardAuthoringRoutesSpec` and `AuthoringTelemetrySpec` stream tests drain `responseAs[String]`.
  - The `ClaudeRoutesChatGateSpec` tests that count transport calls drain the body or are 403/503 paths. The status-only owner test asserts only `usage == None`.
  - No count was relaxed.
- **Targeted suites, run fresh by me**: `testOnly` on DashboardAuthoringServiceSpec, ClaudeRoutesChatGateSpec, DashboardAuthoringRoutesSpec and AuthoringTelemetrySpec. Exit 0, `Total number of tests run: 61`, 61 succeeded, 0 failed. The log shows this worktree's build path and fresh JVM forks with current timestamps.
- **Full suite**: I did not re-run it. The evaluator's pasted output is unambiguous: two shards, both exit 0, 8133 succeeded, 0 failed, 4 canceled, in this worktree. It matches the executor's figure.

### Verdict: CONFIRM

### Non-blocking notes
- The new admission-charge route test is a guard, not a red-first test: it also passes on the unfixed code. That is correct for an "unchanged semantics" claim, and it is worded as such.
- `DrainableEc.drainToQuiescence` only sees work queued on the test EC. The reproduced red shows the current path is covered, but a one-line comment stating this assumption would help future editors (the evaluator suggested the same).
- File sizes are over the ~400-line guideline: the spec is 907 lines and the service 464. Mention a split proposal in the PR body, per CONTRIBUTING.md.

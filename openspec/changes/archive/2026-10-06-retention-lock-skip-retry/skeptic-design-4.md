## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/retention-lock-skip-retry/HEL-1343`. HEAD is `2c1884ac5b2cc2578320ace4a21e37b32df5c603`, and the only untracked content is the change dir.
- **Prior CRs, checked against the artifacts rather than taken on trust:**
  - **r1 CR1 (retry red proof by mutation, plus the post-success slot assertions):** present in D5.1 and in tasks 3.2 and C5.
  - **r1 CR2 (deterministic reverse-direction test with FOR UPDATE on X):** present in D5.4 and task 3.6.
  - **r1 CR3 (MODIFIED "Tiered time-bucket retention"):** present.
  - **r2 CR1 (output-snapshot-history delta):** the diff against `openspec/specs/output-snapshot-history/spec.md` changes only the requirement body and the "another in progress" scenario. All other scenarios are kept verbatim and none is renamed.
  - **r2 CR2 (task 3.1 names the `LockBusy` exception):** present.
  - **r3 CR1 (partial lock-held skip and failure precedence in spec):** the ADDED requirement states both rules. It has the "Only the payload purge is skipped" and "A failure and a lock-held skip" scenarios. The MODIFIED requirement says "any part of which", and the WHEN of "Second tick…" is reworded with its title kept.
  - **r3 non-blocking items:** the doc-comment updates are now task 2.2a.
- **`openspec validate retention-lock-skip-retry --strict`:** "Change 'retention-lock-skip-retry' is valid".
- **Design claims checked against the live code (all match):**
  - `OutputHistoryRetentionService.scala:34,61-65`: `claim` CASes `lastAttempt` before the repo call.
  - `:56-59`: `purgePayloads` swallows its error into `Unit`.
  - `OutputHistoryRepository.scala`: `guarded` returns `DBIO.successful(0)` on try-lock false, and the order is `purgeByAge.flatMap(a => thin…)`.
  - `NodePayloadHistoryRepository.scala:117-122`: a shared try-lock is taken before the trim.
  - `:178-183`: `purge` has the exclusive try-lock.
  - `V116:62`: `payload_id … ON DELETE SET NULL`, which is what makes the reverse-direction red mechanism (the cascade waits on rows retention has deleted) real.
- **Callers:** I grepped every caller of `thinAndPurge` / `purge` / `purgeIfDue` / the constructor. D2's list is complete, including the `NodePayloadHistoryRetentionSpec:113` `purge` override and the `PipelineSchedulerServiceSpec:292` override.
  - `NodePayloadWiringSpec:131-142` uses only the 5-arg constructor, `fromEnv()` and `purgeIfDue … shouldBe defined`, and calls no repo directly. The plan keeps all of these source-compatible.
  - `build.sbt:107` `testForkedParallel := false` supports D2's claim that suites run serially.
- **Other capability specs:**
  - `node-payload-history/spec.md:53-68` ("deferred while retention runs, removed by a later pass") is not contradicted.
  - The `output-history-retention` requirements "failures never fail the tick", "privileged pool" and "env config" are consistent with the plan.
  - No other spec states the hourly cadence or a `0` return.
- **Constraints:**
  - No migration is planned.
  - There are no planned edits to `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts` or `.gitignore`.
- **Red proofs:**
  - **D5.1 retry (drop-shortening mutation):** this is genuinely red. A successful pass returns `Some(n)`, while the mutated code returns `None` (not due) at `t0+retry`.
  - **Payload-only LockBusy case:** genuinely red for the same reason.
  - **D5.4:** red when the guard is removed, because the cascade waits on retention's deleted rows.
  - **D5.2 failure-hourly and the D4 combined case:** NOT red as specified. See CR1.

### Verdict: REFUTE

### Change Requests

1. **D5.2 / task 3.3: the failure-cadence tests cannot go red under the mutation the plan names. Assert on invocation count, not on `purgeIfDue`'s return value.**
   - D5.2 specifies "stub repo that throws: `purgeIfDue(t0 + retry)` → `None` (not run)". `purgeIfDue` returns `None` both when not due and when it ran and failed (`OutputHistoryRetentionService.scala:40,49-52`).
   - Under the shorten-on-failure mutation, the throwing stub is called again at `t0+retry` and still yields `None`, so the test stays green. The same holds for the D4 case (history throws + payload `LockBusy` → "full interval"): a mutation that shortens on any `LockBusy` regardless of failure re-invokes the throwing stub, which again returns `None`.
   - As written, C5's "red via a mutation that shortens on failure" is unachievable. Its fallback, "otherwise labelled guard", would then admit a guard that cannot fail under the exact defect it exists to catch. That is the HEL-1272 hourly-failure property the driver made binding.
   - Required fix in design.md D5.2 and task 3.3 (and C5 if worded the same):
     - The stubs count their invocations, and every "not run" step asserts that the count is unchanged. Alternatively, the stub fails on its first call and succeeds on its second, so a premature run is observable as `Some(_)` / deleted rows.
     - Assert the run at `t0 + interval` by the count incrementing, not by the return value.
     - Apply the same rule to the D4 combined-case stub. Its red is shown under a mutation that ignores the failure flag when shortening.
   - With this change both reds are mechanically achievable, so drop the "otherwise labelled guard" escape for these two cases.

### Non-blocking notes

- **D5.1 runs on `OutputHistoryRetentionServiceSpec`'s `DbContext(db, db)`, which is shared with other tests in that suite.** Clean the tables first, as the neighbouring tests do (`:103`), so that "exact survivors" is exact.
- **D3's cap `min(lockRetry, purgeInterval)`:** with `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1`, retry equals the interval, so the retry is a no-op. This is correct, but worth one line in the CLAUDE.md row.

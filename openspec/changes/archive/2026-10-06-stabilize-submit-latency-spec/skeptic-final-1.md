## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Reviewed HEAD:** `1d31abf3c4d61c83cea3eb09a77b38a40e79a917`.
**Review base:** `5a914c75cc74ddbaf98e0047b01d2ca0dad86efa`, resolved live with `resolve-review-base.sh` (exit 0).
**Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/latency-spec-contention-flake/HEL-1344`.
**Scratch logs:** they live in `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/`. My own logs there are prefixed `skep1344-`.

### What I verified (with evidence)

**The diff.** `git diff BASE...HEAD` touches one source file, `backend/src/test/.../DatasetWriteSubmitLatencySpec.scala`. Everything else is in the change dir. There is no product code and nothing in `ci.yml`, `playwright.config.ts` or `.gitignore`, so C4 holds. The branch has three commits: 45c6e61db (the fix), 9b2c6f1cd (merging main) and 1d31abf3c (docs only).

**The owner ruling behind C5 is genuine.** In `.concertino/runs/HEL-1344/events.jsonl`:
- Line 17 is `escalation.raised`, id `HEL-1344-1791288728100-91200a`, options `proceed-with-documented-non-repro,raise-worker-cap-for-one-probe,halt`.
- Line 18 is `escalation.answered`, answer `proceed-with-documented-non-repro`, `answer_source: human`, `resolution_channel: chat`, with the same id.
- C5 in `tasks.md:7` matches the ruling.

**AC1 (probe; reproduction replaced by a documented non-reproduction under C5).** I checked the scratch logs myself:
- **P4:** 21 `hel1344-p4-r*.log` files, 63 `P4 ... before p50` lines, 0 with `inversion=true`. All 21 runs show `succeeded 3, failed 0`. There are 0 `triggerAutoRun failed` lines, and every `afterDenied` entry is 2.
- **P1 and P1b:** 26 runs, every one `succeeded 3, failed 0`, and none contain `was not greater`.
- **P1b smallest gap:** I recomputed after-p50 minus before-p50 over all 60 test lines. The smallest is +51ms (replaceRows, `p1b-run13.log`), which matches probe.md.
- **P3:** both `p3-burst0.log` and `p3-burst1.log` say `PROBE-REPEAT-TOTAL ... failures=0/15`, so 0/30.
- **Verdict on AC1:** probe.md and proposal.md report these figures accurately. Under the owner's ruling, AC1 is met.

**AC2 and AC3 (opt-in or robust, threshold not loosened).** The p50 comparison is gone, not loosened. The deterministic check is at spec lines 200-209. The timed sampling sits behind `assume(Measure)` at line 213 and only prints. Nothing in it is asserted.

**AC4 (20 or more green runs under contention).** `g1-run*` and `g2-run*` contain 26 `Tests: succeeded 3, failed 0, canceled 3` lines. The summary files record load averages of about 5-8.

**I ran the gates myself, on HEAD:**
- **Default mode.** `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly ...DatasetWriteSubmitLatencySpec"`: exit 0, `succeeded 3, failed 0, canceled 3`. The 3 cancels are the `HELIO_MEASURE=1` report tests. Log: `skep1344-default.log`.
- **Opt-in mode, both specs in one JVM.** `HELIO_MEASURE=1 HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt "testOnly ...DatasetWriteSubmitLatencySpec ...OutputFilteredMetricMeasurementSpec"`: exit 0, `succeeded 7, canceled 0`.
  - The six `HEL-1096 submit-latency` lines printed. Before/after p50 was 10/28, 6/23 and 6/23 ms.
  - HEL-1326's measurement printed too: 46ms added.
  - The env var therefore reaches the forked JVM for both specs. Log: `skep1344-measure.log`.
- **Full suite.** I did not re-run `testFull`. I read the evaluator's `eval1344-c2-testFull.log` instead. It shows `succeeded 6081, failed 0, canceled 4`, 0 "Java heap space" lines and no FirstRunRoutesSpec failure or timeout. The 4 cancels are exactly the 3 HELIO_MEASURE tests here plus HEL-1326's one.
  - That the log was run on merged code does not depend on file mtime: it contains the HEL-1326 spec, which exists only after the merge 9b2c6f1cd.
  - 1d31abf3c changed docs only, so this run covers HEAD's code. The log's mtime (16:22) is later than HEAD's commit time (16:08), but I treat that only as corroboration.
- **My own runs:** neither shows a FirstRunRoutesSpec timeout or "Java heap space". Neither suite was involved in a run that included FirstRunRoutesSpec.

**Mutation evidence.** I read `mutation-red.log`: 3/3 FAILED at `:207`, each with `Vector() was not equal to Vector(PipelineId(..), PipelineId(..))`. `mutation-restored-green.log` shows `succeeded 3`. The diff against base contains no product code, which confirms the mutation was reverted.

### Answers to the orchestrator's three questions

**1. Is the `HELIO_MEASURE` gate compatible with HEL-1326's? Yes.**
- **Same value semantics.** Both use the identical expression `sys.env.get("HELIO_MEASURE").contains("1")`: `DatasetWriteSubmitLatencySpec.scala:75` and `OutputFilteredMetricMeasurementSpec.scala:33`. Only the exact value `"1"` enables either; `true`, `yes` and so on disable both.
- **Same skip behaviour.** Both gate inside the test body with `assume(...)`, so the test is CANCELED and never failed. The evidence is the 4 cancels in the evaluator's testFull and my opt-in run, where both specs ran together.
- **One difference, which is benign.** When enabled, HEL-1326's spec asserts a 500ms bar. This spec only reports. HEL-1326 also skips its harness in `beforeAll` when disabled. This spec still starts EmbeddedPostgres, because its deterministic test needs it.
- **No collision.** Setting the variable once runs both measurements, which is what you want.
- **design.md D3 is stale.** It says "`HELIO_MEASURE` does not exist anywhere in the repo yet" and "HEL-1326 may reuse it", and the Planner Notes repeat the claim. That was true of main at planning time and is false at HEAD: HEL-1326 landed first, with identical semantics. See non-blocking note 1.

**2. Do the new assertions guard the old check's intent with no wall-clock decision (C1)? Yes.**
- **The old intent.** The scaladoc gave it as catching "the awaited call accidentally becoming a no-op".
- **Why the new check catches that.** In `DataSourceService.scala:94-102`, `deniedPipelines` comes only from `autoRunTriggerService.triggerAutoRun(...)` after the write. That path runs `evaluateAndSchedule` per pipeline in `AutoRunTriggerService.scala:61-92`.
  - If the evaluation is skipped, the denials come back empty.
  - If it fails, `.recover` turns it into `Vector.empty`.
  - If it regresses to fire-and-forget, nothing reaches the response.
  - A per-pipeline failure (`evaluateOne` → `None`) drops that pipeline's id.
  - Each of these turns `:207` red, because it checks for exactly the 2 seeded AI ids. The mutation log shows the red.
- **No time value decides anything.** `System.nanoTime` appears only in `timed()` (`:181-185`). That is reachable only from `sampleAfterWarmup`, which runs only after `assume(Measure)`, and its output only feeds `println`.
- **C1 holds.**

**3. Does any committed text claim a reproduction or a proven root cause (C5)? No outcome claim, but the plan wording is still there.**
- **Outcome claims: none.**
  - proposal.md says "Not reproduced ... so the cause is unproven" and "Supported but unconfirmed".
  - probe.md says "Nothing here claims a reproduction or a proven root cause", H2 "unconfirmed because it was not reproduced", and H3 "Cannot be excluded".
  - The spec scaladoc says only "it flaked under a contended `testFull`", which is the observed HEL-1333 event.
  - The commit messages contain no claim.
- **Leftover plan wording.**
  - design.md: "Goals: confirm the root cause with a probe", "P2, confirm the mechanism".
  - tasks.md 1.1: "[x] P1: reproduce the flake ... record k/N failures".
  - tasks.md 1.2: "[x] ... discriminate H1 vs H2", which was not actually achieved.
- These read as the plan, not as results. C5 sits directly above them in the same file. See non-blocking note 2.

### Verdict: CONFIRM

### Non-blocking notes

1. **design.md D3 and the Planner Notes are stale about `HELIO_MEASURE`.** Lines around 63-66 and 92 say the name "does not exist anywhere ... yet", that this ticket introduces it, and that "HEL-1326 may reuse it". On main, HEL-1326 (659eec305) introduced it first, with identical semantics. Add a one-line erratum when archiving, for example: "Post-merge: HEL-1326 landed the same name first; semantics are identical (`contains("1")` + `assume`)."
2. **Annotate the ticked plan tasks.** tasks.md 1.1 and 1.2 are ticked `[x]` with wording that reads as achieved ("reproduce the flake", "discriminate H1 vs H2"). A short suffix such as "(performed; not reproduced, see probe.md / C5)" would stop an archive reader from mistaking the checkbox for an outcome.
3. **Inline FQN at `DatasetWriteSubmitLatencySpec.scala:160`.** `java.time.Instant` is written inline. The line was carried over, not authored here, but the diff re-adds it, and CONTRIBUTING.md "Imports & Qualifiers" says "always import at the top". There is also an unused `ExecutionContext` import at `:27`, which predates this change. Both have now been flagged by the evaluator twice.
4. **The base moved.** `origin/main` is now `e1aaf72f8`, one ahead of the resolved base. `resolve-review-base.sh` returned the merge-base `5a914c75c`. This needs a normal rebase or merge-readiness check before merge, which is not my call.
5. **Gate-defect check: nothing to record.** No report I relied on discloses unsound evidence mtimes. The evaluator's ordering claim, "the escalation came after P4", rests on log-content timestamps against event `t` values, not file mtimes. My own use of mtime is corroborated by content, as described above.

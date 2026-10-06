## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `45c6e61dbc27a22d8bef9a6b750bcee607606ca8` (base `9f92504af38913ebe23fedec117e6f39c39dcaa5`, resolved live via `resolve-review-base.sh`).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/latency-spec-contention-flake/HEL-1344`.
Scratch logs cited below are in the session scratchpad (`/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/`). That directory is shared with other lanes (HEL-1334 and HEL-1343 logs are in it too). Every file cited here was checked to belong to this worktree.

### Phase 1: Spec Review — FAIL

The code change itself is right: D2 and D3 are implemented as designed and C1 to C4 are honored. The phase fails on AC1 and on how honestly the root cause is stated.

**Ruling on AC1 ("Root-cause it with a probe, and reproduce it under contention"): not met as written.**

- **The flake was never reproduced.**
  - The unmodified spec ran 0/26 failing under pinned contention (`p1-run1..6`, `p1b-run1..20`).
  - The in-JVM repeat fallback ran 0/30 (`p3-burst0.log`, `p3-burst1.log`: `PROBE-REPEAT-TOTAL ... failures=0/15` each).
  - D1 did plan for this case (the in-JVM fallback, "states this method change plainly"). That makes the miss *disclosed*. It does not make it *met*.
- **The "supports H1" summary is not what the numbers show.** I re-derived these from the logs:
  - Unloaded, warm, before-first (`p0-warm.log`): before p50 is 11/6/6 ms and after p50 is 34/25/22 ms. The after path costs 3-4x the before path.
  - Uniform pinned contention (`p1-*`, `p2-baseline-*`): before p50 is 10-37 ms and after p50 is 77-133 ms. Contention widens the gap. It never closes it.
  - Warm-up bias on before (P2: baseline 31-37 ms vs swap 14-25 ms on appendFormRow) is about 10-20 ms. To invert the comparison, after p50 has to drop below before p50 minus 5, and warm-up is the wrong size to overcome a gap of +20-30 ms unloaded or +60-100 ms contended. Interleave (29-33 ms) barely differs from baseline.
  - The observed failure (before 36, after 25) only fits a **phase-differential** load: before p50 at its contended level (about 36, the appendFormRow cold/contended band) and after p50 at its unloaded level (22-34). That is H2, non-stationary contention. H1 may add to it, but on these numbers it cannot cause the inversion alone. The handoff states this backwards ("supports H1 … H2 not excluded").
- **An alternative was never ruled out (call it H3).** `DataSourceService.scala:94-102`: when `triggerAutoRun` fails, `.recover` logs an error and returns `Vector.empty`. A transient evaluation failure under contention would make the "after" write fast, and that is exactly the no-op regression the old assertion existed to catch. The original HEL-1333 transcript is gone; I searched the scratchpad for the failure string and found nothing. Without it, "no product defect behind it" is unproven.
  - Partial evidence against H3: the modified spec's count assertions ran green in 26/26 contended runs. That is 26 × 3 tests × 3 awaited writes = 234 awaited evaluations with no degrade. This counts only at the contention level tested.
- **The root cause is stated as fact.** `proposal.md` "Why" says: "The exact mechanism is pinned by probe (design.md D1). Either way it is a flake with no product defect behind it." Neither sentence is supported: nothing was pinned, and H3 is not excluded. skeptic-design-1 note 6 asked for this wording to be scoped as a hypothesis, and that was not done (the executor's handoff says so).

**Other Phase 1 items:**
- **AC2 and AC3 (opt-in or robust, no loosened threshold): PASS.** The wall-clock comparison is deleted, the count and id assertions replace it, and the measurement moves behind `HELIO_MEASURE=1` with report-only output. No owner latency requirement is dropped; the skeptic verified this, and HEL-1096 D2 only measures and reports.
- **AC4 (20+ green under contention): PASS on the evidence.** g1 ran 14/14 and g2 ran 12/12 (`g1-summary.txt`, `g2-summary.txt`), so 26/26. All runs show `succeeded 3, canceled 3`, with load averages between 2.7 and 8.6 and 3 burners whose PIDs were recorded (`burners*.pids`, `burn.sh`). One caveat: the default-mode spec no longer contains any timing, so this streak mainly proves the count assertion is stable under load (which matters for H3). It is not evidence against a timing flake.
- **Tasks 1.1 to 2.4** are all marked done. Each matches an artifact, except that 1.1's "reproduce" outcome was not achieved, as covered above.
- **Scope:** only `DatasetWriteSubmitLatencySpec.scala` and the change dir changed. No product code, `ci.yml`, `playwright.config.ts` or `.gitignore` was touched. **C4 holds.**
- **C1:** no wall-clock value decides pass/fail anywhere. The measure test only prints. **Holds.**
- **C3:** probe variants (`ProbeLatencyOrderSpec`) are not in the tree, and there are no scratch logs in the change dir. **Holds.**
- **C2:** 3 burners pinned to CPUs 0-1 at nice 19, plus one nice'd sbt, with PIDs recorded. **Holds.**
- **Commit contents (confirmed):** the commit includes the change dir with `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`, `skeptic-design-1.md` and `files-modified.md`. `workflow-state.md` is **not committed**. It is ignored through `/home/matt/Development/helio/.git/info/exclude:21` (`git check-ignore -v`), and `git status` is clean.

### Phase 2: Code Review — PASS

**Gates, run fresh by me:**
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0, `Tests: succeeded 6028, failed 0, canceled 3`. The only 3 canceled tests are this spec's `reports p50/p95 … (report-only; HELIO_MEASURE=1)` tests. No `FirstRunRoutesSpec` timeout or failure, and 0 "Java heap space" (`eval1344-testFull.log`).
- `HELIO_MEASURE=1 HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt "testOnly …DatasetWriteSubmitLatencySpec"` (plain `sbt`, no server running): `succeeded 6, canceled 0`. All six `HEL-1096 submit-latency [...]` lines printed: before 12/8/8 ms and after 46/33/30 ms p50 (`eval1344-measure.log`). These lines are emitted only after `assume(Measure)` passes inside the forked JVM, so this **directly** proves the env reaches the fork. It is no longer an inference.
- `npm run check:scala-quality`: clean. The file is 224 lines, under the 250-line soft budget.

**D2 conformance (deterministic, ids plus `ai-step`):**
- `DatasetWriteSubmitLatencySpec.scala:207` compares the sorted denied pipeline ids to exactly the 2 seeded AI ids returned by `seedFiveDownstreamPipelines`. That is an exact set and an exact count, so a coincidental count of 2 or any duplicate fails.
- `:208` checks that every denied entry's reason codes contain `ai-step`.
- `:205` checks that before is empty. It holds by construction and only documents the contrast; it is not counted as guard evidence (skeptic note 4).
- No clock is involved anywhere.

**Mutation evidence:** reviewed, not re-run, because the evaluator does not modify code.
- `mutation-red.log` shows the main classes recompiled, then 3/3 FAILED at `:207` with `Vector() was not equal to Vector(PipelineId(..), PipelineId(..))`.
- `mutation-restored-green.log` shows `succeeded 3, canceled 3`.
- The diff against base contains no product-code change, so the revert is confirmed.

**D3 and opt-in design:**
- 5 warm-up iterations per phase (`:72`, `:193-196`).
- The p95-growth report line over 200 ms (`:218-220`) is print-only.
- Canceled through `assume` is the right default-suite outcome. It matches the repo pattern (`SqlConnectorTlsSpec`, `PinnedPoolReuseSpec`), it is visible in the summary instead of silently passing, and it never fails.
- The scaladoc (`:43-48`) documents the opt-in and the `sbt --client` limitation. The limitation statement is accurate: the fork inherits the env of the already-running server, not the client's.

**Code quality:** DRY improves, with the three copy-pasted tests collapsed into one `fixture` and a `for` over the kinds. Naming is clear, and no magic values remain unnamed (`Iterations`, `WarmupIterations`, `CountIterations`, `P95GrowthReportMs`). No dead code was introduced.

### Phase 3: UI Review — N/A

This is a backend test-only change. No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: FAIL

### Change Requests

1. **Close AC1 with a phase-boundary reproduction probe (P4) on the UNMODIFIED spec.** This targets the mechanism the existing data actually points to.
   - **Variant:** a throwaway, never-committed copy of the base spec (`git show 9f92504af:backend/src/test/scala/com/helio/services/sources/DatasetWriteSubmitLatencySpec.scala`, renamed). Between each test's before loop and after loop, it touches a marker file in the scratchpad, then waits up to about 2 s for an ack file.
   - **Harness:** runs the 3 burners and, on seeing the marker, kills them **by their recorded PIDs** and writes the ack. It restarts them, with new PIDs recorded, before the next test's before phase.
   - **Pinning:** the burners must share cores with the forked test JVM. Start the sbt server itself under `taskset -c 0,1` (a fresh server, not a reused unpinned one), and record `taskset -p <forked JVM pid>` once in the log as proof.
   - **Caps:** at most 3 burners plus 1 nice'd sbt.
   - **Record for N ≥ 20:** k/N inversions, meaning `p50(after) < p50(before) - 5`, plus per-test before and after p50 with sample arrays. Also record, for H3, the count of `triggerAutoRun failed` log lines in each run's log and the after-phase denied count per write.
   - **If k > 0:** AC1 is met and the mechanism is phase-differential contention (H2), with H1 as a contributor to quantify.
   - **If k = 0 at N ≥ 20:** report it plainly. The orchestrator should then raise the literal "reproduce" AC to the owner as an escalation rather than ship with it silently reinterpreted.
2. **Rewrite `proposal.md` "Why" (skeptic-design-1 note 6, still open)** so it states only what the probes support.
   - Replace "The exact mechanism is pinned by probe (design.md D1). Either way it is a flake with no product defect behind it."
   - Give the measured magnitudes: unloaded after is 3-4x before; uniform contention widens the gap; the warm-up bias is about 10-20 ms.
   - Name the leading hypothesis (H2, phase-differential contention) as either reproduced or not, depending on CR1's result.
   - State H3's status: the silent `.recover` → `Vector.empty` path at `DataSourceService.scala:98-101`, excluded or not. The 234 contended awaited evaluations with zero degrades are admissible partial evidence.
   - Put a short probe summary, with numbers and k/N figures but no raw logs, in the change dir so it survives the scratchpad. C3 only forbids raw scratch logs. A distilled `probe.md` follows archive precedent (`archive/2026-10-06-rotate-credential-await-delete/probe.md`).
3. **Correct the handoff and PR-body framing.** The evidence does not show "P2/P3 support H1". Restate it as: warm-up bias is present (about 10-20 ms on before p50) but too small to invert a 20-100 ms gap; the inversion needs a loaded before phase and a quiet after phase. Then add CR1's outcome.

### Non-blocking Suggestions

- `DatasetWriteSubmitLatencySpec.scala:160`: `java.time.Instant` is an inline FQN, which CONTRIBUTING.md:70 says to avoid. The line was moved, not authored, in this diff, and `check:scala-quality` does not flag `java.time`. Import `java.time.Instant` at the top while the file is being touched.
- `DatasetWriteSubmitLatencySpec.scala:27`: `ExecutionContext` is imported but unused (this predates the change).
- `files-modified.md` is committed in the change dir, while recent archives do not carry it. Consider dropping it at archive time.

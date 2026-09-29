# HEL-1195: PipelineRunGuardIntegrationSpec failed again in a full local suite run, one day after HEL-1184's fix (test and assertion unrecorded)

## Description

origin_kind: followup
origin_ticket: HEL-1184

### What happened

During HEL-1188's final gate (2026-09-29, local full `sbt test` on head `069a11bd`), the result was **4882/4883**, with one failure in `PipelineRunGuardIntegrationSpec`. HEL-1188 doesn't touch that spec or `PipelineRunService`'s guard logic. The skeptic re-ran the spec **in isolation, 10/10 green**, and treated it as a pre-existing flake. GitHub CI on PR matto00/helio#707 was fully green.

**The failing test name and assertion message were NOT recorded**, and the worktree (and its `target/test-reports`) has since been cleaned up. So which failure it was is unknown.

### Why this isn't dismissible

HEL-1184 (merged `55ad1d6d`, 2026-09-28) exists because this spec's concurrency-cap test failed in CI and a lane dismissed it as timing, *a second time*. HEL-1184 root-caused a settlement-coordination race (probe: 6/230 → 0/200 after the fix) and replaced the DB poll with a `CountDownLatch` (`awaitAllSettled`, 5s timeout). A failure in the same spec one day later has three live explanations, with very different consequences:

1. **The HEL-1184 test failed with `4 was not equal to 3`**: the root cause was incomplete, and the "guard is fine" conclusion needs re-examining (though the independent 12-writer repository race test was mutation-proven).
2. **The HEL-1184 test failed on the latch timeout** ("N of the burst's submissions never settled"): 5s isn't enough under full-suite load. That's a test-reliability defect, not a guard defect. (Note: "isolated re-run green" is exactly the condition under which a load-dependent timeout won't reproduce.)
3. **A different test in the spec failed** (the slot-freeing test, the rate-limit tests), one HEL-1184 never examined.

## Acceptance Criteria

- `.concertino/laws/systematic-debugging`: reproduce under **full-suite load**, not in isolation. Loop the full backend suite, or the spec alongside a CPU/DB-contending workload, capped at 3-4 workers under `nice -n 19` (6c/12t desktop). **Capture the failing test name + assertion message + surefire/test-report XML** for every failure.
- Identify which of 1/2/3 it is (or something else) before any fix. Red-first proof; never loosen an assertion, add retries or sleeps, or just raise the timeout without showing the timeout is the mechanism.
- If 1: reopen the guard-correctness question against `PipelineRunRepository.insertRunIfUnderConcurrencyCap` (shipped in v0.8.4, bounds auto-run bursts).

## Process note

Lanes reporting a "flake" must record the test name and failure message verbatim before cleanup; "isolated re-run green" is not evidence for a load-dependent failure.

Driver-filed (fleet driver, 2026-09-29) from HEL-1188's `skeptic-final-1.md` (lines 124-132, 155-159).

## Investigation notes carried in from the driver's brief (not established facts — questions to probe)

- None of hypotheses 1/2/3 is established yet. "Isolated re-run green" does not favor hypothesis 2 over 1 or 3 under a load-dependent interleaving.
- The settlement latch (`awaitAllSettled`, `PipelineRunGuardIntegrationSpec.scala` lines 180-183, 282-296) counts down `onAdmitted` on entry to `GatedExecutionBackend.execute()`. Check whether any admitted path can fail to reach `execute()` under load, or reach it twice.
- Orchestrator-level premise check (see `premise-validation.md`) already found a concrete, previously-unexamined candidate mechanism: `PipelineRunService.executeRun` runs `deleteOldRuns` (an extra DB round-trip) between `insertRunIfUnderConcurrencyCap` resolving `Inserted`/`NotOwned` and `backend.execute()` actually being called — a gap that did not exist in HEL-1184's design.md/PR reasoning about "settlement signalled strictly before blocking on the gate," and one that could plausibly widen under full-suite DB contention. This is a *candidate*, not a conclusion — it must be probe-confirmed like everything else.
- The project already has an unrelated, pre-existing mitigation for full-suite contention: HEL-924 (`backend/build.sbt`) caps concurrent forked-JVM test groups at 4 (of 8 groups), specifically because unconstrained EmbeddedPostgres-backed suites previously caused CPU/IO contention severe enough to fail unrelated suites under full-suite load. Relevant background for why a full-suite repro might or might not reproduce contention-driven timing, not itself a hypothesis resolution.

## Standing constraints (fleet driver brief)

- Models: sonnet on ALL agents.
- Budget exhaustion is a MANDATORY escalation, never a self-approval, including the post-final-REFUTE re-eval loop.
- Re-run the evaluator after any final-REFUTE code fix. ANY commit after a final CONFIRM (including a merge from main) needs a fresh final-gate verdict.
- The evaluator must be discriminating: show the failure reproduces on the base commit (c740775e) under the same load conditions before accepting the fix.
- Any test failure seen in any gate anywhere gets its test name + message recorded verbatim. "Flaky, re-ran green" is not a finding.
- Never label anything an "owner ruling" unless it came from the owner via the driver, labelled as such.
- `timeout: 600000` on every Bash call running hooks, sbt, tests, or CI. For long loops, run them in the background and poll in-turn. Ending your turn is not waiting.
- Executors commit + write files-modified.md before yielding. No screenshots/artifacts at the repo root.
- Follow-ups: FILE before cleanup.sh (Follow-up label + `origin_kind: followup` / `origin_ticket: HEL-1195` + relatedTo, same call, read back).
- Absolute paths / `git -C` only. Never `gh pr merge --auto`. If any CI check fails, diagnose and report it with evidence.
- Migrations: V112 is free (no migration expected for this ticket).
- Hardware cap (repo-wide, CLAUDE.md): 6c/12t desktop, not a batch machine. At most 3-4 concurrent workers total, `nice -n 19`, never sized to core count. Prefer looping single full-suite runs one at a time over spawning many parallel heavy processes.

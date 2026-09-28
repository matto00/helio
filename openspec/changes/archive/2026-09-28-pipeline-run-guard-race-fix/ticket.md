# HEL-1184: Pipeline-run concurrency guard admitted 4 of 8 against maxConcurrent=3 in CI despite the gated-execution fix (recurrence)

## Description

origin_kind: followup
origin_ticket: HEL-505

### What happened

`PipelineRunGuardIntegrationSpec` — "rejects more than maxConcurrent REAL concurrent submissions with TooManyRequests" — failed in CI on HEL-588's PR #702 (run 36217357670, attempt 1, backend job 108335876857, 2026-09-26T04:22:30Z):

```
- should rejects more than maxConcurrent REAL concurrent submissions with TooManyRequests *** FAILED ***
  4 was not equal to 3 (PipelineRunGuardIntegrationSpec.scala:276)
```

8 concurrent REAL submissions against `maxConcurrent = 3` → 4 admitted. HEL-588 was a frontend-only diff; the lane called it "CI timing, unrelated" and re-ran (attempt 2 passed). Unrelated to HEL-588: yes. Benign timing: not established.

### Why this is not just a flake

This exact assertion failed the same way during HEL-505's own review (the test's comment: "4/8, then repro'd 6/20 under a pool of 3"). That was root-caused as "the same dataset-source pipeline completing early under contention, not a guard defect" and fixed by `GatedExecutionBackend`, which holds every admitted run in `queued` until `gate.success(())`, so a completing run can no longer free a slot mid-burst. It failed again, with the gate in place. So one of these holds:

1. The gate doesn't hold every admitted run (some path reaches a terminal state or leaves the non-terminal count before the gate), meaning the test's premise is wrong; or
2. The guard really admits `maxConcurrent + 1` under contention. The advisory-lock + live-count check in `PipelineRunService.submit` has a window (e.g. the lock is released before the admitted row is visible to the next counter's snapshot, or the lock key/transaction scope doesn't serialise all submitters). That's a prod defect: the guard shipped in v0.8.4 and bounds auto-run bursts (HEL-1097's proof depends on it).

## Required

* `.concertino/laws/systematic-debugging`: probe-confirm which of 1 or 2 it is before any fix. E.g. a forced-small-pool loop of this test (cap at 3-4 workers, nice -n 19), logging each admitted submission's lock acquire/release plus the count it observed.
* If 2: fix the guard so admission and count are serialised in one transaction under the lock; red-first proof via the loop.
* If 1: fix the gate/test premise, and prove the guard separately with a deterministic interleaving test.
* Never "fix" by loosening the assertion or retrying.

Driver-filed (fleet driver, 2026-09-26) from the HEL-588 CI log; related to HEL-588 (where it surfaced), HEL-505 (origin) and HEL-1097.

## Driver's unverified hypothesis (verify, do not assume)

`awaitQueuedCount(pid, user, maxConcurrent)` returns once 3 rows are `queued`, then `gate.success(())` releases them. Reaching count 3 does not obviously prove the remaining 5 submissions' admission decisions have all SETTLED. A straggler still waiting on the advisory lock could run its count AFTER gated runs completed and freed slots, and be admitted, giving 4. The helper's scaladoc (~line 161) claims stability "once reached"; that claim may be exactly the flaw. This is hypothesis 1. It is NOT confirmed. Hypothesis 2 (a real lock/transaction-scope window in the guard) is equally live until a probe rules it out. Also check whether both could be true.

## Standing constraints (from driver)

- Models: sonnet on ALL agents (orchestrator, executor, evaluator, skeptic, auditor). No opus/fable override, never promote a sub-agent.
- Migrations: V110 is latest on main. V111 is free if needed (probably not needed for this ticket).
- Budget exhaustion is a MANDATORY escalation, never a self-approval, including the post-final-REFUTE re-evaluation loop.
- After a final-gate REFUTE is fixed with code, re-run the evaluator before the final gate again (CON-228 pattern).
- Do not describe any decision as an "owner ruling" unless it came from the owner via the driver, labelled as such.
- Pass explicit `timeout: 600000` on every Bash call that can run hooks, sbt, or CI.
- Executors MUST run gates, COMMIT, and write files-modified.md before yielding.
- Follow-ups: file any standalone follow-up BEFORE cleanup.sh runs, with Follow-up label + origin_kind: followup / origin_ticket: HEL-1184 + relatedTo.
- Never "fix" by loosening the assertion, adding retries, or sleeping.
- A guard test must be failable by mutation — show the mutation.

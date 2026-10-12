# HEL-1511: After HEL-1504: orphaned runs block auto-run and schedules forever (run reaper); retry test gaps; misleading Superseded log

## Description

These follow-ups came from HEL-1504 (matto00/helio#960, 41db49cee). It made dataset-write auto-runs that land mid-run fire once after the run completes, and made guard-rejected auto-runs retry after Retry-After, capped by `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` (default 10), then drop with a WARN. V125 adds `guard_retry_count`.

1. **Run reaper:** a run whose `completed_at` is never set, for example after a crash mid-run, keeps an auto-run pending forever (one cheap check per tick). Scheduled runs already have the same blocker. Add a reaper that marks stale non-terminal runs failed after a bound, and reproduce it first.
2. **Test gaps** that the PR body admits:
   * no direct test of the 1-second Retry-After floor;
   * no test of several writes during one in-flight run;
   * the last assertion in case (d) is vacuous.
3. **Split** `PipelineRunRepository.scala` (641 lines). This overlaps HEL-1503 item 3.
4. **Logging:** the `Superseded` debug line attributes the outcome to a fresh write, but a stale claim taken over by another instance looks identical. Fix the wording.

Related: helio-news added a 45 s wait-and-rerun workaround for this bug, which it can remove once v0.9.4 is deployed.

## Scope of this run (owner-picked, via driver)

Items 1, 2 and 4. **Item 3 (the `PipelineRunRepository` split) is OUT of scope** and stays open on the ticket.

## Acceptance Criteria

- AC1 (repro, red first): a deterministic spec (embedded Postgres via `VerifiedEmbeddedPostgres.start`, `Clock` seam, no sleeps) shows that a non-terminal run row left behind by a simulated crash (status queued/running, `completed_at` NULL) blocks (a) a pending dataset-write auto-run, (b) a due schedule, and (c) counts against the owner's concurrency cap -- red on main before the reaper exists.
- AC2: after the staleness bound, the reaper marks the orphaned run terminal per the owner's rulings, and the same spec goes green: the auto-run fires, the schedule fires, and the cap slot is freed.
- AC3: a run that is still executing (e.g. a long Spark job) is never reaped, however long it runs -- proven by a test.
- AC4: multi-instance safe -- two concurrent reaper passes never double-reap, and a reap never races a live run's liveness signal (conditional update / lock), proven by a test.
- AC5: item 2 -- a direct test of the 1 s Retry-After floor; a test of several writes during one in-flight run (exactly one follow-up run); case (d)'s final assertion is made non-vacuous (failable by mutation).
- AC6: item 4 -- the `RearmOutcome.Superseded` debug line no longer attributes the outcome solely to a fresh write; it covers a stale claim taken over by another instance.
- AC7: no new migration number collision (V126 at time of writing; re-checked before commit). Any one-off prod-data cleanup of existing stuck runs beyond what the reaper itself does is an owner call.

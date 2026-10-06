## Context

`DatasetWriteSubmitLatencySpec` was added by HEL-1096 (task 3.4, C12, design.md D2) to measure the latency cost of
awaiting `triggerAutoRun`. D2 calls it "a measurement task, not an optimization one" and requires the numbers to be
reported in the PR body. The spec's scaladoc says it is "Not a pass/fail correctness gate". The executor added one
"loose sanity assertion" per test (`p50(after) >= p50(before) - 5L`) to catch a regression where the awaited call
silently becomes a no-op. HEL-1096 set no latency bound, so the assertion is executor-authored, not an owner
requirement.

Structure: each test runs 20 "before" writes (`serviceBefore`, no `AutoRunTriggerService`) and then 20 "after"
writes (`serviceAfter`, awaited) against fresh users and datasets. "Before" always runs first in every test.
`DataSourceServiceDeniedPipelinesSpec` already asserts deterministically, per call site (appendRows, appendFormRow,
replaceRows, patchRow), that the awaited evaluation's denials reach the response.

## Goals / Non-Goals

**Goals:** confirm the root cause with a probe before changing anything; remove the contention sensitivity from the
default suite without losing the guard's intent; keep the HEL-1096 measurement reproducible on demand.

**Non-Goals:** the general wall-clock audit (HEL-1341); any product-code or CI-config change.

## Decisions

**D1: Root-cause probe first (systematic-debugging law).**
Hypothesis H1: phase-order bias plus contention. The "before" phase runs first in each test, so it absorbs warm-up
(JIT of the write path, Hikari connection establishment, PG plan and buffer caches). Under CPU contention those costs
grow and can push `p50(before)` more than 5ms above `p50(after)`, even though the after path does strictly more work.
Probes, all against the UNMODIFIED spec on the branch base, under a contention harness of at most 4 workers in total
(the `nice -n 19` sbt run plus at most 3 CPU-burner processes, each PID recorded and killed only by PID):
- P1, reproduce: run the spec repeatedly under contention, and record runs, failures and the per-test failing
  assertion (with sample arrays). Report the rate as k/N.
- P2, confirm the mechanism: a throwaway, never-committed variant that swaps the phase order (after first), under the
  same harness, plus per-sample arrays showing whether the "before" outliers cluster at the first iterations. If H1
  holds, the inequality's failure disappears or inverts.
- P3, discriminate H1 from H2 (skeptic-design-1 note 1): H2 is non-stationary contention. The two phases are
  sequential ~0.5-1s windows that sample different load/GC conditions, and a p50 of 20 samples barely moves for a few
  front-loaded warm-up outliers. A throwaway INTERLEAVED variant (before/after alternating per iteration) under the same
  harness, plus the P2 per-sample arrays: front-loaded "before" outliers that vanish under swap favour H1; outliers
  spread across a phase that follow the swap and vanish under interleaving favour H2. The executor reports whichever
  the evidence supports (or both). D2 does not depend on which hypothesis wins.
- If P1 cannot reproduce at N >= 20 at the cap, the executor may estimate the rate cheaply with an in-JVM loop: a
  throwaway probe spec that repeats one test body many times in one JVM. The executor states this method change
  plainly. Increasing contention past the cap is not allowed.
If P2/P3 refute both H1 and H2, stop and report the actual mechanism before implementing D2. Debug budget: `DEBUG_ATTEMPTS`.

**D2: Replace the timing assertion with a deterministic count assertion (option a).**
Per test, for `appendFormRow`, `replaceRows` and `patchRow`: every "after" write's response carries exactly 2
`deniedPipelines` (the fixture's 2 `analyzewithai` pipelines; the owner writer can see both), and every "before"
write's response carries 0. Each after write's denied entries are also asserted to be exactly the 2 seeded AI
pipeline ids, each carrying reason code `ai-step` (skeptic-design-1 note 3), so a coincidental count of 2 from a
different defect cannot pass. `before == 0` cannot fail by construction (null trigger service) and is kept only as
documentation of the contrast. `after == 2 ids + ai-step` is the guard (note 4). This proves directly what the timing check was proxying: the after path performed and
awaited the downstream evaluation. Note that `triggerAutoRunAwaited` degrades to `Vector.empty` on failure, so a
broken evaluation also turns this red. The fire-and-forget path cannot produce denials, so a regression back to
fire-and-forget turns it red too. No time measurement remains in any pass/fail decision.
Alternative rejected: a looser threshold, or more iterations or warm-up with the same comparison. That is forbidden by
the ticket, and it still compares two noisy wall-clock distributions.
Alternative rejected: deleting the spec outright. That loses the on-demand HEL-1096 measurement.

**D3: Measurement behind opt-in `HELIO_MEASURE=1` (option b, report-only).**
With `HELIO_MEASURE=1` in the env, the spec also runs the timed sampling (20 iterations per phase, preceded by
5 discarded warm-up iterations per phase so the reported numbers are not order-biased) and prints the existing
`HEL-1096 submit-latency [...]` lines, plus a clearly labeled report line when p95 growth (after - before) exceeds
200ms, which is HEL-1096 D2's PR-body reporting trigger (note 2). It asserts nothing about timing. Without it, the timed sampling is skipped and
reported as ignored or canceled, never failed. The default-mode count assertions use a small iteration count (3 writes
per phase is enough to prove "every write"). `HELIO_MEASURE` does not exist anywhere in the repo yet, so this ticket
introduces the name. It is documented in the spec scaladoc; HEL-1326 may reuse it. The executor must verify the env var
actually reaches the forked test JVM (`build.sbt` forks tests).

**D4: Evidence.**
- A mutation proves the new guard can fail: temporarily make `triggerAutoRunAwaited` return `Future.successful
  (Vector.empty)`, show the D2 assertions go red on all three tests, then revert (never committed).
- 20+ consecutive green runs of the modified spec under the same contention harness as P1, as k/N.
- One `HELIO_MEASURE=1` run showing the report lines.
- One full `nice -n 19 sbt testFull` (Bash timeout 600000, `HEL924_TEST_GROUP_CONCURRENCY` at most 2), reporting any
  `FirstRunRoutesSpec` timeout or "Java heap space".
All logs go in the session scratchpad. Before/after rates and probe transcripts are summarised in the executor
handoff.

## Risks / Trade-offs

- [The default suite no longer sees a latency regression] → it never reliably could under contention; D3 keeps the
  measurement one env var away, and HEL-1096 set no bound to guard.
- [Overlap with `DataSourceServiceDeniedPipelinesSpec`] → accepted. The count assertion keeps this spec's own
  before/after contrast (0 vs 2) honest, which the other spec does not assert.
- [P1 may not reproduce at a meaningful rate] → D1's in-JVM loop fallback, stated plainly; never exceed the worker cap.

## Planner Notes

Self-approved: option (a)+(b) combined. The premise check confirmed that no owner-set latency requirement exists
(HEL-1096 D2 is measure-and-report), and that the guard's intent is covered deterministically, so no escalation was
needed. Self-approved: introducing the `HELIO_MEASURE` name here, since it exists nowhere yet. Self-approved: a small
default-mode iteration count.

## Erratum (archive time)

D3 and the Planner Notes say `HELIO_MEASURE` "does not exist anywhere yet". That was true of main at planning time,
but HEL-1326 (#805) landed first with the same gate (`sys.env.get("HELIO_MEASURE").contains("1")` + `assume`), so
this spec reuses that convention (skeptic-final-1.md Q1). Tasks 1.1/1.2 record the PLAN; their outcome is a
documented non-reproduction (probe.md, C5), not a reproduction or a confirmed mechanism.

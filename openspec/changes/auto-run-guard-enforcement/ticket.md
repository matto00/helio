# HEL-1097: Expensive-op guard interaction with auto-run

## Description

Auto-run creates a new way to trigger pipeline runs, which interacts with the rate-limiting work in HEL-505 (expensive-op guards for pipeline runs, source fetches, and LLM calls). Ensure an auto-run is subject to the same guards as a manual one and cannot be used to bypass them.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- A burst of writes cannot exceed the per-principal run budget.

## Premise-validation summary (Setup step 2 — see `.concertino/runs/HEL-1097/evidence/premise-validation.md` for full evidence)

Verdict: **no-drift**. The core machinery already largely satisfies this AC:

- Every auto-run fire (`PipelineSchedulerService.processAutoRunDebounce` → `fireAutoRun`) goes through `PipelineRunService.submit → executeRun`, which runs the SAME rate-limit (`pipeline_run_rate_window`, HEL-505) and concurrency-cap guard as a manual run, unconditionally on `triggerSource`. No alternate path was found that creates a `pipeline_runs` row or executes the engine from the dataset-write trigger while skipping this guard.
- A guard-rejected auto-run is already handled without crashing the tick or retry-storming: `fireAutoRun` catches `TooManyRequests`, logs it, and the debounce claim is unconditionally released (compare-and-delete) — a fresh debounce row requires a fresh dataset write, not a retry of the denied one.
- The debounce push-forward (`pipeline_auto_run_debounce`, V110) is DB-atomic and cross-instance-safe, but even if debounce collapsing is defeated (writes spread across windows, or split across instances), the rate-limit/concurrency guard is checked independently on every individual `submit()` call — the AC's burst proof does not depend on debounce holding.
- Production wiring confirmed: `PipelineSchedulerService` is constructed with `apiRoutes.pipelineRunService` — the SAME `PipelineRunService` instance the manual-run route uses, already carrying the live guard repo.

**Owner ruling (2026-09-24, on the Planning ESCALATION about per-principal charging):** `accept-owner-charged`. Auto-run keeps charging the pipeline owner's budget exactly as today (mirrors HEL-1108's non-manual-trigger precedent and matches the AC's literal text). The cross-principal fairness/DoS concern — a non-owner writer able to spend a disproportionate share of the owner's shared budget — is real but out of scope for this release-blocking ticket; filed as a standalone follow-up: **HEL-1173** ("Per-(pipeline, writer) sub-limit inside the owner's pipeline-run budget for auto-run"), including the owner's own arithmetic (debounce + tick interval ≈ 35s worst-case fire latency per pipeline; 5+ pipelines on one shared dataset can collectively exceed the default 10-runs/60s budget from write activity alone).

## Ticket-level scope (final, per the owner ruling)

Given the machinery already mostly exists (see premise-validation above) and the charging-fairness question is resolved (deferred to HEL-1173), this ticket's real deliverable is narrowly **proof plus closing any real gap found**, not new guard machinery:

1. **Proof that the AC holds even with the debounce DEFEATED** — writes spread across debounce windows, and/or two scheduler-tick "instances" sharing one DB — measured from `pipeline_runs` rows and guard state (`pipeline_run_rate_window`), never logs.
2. **Show the red** — a test/probe demonstrating what would happen if the auto-run path bypassed the guard (mutation-style: the guard check disabled/stubbed on the auto-run path), so the proof is falsifiable, not tautological.
3. **Confirm a guard-rejected auto-run releases its debounce claim cleanly with no retry storm** — count claims/fire-attempts across several ticks after a denial, verifying no repeated re-fire of the same denied write.
4. **Confirm/decide guard-rejection visibility** — today it is server-log-only (HEL-1093). Either make it visible somewhere an operator/person can find beyond a log line, or state plainly in the PR that it is log-only by design and let the gates judge that trade-off — do not silently assume either answer.
5. **Confirm there is no bypass** — verify every auto-run-adjacent path (retry, claim/release/reclaim, any other trigger of `pipeline_runs` creation from a dataset write) either reaches the guard or cannot create/execute a run.

If, after investigation, this genuinely turns out to be test/proof-only work with no production code change, that is the correct and honest outcome — say so plainly in the PR rather than inflating scope.

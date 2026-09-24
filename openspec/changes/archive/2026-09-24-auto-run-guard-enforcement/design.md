## Context

Premise validation (see `ticket.md`) confirmed in code that the auto-run fire path
(`PipelineSchedulerService.processAutoRunDebounce` → `fireAutoRun` → `PipelineRunService.submit` →
`executeRun`) already shares the exact rate-limit/concurrency guard every other trigger uses, and
that production wiring (`Main.scala`) confirms the scheduler holds the SAME `PipelineRunService`
instance (and guard repo) the manual-run route uses. The owner ruled (2026-09-24) that
owner-attributed charging stays as-is; cross-principal fairness is deferred to HEL-1173. See
proposal.md - Why for the full motivation.

## Goals / Non-Goals

**Goals:**
- Prove, with tests measured from `pipeline_runs` rows and guard state (never logs), that the AC
  holds even with the debounce coalescing defeated (writes spread across windows and/or two
  scheduler "instances" sharing one DB).
- Show a genuinely red case: a probe that fails when the auto-run path's guard check is bypassed,
  so the green proof is falsifiable rather than tautological.
- Prove a guard-rejected auto-run releases its debounce claim without retrying the same denial on
  every subsequent tick (count claims/fire-attempts across several ticks).
- Make an explicit, stated decision on guard-rejection visibility rather than an implicit one.
- Close any real gap found during execution with a targeted fix, not a broader redesign.

**Non-Goals:**
- The per-(pipeline, writer) sub-limit — HEL-1173.
- Any change to which principal is charged — already spec'd in `dataset-write-auto-run` and
  reaffirmed by the owner's ruling.
- New user-facing surfacing of a guard-rejected auto-run (see Decision 3 below).

## Decisions

**Decision 1 — "Debounce defeated" is simulated at the test level, not by disabling the debounce
in production code.** The proof needs to show the guard holds independent of the debounce, not that
the debounce can be turned off. Two independent test scenarios cover this: (a) writes issued with
gaps wider than `DATASET_WRITE_DEBOUNCE_SECONDS`, producing multiple real fires from one pipeline
in succession, each independently subject to the guard; (b) two `PipelineSchedulerService`
instances constructed against the SAME `PipelineRunGuardRepository`/`PipelineAutoRunDebounceRepository`
(both backed by the same test DB), each independently ticking, mirroring the real
multi-Cloud-Run-instance deployment `PipelineRunGuardRepository`'s own doc already claims to be
safe under. Alternative considered: mocking `AutoRunTriggerService.debounceSecondsFromEnv()` to
zero — rejected, because a zero debounce is not what "defeated" means for the AC's own burst
scenario (the debounce still coalesces same-instant writes; the risk is temporal spread, not a
literal zero window).

**Decision 2 — the "guard bypassed" red case is a standalone unit-level probe against
`PipelineRunService.executeRun`, not a toggle in production code.** Constructing a
`PipelineRunService` fixture WITHOUT a `pipelineRunGuardRepo` (the existing nullable-optional
convention every other collaborator in that class already uses) reproduces exactly the "guard off"
state the AC must never reach in production — and confirms the test suite's own burst assertions
would actually fail without the guard, closing the "evidence-shaped non-evidence" gap rather than
just asserting a tautology. This never touches production wiring (`Main.scala` always constructs
`pipelineRunGuardRepo` non-null), so it is a test-only red case, not a runtime toggle.

**Decision 3 — guard-rejection visibility stays log-only.** `dataset-write-auto-run`'s existing spec
already requires only "recorded (at minimum, logged)" for a guard-rejected auto-run, and
`fireAutoRun` already satisfies that. The ticket's own AC text ("a burst of writes cannot exceed the
per-principal run budget") does not require new user-facing visibility, and building any (an alert,
a UI badge, a run-history entry for a submission that never became a `pipeline_runs` row) would be
new machinery outside the "proof, not new guard machinery" scope the owner's ruling set. Self-approved:
document this explicitly rather than silently assume it, per the ticket's own scope item 4.
Alternative considered: adding a `blocked`-style entry to run history for a guard-rejected auto-run —
rejected as unnecessary scope growth on a release-blocking ticket; if this is wrong, the evaluator/
skeptic gates can catch it before delivery, and HEL-1173 remains fully able to absorb it if the
per-writer sub-cap work later decides operator visibility is needed anyway.

**Decision 4 — no-retry-storm proof drives `PipelineSchedulerService.tick()` directly across several
synthetic ticks** (not via the actor/timer), asserting `PipelineAutoRunDebounceRepository`'s row
state and `pipeline_runs` count after each tick — the same direct-repository-assertion style
`PipelineSchedulerServiceSpec`/`DatasetWriteAutoRunCoalescingSpec` already use, not a new pattern.

## Risks / Trade-offs

- [Risk] A test suite exercising two concurrent `PipelineSchedulerService` "instances" against one
  test DB could be flaky under real DB timing → Mitigation: rely on the DB-level atomicity already
  used elsewhere in this codebase (`UPDATE ... RETURNING` claim, `ON CONFLICT ... GREATEST` upsert),
  asserting on final row counts/state rather than interleaving-sensitive intermediate timing.
- [Trade-off] Keeping guard-rejection log-only (Decision 3) means an operator has no first-class
  view of a denied auto-run today → accepted, matches existing HEL-1093 spec text; revisit only if
  the evaluator/skeptic gates find the AC's literal text actually requires more.

## Migration Plan

None — no schema change. V111 remains free (confirmed with the coordinator).

## Planner Notes

Self-approved decisions (no external dependency, no breaking change, no scope beyond the ticket's
already-owner-ruled boundaries):
- Test-only scope, given premise validation found the guard machinery already correct (Decisions 1,
  2, 4).
- Guard-rejection visibility stays log-only (Decision 3) — stated explicitly per the ticket's own
  scope item 4, not silently assumed.
- Two small `MODIFIED Requirements` spec deltas (`pipeline-run-guard`, `dataset-write-auto-run`)
  making already-true-in-practice behavior explicit and testable, rather than leaving a spec/code
  gap where the spec claims uniformity but never names auto-run.

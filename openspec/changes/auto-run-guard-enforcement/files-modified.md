## Files modified (HEL-1097, cycle 1)

- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardBurstProofSpec.scala` — new spec (tasks.md 3.1/3.2/3.3): proves the AC holds with the HEL-1093 debounce coalescing "defeated" (writes spaced wider than the debounce window, each producing an independent claim-and-fire cycle), proves it still holds under two concurrently-ticking `PipelineSchedulerService` instances sharing one DB, and adds the falsifiable "guard bypassed" red case (a `PipelineRunService` fixture built without `pipelineRunGuardRepo`) that demonstrates the SAME burst would exceed the budget without the guard. Every assertion reads `pipeline_runs` row counts and `pipeline_run_rate_window.request_count`, never logs.
- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardNoRetryStormSpec.scala` — new spec (tasks.md 3.4): drives `PipelineSchedulerService.tick()` across several synthetic ticks after a guard denial, asserting the debounce claim is released on the SAME tick and never re-attempted on any later tick for the same denied write, and that only a fresh dataset write re-schedules a new attempt — reads `pipeline_auto_run_debounce`/`pipeline_runs` row state directly.
- `openspec/changes/auto-run-guard-enforcement/tasks.md` — checked off 1.1, 1.2, 2.1, 3.1-3.5 as complete (pre-existing planning artifact from the Planning phase; this cycle's only edit to it is the checkbox state).
- `openspec/changes/auto-run-guard-enforcement/files-modified.md` — this file (new).

### Planning-phase artifacts, committed alongside the above (not authored or edited this cycle, but not yet committed to the branch — see `git log` on this change dir showing no prior commit)

- `openspec/changes/auto-run-guard-enforcement/.openspec.yaml`
- `openspec/changes/auto-run-guard-enforcement/ticket.md`
- `openspec/changes/auto-run-guard-enforcement/proposal.md`
- `openspec/changes/auto-run-guard-enforcement/design.md`
- `openspec/changes/auto-run-guard-enforcement/skeptic-design-1.md`
- `openspec/changes/auto-run-guard-enforcement/specs/pipeline-run-guard/spec.md`
- `openspec/changes/auto-run-guard-enforcement/specs/dataset-write-auto-run/spec.md`

## No production code changed

Task group 1's fresh re-confirmation (tasks.md 1.1) found no gap: every path that can create a
`pipeline_runs` row or execute the engine from a dataset write —
`AutoRunTriggerService.triggerAutoRun`/`evaluateAndSchedule` (write-time half, upserts
`pipeline_auto_run_debounce` only, never calls `submit`/`executeRun`), and
`PipelineSchedulerService.processAutoRunDebounce`/`processAutoRunClaim`/`fireAutoRun` (fire-time
half) — reaches `PipelineRunService.submit(..., triggerSource = TriggerSource.AutoRun)` →
`runPipeline` → `executeRun`, the SAME unconditional rate-limit + concurrency-cap check (guarded on
`pipelineRunGuardRepo != null`, wired to a real repo in every production `PipelineRunService`
construction) every other trigger source reaches. No alternate route exists. Confirmed:

- `AutoRunTriggerService` (`backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala`) — its entire effect for an eligible pipeline is `debounceRepo.upsertDebounce`; it never calls `PipelineRunService` at all.
- `PipelineSchedulerService.fireAutoRun` (`backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala`) — the ONLY call site that fires an auto-run, and it calls `pipelineRunService.submit(...)` unconditionally.
- `PipelineAutoRunDebounceRepository.claimDue`/`releaseClaim` (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineAutoRunDebounceRepository.scala`) — claim/release is a debounce-table bookkeeping primitive only; it never creates a `pipeline_runs` row itself, and `releaseClaim` runs unconditionally after `fireAutoRun` regardless of outcome (fired/skipped/guard-rejected) — so there is no retry/reclaim path that bypasses `submit`.
- `Main.scala` (`backend/src/main/scala/com/helio/app/Main.scala`) — production wiring confirmed: `PipelineSchedulerService` is constructed with `apiRoutes.pipelineRunService`, the SAME `PipelineRunService` instance (and therefore the same non-null `pipelineRunGuardRepo`) the manual-run HTTP route uses.

Per tasks.md 1.2, since no gap was found, no fix was implemented — this delivery is test/proof-only,
as design.md anticipated ("no schema change... no production code change expected").

## Ticket scope items 4/5 (ticket.md's "Ticket-level scope" list)

- Item 4 (guard-rejection visibility): already decided in Planning — design.md Decision 3,
  "guard-rejection visibility stays log-only." No production code change; this cycle did not
  revisit that decision (the investigation in task group 1 found nothing that would change it).
- Item 5 (no-bypass confirmation): covered by the "No production code changed" section above —
  every auto-run-adjacent path (trigger/claim/release; there is no separate retry or backfill path
  that creates a `pipeline_runs` row for an auto-run) either reaches the guard or cannot
  create/execute a run at all.

## Falsifiability evidence for the 3.3 red case (systematic-debugging.md)

Before committing `AutoRunGuardBurstProofSpec.scala`'s red-case test in its guard-off form
(`withGuard = false`), it was run once with the line temporarily changed to `withGuard = true` and
observed to FAIL:

```
[info] - should the SAME six-burst scenario as 3.1, submitted through a PipelineRunService fixture
        constructed WITHOUT a pipelineRunGuardRepo, produces all six pipeline_runs rows --
        proving 3.1's budget-of-three result is not a tautology *** FAILED ***
[info]   3 was not equal to 6 (AutoRunGuardBurstProofSpec.scala:272)
```

The line was then reverted to `withGuard = false` (confirmed byte-identical to the pre-edit file
via `diff`), and the full suite re-run green (see PR body / return summary for that run's output).
This confirms the red case is genuine — it fails when the guard is wired in, and only passes in its
committed guard-off form because the guard is genuinely absent from that fixture.

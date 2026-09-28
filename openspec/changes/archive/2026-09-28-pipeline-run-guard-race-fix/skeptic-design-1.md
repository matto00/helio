## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in full (paths under
  `openspec/changes/pipeline-run-guard-race-fix/`).
- Cross-checked design.md's factual claims against the actual code, not just its prose:
  - `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
    lines 160-172 (`awaitQueuedCount`) and 254-280 (the failing test) match design.md's
    line-number citations and description exactly, including the scaladoc's "stable once
    reached" claim (line 164) that the ticket's driver-filed hypothesis targets.
  - `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
    lines 129-168 (`insertRunIfUnderConcurrencyCap` + `concurrencyLockAction`) confirm design.md's
    description: `pg_advisory_xact_lock` → owner check → live non-terminal count → conditional
    insert, chained as ONE `DBIO` passed to a single `ctx.withUserContext` call.
  - `DbContext.withUserContext` (`backend/src/main/scala/com/helio/infrastructure/persistence/DbContext.scala:50-51`)
    confirms `.transactionally` genuinely wraps the whole chain in one transaction — this is
    real corroborating evidence that H1 (test-coordination defect) is structurally more
    plausible than H2 (guard defect), consistent with design.md Decision 2's own stated lean,
    but the design correctly still commits to probing rather than concluding from this reading
    alone.
  - Manually traced the race design.md hypothesizes: `PipelineRunService.executeRun`
    (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:1003-1029`)
    shows the concurrency-cap decision (including `deleteOldRuns` cleanup) always fully
    resolves strictly BEFORE `backend.execute()` is invoked for an admitted run. That confirms
    the mechanics of H1 are physically possible: `awaitQueuedCount` observing `queued == 3`
    doesn't prove the other 5 in-flight submissions have reached their own lock-guarded
    decision yet — they may still be queued behind the per-owner exclusive advisory lock,
    and `gate.success(())` unblocking the first 3's `execute()` (letting them complete and
    free a slot) can race a still-undecided straggler's eventual lock acquisition.
- Confirmed no placeholders/TBDs, no internal contradiction between proposal/design/tasks, no
  scope drift (Non-Goals section correctly excludes re-litigating HEL-505 rate-limit/dry-run/
  trigger-source decisions and any retry/backoff/sleep fix), and no missing contract update
  (`skip_specs: true` is justified — both fix branches correct behavior against the guard's
  existing, unchanged "at most N non-terminal runs" contract; confirmed by reading the guard's
  doc comment at `PipelineRunRepository.scala:100-128`, which states this contract and is
  untouched by either fix shape).
- Confirmed the red-first/mutation-kill requirements are stated concretely enough to execute
  against (Decision 4 names concrete mutations: widen `maxConcurrent` by one, or drop the lock
  acquisition; tasks 2.3/2.4 require RED-before/GREEN-after against the pre-fix guard).
- Confirmed the design does not pre-commit to a fix: Decision 2 explicitly states a structural
  reading favoring H1 but "the probe is what decides, not this reading," and proposal.md states
  "no code change ships before this."

### Verdict: REFUTE

The investigation methodology and fix-shape plan are otherwise well-grounded (I found no
fabricated line numbers, no hand-waved contract, and a real, physically-plausible mechanism for
H1). But the design has a specific, checkable gap: it never reconciles with an already-existing
test that bears directly on H1 vs. H2, which risks either duplicated work or a probe that
skips free, already-available evidence — exactly counter to the "probe before fix" discipline
this ticket is built around.

### Change Requests

1. **Reconcile with the pre-existing `PipelineRunRepositorySpec` concurrent-race test before
   finalizing the task list.**
   `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala:639-660`
   ("concurrent submissions for the same owner never exceed the concurrency cap," shipped under
   HEL-505 tasks.md 8.4/C2) already calls `insertRunIfUnderConcurrencyCap` 12 times concurrently
   via real `Future.sequence`, never completes a run, and asserts exactly `maxConcurrent`
   `Inserted` / rest `CapExceeded` — i.e. it already exercises the guard's atomicity under real
   concurrent contention, independent of any test-premise/gate mechanism. Design.md quotes the
   adjacent `GatedExecutionBackend` docstring
   (`PipelineRunGuardIntegrationSpec.scala:120-135`) which explicitly names this exact test as
   already proving the guard correct "deterministically... which never completes a run at all,"
   yet neither design.md nor tasks.md ever mentions it. Required:
   - Add "check this existing test's pass/fail history (local + CI logs)" as a cheap first step
     in the probe (Decision 1 / task 1.1), before writing new instrumentation — a clean history
     is itself evidence against H2 (a real guard-atomicity failure would very plausibly have
     shown up here too, since this test forces MORE contention — 12 concurrent same-owner
     writers vs. the failing test's 8 — with none of the gate/polling machinery to blame); a
     past failure here would already implicate H2 directly.
   - In Decision 3's H1 branch (and task 2.2), explicitly state whether this existing test
     already satisfies the ticket's "prove the guard separately with a deterministic
     interleaving test" requirement. If yes, task 2.2 should be rescoped to "verify + cite this
     existing coverage," not "add" a new one. If no (e.g., because it relies on real JVM
     scheduling to produce contention rather than a forced/controlled interleaving, and is
     therefore not strictly "deterministic" in the sense the ticket demands), say so concretely
     so the executor understands what property the NEW test adds that the old one doesn't.
   - If a new/different test file ends up touched as a result, update proposal.md's Impact
     section (currently lists only `PipelineRunGuardIntegrationSpec.scala` and conditionally
     `PipelineRunRepository.scala`) to reflect it.

### Non-blocking notes

- Decision 3's H1 fix language ("instrument `GatedExecutionBackend`/the service to expose a
  settled-count Future/latch per submission") is ambiguous about whether production
  `PipelineRunService` needs a new test-only hook. Ground truth
  (`PipelineRunService.executeRun`, lines 1003-1029) shows the concurrency-cap decision always
  fully resolves (including the `deleteOldRuns` cleanup) strictly before `backend.execute()` is
  called — so the "has this submission settled its own admission decision" signal can be
  captured entirely inside the test file's own `GatedExecutionBackend.execute()` override (fire
  "admitted" on entry, before blocking on the gate) plus each submission's own resolved-or-not
  future (fire "rejected" on quick resolution), with zero production code changes. Recommend the
  design commit to the test-only route explicitly in the revision, to avoid an executor adding
  an unnecessary test-observability seam to production service code — scope creep against the
  ticket's own "keep changes focused" instruction and the proposal's non-goals.
- The design's Risks section is otherwise solid: it correctly anticipates the Heisenbug risk
  from instrumentation (prefers lightweight logging over anything with its own synchronization),
  the non-reproducing-repro risk (escalate rather than ship without a red repro), and the
  lock-scope blast-radius risk for an H2 fix (keep lock scope to count+insert, leverage the
  existing per-owner keying). No further findings on those three fronts.

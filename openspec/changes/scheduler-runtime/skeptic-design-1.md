## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-scheduler-runtime/spec.md`, `workflow-state.md` in full.
- No `TODO`/`TBD`/hand-waving strings anywhere in the artifacts (`grep -rniE
  "TODO|TBD|figure out|to be determined|placeholder"` → no matches).
- Branch point: worktree HEAD is `d908eb35` (HEL-414 merge commit); confirmed
  `git merge-base --is-ancestor d908eb35 origin/main` → yes, and
  `git log d908eb35..origin/main` shows only unrelated commits (HEL-612).
  Clean base, no drift.
- `Main.scala` guardian setup confirmed: typed `ActorSystem[Nothing]`, all
  repos constructed there (including `pipelineScheduleRepo`), matching the
  design's wiring plan.
- `ApiRoutes.scala:140` — `pipelineRunService` is currently `private val`,
  confirming task 4.1 ("private → val") is a real, needed change, not
  already done.
- `PipelineRunService.submit(pipelineId, isDry, user)` signature (`backend/
  src/main/scala/com/helio/services/PipelineRunService.scala:72`) matches
  design decision 4/5 exactly; `AuthenticatedUser(id: UserId)` (`domain/
  model.scala:31`) is a bare id wrapper, so "construct `AuthenticatedUser
  (pipeline.ownerId)`" is valid and takes the owner-permitted branch
  unconditionally (lines 76-84).
- Confirmed `submit`'s returned `Future` only resolves after the run's
  terminal state is persisted (`executeRun`'s `runFuture.transformWith` at
  lines 256-287 calls `updateRunTerminal`/`onRunSuccess` before completing) —
  validates the design's overlap-guard and "bookkeeping regardless of
  submit outcome" reasoning, since in-process execution is synchronous
  within the future chain (no separate async job-polling step to account
  for).
- `PipelineRunRepository`: confirmed `status="queued"`/`completedAt=None` on
  insert, `completedAt=Some(...)` only via `updateRunTerminal*`, and dry
  runs get `completedAt` set immediately at insert — so `completedAt IS
  NULL` is exactly the right "active run" predicate for the new
  `hasActiveRunInternal`, and dry runs correctly don't count.
- `DbContext.withSystemContext` exists (`infrastructure/DbContext.scala:63`)
  and is already the established pattern for `*Internal` methods
  (`PipelineRepository.findByIdInternal`, `PipelineRunRepository.
  insertRunInternal`) — the three new `*Internal` methods (tasks 2.1-2.3)
  follow precedent exactly.
- `PipelineScheduleRepository`/`PipelineSchedule`/`PipelineScheduleTable`:
  confirmed `enabled`, `nextRunAt: Option[Instant]`, `lastRunAt:
  Option[Instant]` all exist as designed (V62 columns, matches ticket's
  claim that no new migration is needed).
- `PipelineScheduleService.validateCron`/`validateInterval`: confirmed the
  5-field bounds table (`Vector[(Int,Int)]`, `0->59,0->23,1->31,1->12,0->6`)
  and the interval regex `^(\d+)(s|m|h|d)$` — matches design decision 1's
  "reuse the field-bounds table shape" and "`after.plus(n, unit)`" claims.
  (Note: `cronFieldBounds`/`validateCron` are `private`, so "reuse" is
  necessarily duplication, not a shared reference — the design's wording
  ("mirrors", "shape") already reflects this correctly, not a defect.)
- `AlertEvaluationServiceSpec` embedded-Postgres fixture pattern exists and
  matches the design's cited test-fixture precedent.
- No `helio.scheduler.*` stanza yet in `application.conf` (task 4.4 is a
  real addition); `spark { masterUrl = ... }` shows the established
  config-key/env-override pattern the new stanza will follow.
- Traced every ticket AC to a spec.md requirement/scenario and a tasks.md
  item — all six ACs (auto-fire, no-overlap, restart-safe, failure
  recorded, deterministic tests, backward-compatible/additive) have
  concrete coverage.

### Gap found — schedule edits don't take effect until the stale `next_run_at` elapses

`PipelineScheduleService.put` (`backend/src/main/scala/com/helio/services/
PipelineScheduleService.scala:49-51`) **always preserves the existing row's
`nextRunAt`/`lastRunAt`** on an upsert:
```scala
nextRunAt  = existingOpt.flatMap(_.nextRunAt),
lastRunAt  = existingOpt.flatMap(_.lastRunAt),
```
This applies to *any* `PUT` on an existing schedule — including one that
changes `kind`/`expression`/`timezone` (e.g. a user edits an hourly schedule
to run every 5 minutes) or toggles `enabled` back on. Combined with design
decision 2's tick logic — a schedule with a **future** `next_run_at` is left
untouched every tick, only recomputed when `next_run_at IS NULL` or
`<= now` — an edited schedule will keep firing on its **old** cadence
(against the stale, pre-edit `next_run_at`) until that one stale occurrence
naturally elapses, and only then does the freshly-edited expression start
governing subsequent occurrences.

This is a real, concrete, currently-unaddressed interaction:
- It isn't covered by any AC, spec.md requirement, or design.md Risk/Trade-
  off (the Risks section calls out three other known limitations by the
  same "acknowledge it explicitly" pattern — this one is simply absent).
- It's directly foreseeable to surface almost immediately: HEL-416 (the
  very next ticket in this sequential epic chain) is the config UI that
  will let users edit schedules through this same `PUT`, so this will be a
  live, user-visible "my edit didn't take effect" bug shortly after this
  ships.
- The proposal's `Capabilities` section claims `Modified Capabilities:
  (none — pipeline-schedule-persistence and pipeline-schedule-crud-api ...
  are unchanged)`. If the fix is (as seems cleanest) to have `put` reset
  `nextRunAt` to `None` whenever `kind`/`expression`/`timezone` changes (or
  simply always, mirroring the "fresh row" case), that **is** a change to
  the CRUD capability's persistence behavior — contradicting the proposal's
  own "unchanged" claim. Alternatively, this can be explicitly documented
  as an accepted, deferred limitation (same pattern as the day/month
  cron-infeasibility gap) — but currently neither resolution is present;
  the design simply doesn't acknowledge the interaction exists at all.

Either resolution is fine, but the design must pick one explicitly.

### Verdict: REFUTE

### Change Requests

1. **Address schedule-edit staleness** (`design.md` Decisions/Risks,
   `proposal.md` Capabilities, `tasks.md`). Either:
   (a) Add a task to reset `nextRunAt`/`lastRunAt` on `PipelineScheduleService
   .put` when `kind`/`expression`/`timezone` change (or unconditionally on
   any upsert of an existing row), and update the proposal's `Modified
   Capabilities` section to list `pipeline-schedule-crud-api` as modified
   with a spec delta describing the new reset-on-edit behavior; or
   (b) Explicitly document in design.md's Risks/Trade-offs (same pattern as
   the existing three) that editing an enabled schedule's cadence takes
   effect only after the currently-persisted `next_run_at` naturally
   elapses (a consequence of HEL-414's PUT preserving `next_run_at` across
   edits), and note it as a deferred follow-up rather than silently
   unaddressed. Either is acceptable; leaving it unmentioned is not.

### Non-blocking notes

- Decision 7's overlap-guard test technique ("call `tick()` twice
  synchronously before the first `submit`'s future resolves") relies on
  real `Future`/`ExecutionContext` race timing rather than a fully
  deterministic seam (no engine/data-source injection point exists on
  `PipelineRunService` today to force a controlled stall). This is
  plausible given `submit`'s async dispatch, but the executor should watch
  for flakiness on fast test fixtures and be ready to fall back to an
  explicit slow-fixture data source as the design already suggests.
- The 30s default tick interval is coarser than the smallest interval
  `PipelineScheduleService.validateInterval` currently accepts (`1s`).
  Sub-tick-interval schedules will silently run at the tick cadence rather
  than their configured cadence — a reasonable, common trade-off for a
  poll-based scheduler, but worth a one-line mention in Risks alongside the
  other three documented limitations.

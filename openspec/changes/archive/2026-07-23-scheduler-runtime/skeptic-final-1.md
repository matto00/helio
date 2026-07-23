## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Scope of review.** `git log --oneline d908eb35..HEAD` → single commit `ab148839`.
  `git diff d908eb35...HEAD --stat` → 26 files, 1853/-8. Confirmed the worktree's
  local `main` is stale (`main...HEAD` pulls in already-merged HEL-414); scoped all
  review to `ab148839` only, matching the evaluator's stated scope note.

- **Ticket ACs traced to code** (`openspec/changes/scheduler-runtime/ticket.md`):
  1. "Due schedules fire ... as owner" → `PipelineSchedulerService.fire` builds
     `AuthenticatedUser(pipeline.ownerId)` and calls the existing
     `PipelineRunService.submit(pipelineId, isDry=false, owner)` (signature verified:
     `backend/.../PipelineRunService.scala:72`). Exercised by
     `PipelineSchedulerServiceSpec` "fire a due interval/cron schedule ..." (real
     embedded-Postgres run, asserts `status shouldBe "succeeded"`).
  2. "No overlap" → two-layer guard read directly:
     `PipelineSchedulerService.scala:32-41` (synchronized `mutable.Set`) +
     `PipelineRunRepository.hasActiveRunInternal` (`completed_at IS NULL`, system
     context). Test "guard two back-to-back tick() calls ..." uses a deterministic
     hung-`Future` handoff (no sleep-based race) and asserts `readCount.get() shouldBe 1`;
     "leave next_run_at untouched and skip firing when a persisted active run blocks"
     seeds a real in-flight `pipeline_runs` row and asserts no second run inserted.
  3. "Restart-safe, no backlog" → `processOne` branches on `nextRunAt.isEmpty` (design.md
     Decision 2); confirmed by test "recompute next_run_at without submitting a run when
     it is unset" — asserts zero runs, `nextRunAt` advanced.
  4. "Failures recorded" → test "record a failed scheduled run in run history ..." seeds
     a CSV pipeline with an empty path (fails synchronously in
     `InProcessPipelineEngine.loadRows`), asserts `status shouldBe "failed"` and a
     non-empty `errorLog`, and that bookkeeping (`nextRunAt`/`lastRunAt`) still advances.
  5. "Deterministic clock/scheduler in tests" → injected `Clock` trait
     (`domain/Clock.scala`) + `FakeClock` in the spec; `PipelineSchedulerActor` (the only
     component touching Pekko's real timer) is deliberately untested directly, by design
     (documented, and it is genuinely thin — verified by reading it in full).
  6. "Backward compatible / no auto-run without schedule" → test "never submit a run for
     a pipeline with no schedule" plus `listTickCandidatesInternal`'s query is scoped to
     `pipeline_schedules` rows only (read directly).

- **The HEL-414 design-gate fix** (`PipelineScheduleService.put` resetting `nextRunAt`
  on cadence change) — read the diff directly
  (`git show ab148839 -- backend/.../PipelineScheduleService.scala`): compares
  `kind`/`expression`(trimmed)/`timezone` against the existing row, resets to `None`
  only on a real cadence change, preserves on unrelated edits (e.g. `enabled`). Four new
  cases added to `PipelineScheduleServiceSpec` (kind/expression/timezone-change → reset;
  enabled-only change → preserved), read in full — each seeds a real
  scheduler-computed `nextRunAt` via `updateAfterTickInternal` first, so the assertion is
  not vacuous. Re-ran `PipelineScheduleRoutesSpec` (the CRUD-API test suite, pre-existing
  from HEL-414) independently — all 16 cases still pass, including "calling PUT twice
  replaces the schedule" — confirming no regression to `pipeline-schedule-crud-api`
  behavior from this fix.

- **Fresh gate re-runs** (not trusted from the evaluator's report):
  - `cd backend && sbt test` → **1693/1693 passed, 91 suites, 0 failed** (full run,
    fresh).
  - `sbt "testOnly ...PipelineSchedulerServiceSpec ...CronScheduleSpec ...PipelineScheduleServiceSpec ...PipelineScheduleRoutesSpec"` →
    **59/59 passed** (targeted re-run of every file this ticket touches or claims not to
    regress).
  - `npm run check:scala-quality` → "clean (57 soft warning(s))" — matches evaluator's
    claim exactly (same count, same two new files flagged as informational-only).
  - `npm run check:openspec` → exactly one issue, "not yet archived" — matches the
    commit's stated `-n` bypass reasoning.

- **Wiring correctness** — read `Main.scala`, `ApiRoutes.scala`, `application.conf`
  diffs in full: `pipelineRunService` visibility change is `private val` → `val` only
  (no route/contract change, consistent with Phase-3-N/A framing); `Main.scala`
  constructs `PipelineSchedulerService` from already-built repos +
  `apiRoutes.pipelineRunService` and spawns `PipelineSchedulerActor` as a guardian
  child; `helio.scheduler.tick-interval-seconds` stanza present with env override.
  `PipelineRepository.findByIdInternal` (used for owner resolution) confirmed
  pre-existing, not newly invented.

- **`CronSchedule`** read in full: interval via `Instant.plus`; cron via minute-scan
  capped at `4 * 365 * 24 * 60` (~2.1M, in `Int` range), field-matching logic
  (list/range/step/wildcard) is straightforward and covered by `CronScheduleSpec`
  (read: covers all four interval units, list/range/step cron syntax, timezone
  conversion, malformed-field-count, and the infeasible-expression `None` case).

- **No frontend changes** — confirmed via `git diff d908eb35...HEAD --stat`: zero
  `frontend/**` files. No `schemas/**` or `openspec/specs/**` changes either (background
  job, no new HTTP surface) — correctly so per the ticket's scope. Phase 3 / UI-review is
  not applicable; did not start dev servers (nothing to look at).

### Verdict: CONFIRM

The implementation traces cleanly to every acceptance criterion with real, non-vacuous
test coverage (embedded-Postgres integration tests exercising the actual
`PipelineRunService.submit` path, not mocks). The design-gate fix to already-merged
HEL-414 code is exactly what it claims to be — a small, targeted, tested fix with a
documented rationale in design.md Decision 7, not a silent drive-by — and I independently
re-ran the CRUD-API test suite to confirm zero regression. All gate claims (sbt test,
scala-quality, openspec hygiene) reproduced independently with matching output.

### Non-blocking notes

- `CronSchedule`'s minute-by-minute scan (worst case ~2.1M iterations for an infeasible
  expression) runs on a background actor thread outside the request path, per design.md's
  own risk callout — acceptable for a 30s-default tick interval, but worth a comment
  or follow-up ticket if tick intervals are ever tuned much lower than the codebase's
  current default.
- `PipelineSchedulerActor` itself is untested (by design, per design.md Decision 6) —
  reasonable given how thin it is (timer bookkeeping only, verified by reading it in
  full), but flagging for completeness since it is the one production code path this
  ticket adds that no test directly exercises.

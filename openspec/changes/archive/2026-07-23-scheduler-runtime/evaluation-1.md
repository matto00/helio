## Evaluation Report — Cycle 1

Scope note: the worktree's local `main` is behind origin (HEL-414/#269 not yet
fast-forwarded locally), so `git diff main...HEAD` includes HEL-414's already-merged
diff. The actual review surface for this ticket is `git diff d908eb35...HEAD` (the
single commit `ab148839`, based on the merged HEL-414 tip). All findings below are
scoped to that commit.

### Phase 1: Spec Review — PASS
Issues: none.

- All six ACs addressed: due-schedule firing via `PipelineRunService.submit` as
  owner (`PipelineSchedulerService.fire`); overlap guard (in-memory `mutable.Set`
  + persisted `hasActiveRunInternal`, both exercised in tests); restart-safe
  catch-up (unset `next_run_at` recomputed without firing, documented in
  design.md Decision 2 and mirrored in `pipeline-scheduler-runtime/spec.md`);
  scheduled failures recorded via the existing `submit`/`executeRun` failure
  path (verified with a dedicated failure test); deterministic `Clock`
  abstraction used throughout tests, no real timer in the service spec; pipelines
  without a schedule are provably never touched (`listTickCandidatesInternal`
  only returns rows from `pipeline_schedules`).
- Task list (tasks.md) matches implementation 1:1 — every checked item has a
  corresponding diff hunk (CronSchedule, Clock, repository internals, service,
  actor, Main.scala wiring, application.conf, and all four test files).
- Design-gate finding (task 4.1, `PipelineScheduleService.put` resetting
  `next_run_at` on cadence change) is in scope: it's a documented, tested fix
  to already-merged HEL-414 code, called out as intentional in proposal.md's
  "Modified Capabilities" and both affected spec deltas
  (`pipeline-schedule-crud-api`, `pipeline-schedule-persistence`), not scope
  creep — it's explicitly the ticket's own design-gate output, not a
  drive-by change.
- No scope creep beyond that documented fix; no unrelated files touched.
- No regressions: full `sbt test` run (fresh, see Phase 2) is 1693/1693 green,
  including all pre-existing `PipelineScheduleServiceSpec`/`RlsPolicyGuardSpec`
  suites.
- No API/schema changes (scheduler is a background job, no new HTTP surface);
  `schemas/` and `openspec/specs/` untouched by this diff, correctly so.
- Planning artifacts (proposal/design/tasks/spec deltas) match the final
  implementation; no drift found between design.md's eight numbered decisions
  and the code.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md mechanical rules**: `npm run check:scala-quality` reports
  "clean" (zero inline-FQN violations) for the diff. File-size soft-budget
  warnings exist for the two new spec files (`PipelineSchedulerServiceSpec.scala`
  329 lines, `PipelineScheduleServiceSpec.scala` 394 lines) but these are
  explicitly informational-only per CONTRIBUTING.md ("File-size warnings ...
  are informational only") and consistent with the codebase's existing norm
  (57 total pre-existing warnings across the repo, most far larger).
- ACL triad (CONTRIBUTING.md "ACL triad for repository reads") followed
  correctly: the three new privileged methods
  (`PipelineScheduleRepository.listTickCandidatesInternal`/
  `updateAfterTickInternal`, `PipelineRunRepository.hasActiveRunInternal`)
  are all `*Internal`, go through `ctx.withSystemContext`, and each carries a
  doc comment justifying the ACL bypass (background-job callsite, no
  request-bound user) — matches the pattern in `PipelineStepRepository`,
  `ResourcePermissionRepository`, etc.
- DRY: reuses `PipelineRunService.submit` (no forked run-execution logic),
  reuses `PipelineRepository.findByIdInternal` (pre-existing, not
  reinvented), reuses `PipelineScheduleService`'s cron-field-bounds *shape*
  in `CronSchedule` (explicitly documented as intentionally separate
  match-vs-validate concerns, not duplicated logic).
- Readable: clear naming (`reserve`/`release`/`fireIfNotOverlapping`/
  `recomputeOnly`), no magic values (bounds table, scan cap, and tick
  interval are all named constants/config), the branch on `nextRunAt.isEmpty`
  vs `Some` is self-explanatory and matches design.md's stated policy.
- Modular: `PipelineSchedulerActor` is genuinely thin (timer bookkeeping
  only); all business logic lives in `PipelineSchedulerService`, matching
  design.md Decision 6 and enabling the actor-free test strategy.
- Type safety: no `Any`/`asInstanceOf` introduced; `Either[ServiceError, _]`
  and `Option`/`Future` used throughout per existing conventions.
- Security: all new repository methods are system-context/no-ACL by design
  (background job) and each is justified per CONTRIBUTING's triad; no new
  external input surface (no new HTTP route) to validate.
- Error handling: `processCandidate` isolates one schedule's failure from
  its siblings (`.recover` + log, mirrors `AlertEvaluationService`); `fire`'s
  `.transform` converts an unexpected `submit` exception into a logged,
  swallowed failure so bookkeeping still runs — deliberate and commented,
  not a silent failure (the expected pipeline-execution-failure path is
  separately recorded by `PipelineRunService` itself, confirmed by the
  dedicated failure test).
- Tests meaningful: `PipelineSchedulerServiceSpec`'s overlap-guard test uses
  a deterministic promise-based hang/reach signal (no sleep-based race);
  covers due-cron-fires, due-interval-fires, no-schedule-no-op,
  null/restart-recompute, failure-recorded, persisted-guard-skip, and
  in-memory-guard-skip — all of which would catch a real regression (e.g.
  reverting the overlap guard makes the double-tick test fail
  deterministically, not flakily). `CronScheduleSpec` covers all four
  interval units, list/range/step cron syntax, timezone conversion,
  malformed input, and the infeasible-expression `None` case.
  `PipelineScheduleServiceSpec` additions directly test the cadence-change
  reset fix and its "preserve on unrelated edit" counterpart.
- No dead code: no leftover TODO/FIXME, no unused imports (confirmed via a
  clean `sbt compile` with no warnings).
- No over-engineering: no new external cron dependency (self-approved,
  matches HEL-414 precedent); no premature generalization beyond what the
  ticket asked for (e.g. no multi-instance coordination scaffolding, which
  is explicitly out of scope).
- Behavior-preserving where expected: the one behavior change to
  already-shipped code (`PipelineScheduleService.put`'s `next_run_at` reset)
  is not a silent drive-by — it's flagged in the ticket's batch context,
  documented in design.md Decision 7 with an explicit rejected-alternative
  analysis, reflected in both affected spec deltas, and covered by new
  tests. This is the documented exception CONTRIBUTING.md's "AI
  Collaborators" section allows (flag latent issues rather than silently
  fixing), handled correctly here since it was surfaced through the
  design-gate process rather than fixed inline without record.
- Pre-commit bypass (`git commit -n`): used once, for `check:openspec`'s
  expected "not yet archived" structural failure (verified independently —
  `npm run check:openspec` currently reports exactly that one issue and
  nothing else). The commit body explicitly calls out the bypass with
  reasoning and cites the HEL-466 precedent, matching CLAUDE.md's
  requirement ("If a bypass is used, call it out explicitly"). Lint, format,
  and schema checks were independently re-verified green
  (`check:schemas`, `format:check`).

### Phase 3: UI Review — N/A
No `frontend/**` files changed. `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
changed, but only a `private val` → `val` visibility change on
`pipelineRunService` (no new/modified route, no request/response shape
change) — not a route-surface change per the Phase 3 trigger. No `schemas/**`
or `openspec/specs/**` files touched. Phase 3 correctly does not apply; dev
servers were not started.

### Fresh verification evidence (independently re-run, not executor-reported)
- `cd backend && sbt test`: **1693/1693 passed**, 91 suites, 0 failed, 0 canceled.
- `npm run check:scala-quality`: clean (0 inline-FQN violations; 57
  pre-existing informational file-size warnings, none newly introduced beyond
  the two new spec files noted above).
- `npm run check:openspec`: exactly one issue — "change scheduler-runtime is
  complete (17/17) but not archived" — confirms the commit's bypass note is
  accurate and not masking a real failure.
- `npm run check:schemas`: in sync.
- `npm run format:check`: all files formatted.
- `sbt compile`: no warnings.

### Overall: PASS

### Non-blocking Suggestions
- None.

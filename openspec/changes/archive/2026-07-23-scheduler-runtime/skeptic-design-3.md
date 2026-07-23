## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read cold (not trusting rounds 1–2 as fact, or the workflow-state.md narrative): `ticket.md`,
  `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-scheduler-runtime/spec.md`,
  `specs/pipeline-schedule-crud-api/spec.md`, `specs/pipeline-schedule-persistence/spec.md`,
  `workflow-state.md`, `skeptic-design-2.md` (as a claim to verify, not ground truth), plus the
  pre-change base specs (`openspec/specs/pipeline-schedule-persistence/spec.md`,
  `openspec/specs/pipeline-schedule-crud-api/spec.md`) and the cited archived precedent
  (`openspec/changes/archive/2026-07-12-dependabot-codeql-security-fixes/specs/request-authentication/spec.md`).
- Confirmed no code has moved since round 2: `git log --oneline -3` → HEAD still `d908eb35`
  (HEL-414 merge); `git status --short` shows only the untracked `openspec/changes/scheduler-runtime/`
  dir. I still independently re-verified (not assumed from prior rounds) every code-level factual
  premise design.md/tasks.md rely on, reading the actual current source:
  - `backend/.../services/PipelineScheduleService.scala:63-64` — `put` still unconditionally does
    `nextRunAt = existingOpt.flatMap(_.nextRunAt)`, `lastRunAt = existingOpt.flatMap(_.lastRunAt)` —
    the bug Decision 7 / task 4.1 fix is real and unfixed pre-implementation.
  - `backend/.../api/ApiRoutes.scala:140` — `pipelineRunService` is currently `private val` (Decision
    5 / task 5.1's premise holds).
  - `backend/.../app/Main.scala` — boots `ActorSystem[Nothing](guardian(), "helio")`, guardian has
    `implicit val system: ActorSystem[Nothing]` — matches Decision 6/task 5.2-5.3's actor-wiring plan.
  - `backend/.../services/PipelineRunService.scala:72` — `submit(pipelineId, isDry, user:
    AuthenticatedUser)` signature matches Decision 4's call shape exactly.
  - `backend/src/main/resources/db/migration/V24__pipeline_runs.sql:6` — `completed_at TIMESTAMPTZ`
    (nullable) exists — confirms the "still active" predicate (`completed_at IS NULL`) design/tasks
    rely on is real, not invented.
  - `backend/.../infrastructure/PipelineRepository.scala:45` — `findByIdInternal` already exists
    (Decision 4's owner-resolution premise is real, not a new method being smuggled in unplanned).
  - `backend/.../infrastructure/{DataTypeRepository,AlertRuleRepository,PipelineRunRepository,
    PipelineRepository,DashboardRepository,PanelRepository,PipelineStepRepository}.scala` — the
    `*Internal` naming convention for system-context/no-`AuthenticatedUser` methods is an
    established, repeated pattern across 7 existing repositories — the three new methods proposed
    (tasks 2.1-2.3) match precedent, not a novel bypass mechanism.
  - `backend/.../services/PipelineScheduleService.scala:100-116` — `validateCron`'s 5-field
    `cronFieldBounds` table is exactly as Decision 1 describes (to be reused, not duplicated).
  - `backend/.../services/PipelineRunService.scala:54-56,285,308-346` — `onRunSuccess` /
    `AlertEvaluationService` wiring exists exactly as proposal.md's "Additional seam context" and
    design's Goals describe (alert evaluation happens for free via the shared `submit` path).
  - `backend/src/test/scala/com/helio/services/AlertEvaluationServiceSpec.scala` — the cited
    embedded-Postgres test fixture precedent (Decision 6, task 6.2) is real.
  - `backend/src/main/resources/application.conf` — confirms the `helio.<namespace> { ... =
    ${?ENV_VAR} }` config idiom task 5.4's `helio.scheduler.tick-interval-seconds` /
    `SCHEDULER_TICK_INTERVAL_SECONDS` follows an established pattern, not a fabricated one.
- `openspec validate scheduler-runtime --strict` → `Change 'scheduler-runtime' is valid`.
- `grep -rniE "TODO|TBD|figure out|to be determined|placeholder|TKTK|XXX"` across the change dir →
  no hits.
- Confirmed `pipeline-scheduler-runtime` has no pre-existing base spec (`ls openspec/specs/` has no
  such directory) — its spec delta is correctly ADDED-only, not masquerading as a modification.

### Round-3-specific fix: verified against the actual openspec merge/archive code, not just by resemblance to precedent

Round 2's REFUTE was that `specs/pipeline-schedule-persistence/spec.md`'s `MODIFIED` header
("...are computed by the scheduler runtime, not the repository") didn't textually match the base
spec's requirement name ("...are not computed by this ticket"), and that OpenSpec resolves
`MODIFIED` by name lookup against the base spec, not by `--strict` structural validation alone.

The round-3 fix adds:
```
## RENAMED Requirements

- FROM: `### Requirement: next_run_at and last_run_at are not computed by this ticket`
- TO: `### Requirement: next_run_at and last_run_at are computed by the scheduler runtime, not the repository`
```
ahead of the `## MODIFIED Requirements` block (`specs/pipeline-schedule-persistence/spec.md:1-8`).

I did not stop at confirming this textually matches the archived precedent's shape (it does — same
`FROM:`/`TO:` backtick-quoted-header format as
`.../archive/2026-07-12-dependabot-codeql-security-fixes/specs/request-authentication/spec.md:1-4`).
Since round 2's own finding was that `--strict` validation doesn't catch this class of bug, I went
one level deeper than round 2 did and **exercised the actual merge logic the archiver runs**,
rather than trusting structural resemblance to precedent as proof:

- Read `/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js` end to end. Confirmed
  the real algorithm: `RENAMED` is applied first (looks up `FROM` in the base spec's requirement map
  by exact normalized name, errors if not found; renames the header to `TO` in the in-memory map),
  then a pre-validation pass **requires** any `MODIFIED` entry to reference the post-rename `TO`
  name if a rename exists for it (`specs-apply.js:116-122`, "when a rename exists, MODIFIED must
  reference the NEW header"), then `MODIFIED` replaces the block keyed by that name
  (`specs-apply.js:199-210`).
- Built a throwaway sandbox copy of this worktree's `openspec/` at
  `/tmp/.../scratchpad/openspec-sim/project/openspec` (never touched the real worktree/specs) and
  called the library's own `findSpecUpdates` + `buildUpdatedSpec` functions directly (not the CLI,
  to avoid any accidental mutation of change/archive state) against the actual change dir's three
  spec deltas. Result for all three, no sandboxing artifacts, no errors:
  ```
  pipeline-schedule-crud-api      counts: { added: 0, modified: 1, removed: 0, renamed: 0 }
  pipeline-schedule-persistence   counts: { added: 0, modified: 1, removed: 0, renamed: 1 }
  pipeline-scheduler-runtime      counts: { added: 5, modified: 0, removed: 0, renamed: 0 }
  ```
  and inspected the rebuilt `pipeline-schedule-persistence` spec output directly: it contains
  **exactly one** `next_run_at`/`last_run_at` requirement, correctly re-titled to "...are computed
  by the scheduler runtime, not the repository", with the new body text, at the same position in
  the requirements list, and the "...are not computed by this ticket" title is gone (renamed in
  place, not duplicated or orphaned). This is direct, mechanism-level proof — not inference from
  precedent — that round 2's gap is closed: the exact failure mode round 2 predicted (stale-titled
  requirement surviving archival, producing a self-contradictory main spec) does not occur.
- This also incidentally re-confirms the `pipeline-schedule-crud-api` delta (verbatim-matching
  title, no rename needed) and the `pipeline-scheduler-runtime` delta (pure ADDED, no base spec)
  both apply cleanly, with no interaction/collision across the three spec deltas.

### Everything else, checked fresh (not assumed from rounds 1-2)

- All six ticket ACs trace to concrete evidence:
  1. Auto-fire via existing run-submission service, as owner → `pipeline-scheduler-runtime` spec
     Requirement 1 + Decision 4 + tasks 3.2/5.2-5.3.
  2. No-overlap guard → spec Requirement 2 + Decision 3 (dual guard: in-memory set + persisted
     `completed_at IS NULL` check, both verified real) + tasks 2.3/3.3.
  3. Restart-safe, documented catch-up, no backlog → spec Requirement 3 + Decision 2 (single unified
     `tick()` path, no bespoke boot-only branch) + task 6.2's "restart/null recompute" case.
  4. Scheduled-run failures recorded → spec Requirement "Scheduled-run failures are recorded" + task
     6.2's failure-path case; reuses the existing failure-recording path (verified
     `updateRunTerminalInternal` exists in `PipelineRunRepository.scala:80`) rather than inventing
     one.
  5. Deterministic tests via injectable clock → Decision 6/task 3.1 `Clock` trait +
     `PipelineSchedulerServiceSpec` (task 6.2) exercising `tick()` directly, no real Pekko timer.
  6. Backward-compatible/additive → spec scenario "Pipeline without a schedule is never auto-run" +
     task 6.2's last bullet.
- Internal consistency: proposal.md's "Modified Capabilities" section (both `pipeline-schedule-crud-api`
  and `pipeline-schedule-persistence`) matches what the two delta spec files actually contain; no
  contradiction between design.md's decisions and tasks.md's task list (spot-checked
  `hasActiveRunInternal`/`listTickCandidatesInternal`/`updateAfterTickInternal` are named/used
  identically across design.md, tasks.md, and the spec scenarios).
- Scope check: proposal.md's Impact section lists exactly backend files matching the ticket's
  "Backend:" scope section — no unplanned frontend, no unplanned schema migration (self-approved
  note that V62 already has the columns, verified true against `PipelineScheduleRepository`/table
  definitions in round 2 and re-confirmed still accurate — no migration file changed).
- Out-of-scope items (failure notification, retry/backoff, multi-instance, HEL-369's external
  endpoint) are correctly absent from tasks.md and the spec deltas — no scope creep.
- No inline fully-qualified names appear in any planning artifact (CONTRIBUTING.md constraint,
  called out explicitly in ticket/proposal/tasks) — nothing in these prose files violates it, and
  it's correctly listed as a task-level constraint (5.x wiring) for the executor to honor in actual
  code, which is the correct place to enforce it (not a planning-artifact concern per se).

### Verdict: CONFIRM

### Non-blocking notes

- Same items round 2 already flagged as non-blocking and un-escalated remain accurate and still
  don't require action at this gate: the overlap-guard test technique's reliance on real
  `Future`/`ExecutionContext` interleaving (Decision 8) rather than a fully deterministic scheduler
  double, and the 30s default tick interval being coarser than the minimum accepted interval
  expression (`1s`) — worth a one-line mention in Risks, not blocking.
- Executor implementation note (not a design gap): when applying task 4.1, double-check the
  `expression` comparison is against the *trimmed* value on both sides (existing row's stored
  `expression` vs. the incoming request's), since `validateCron`/`validateInterval` already trim
  before validating — tasks.md already says "(trimmed)" at 33, so this is already specified
  correctly; flagging only so the executor doesn't silently drop the trim.

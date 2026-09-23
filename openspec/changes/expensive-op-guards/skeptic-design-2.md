## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Spawn-cwd guard

`pwd -P` → `/home/matt/Development/helio`. `assert-cwd.sh` returned
`READY ambient=/home/matt/Development/helio branch=feature/expensive-op-guards/HEL-505`. Proceeded.

### What I verified (with evidence) — round 1's two change requests

**Change request 1 (concurrency-cap atomicity mechanism).** Verified concrete and buildable
against the actual code:

- `DbContext.scala:34-65` (read in full) confirms `withUserContext[R](userId)(action: DBIO[R]):
  Future[R]` (lines 50-51) takes exactly ONE `DBIO[R]` and wraps it `.transactionally` itself —
  design.md's claim that two separate `withUserContext` calls cannot share one Postgres
  transaction is accurate. (Minor: design.md cites this as "DbContext.scala:34-46" — the actual
  method signature is at 50-51, with 34-49 being the class decl + doc comment. Non-blocking
  citation imprecision, substance unaffected.)
- `PipelineRunRepository.scala:33-36` — `pipelineOwnedAction(pipelineId, user)` already exists as
  a **raw, unwrapped `DBIO[Boolean]`** (not itself wrapped in a `Future`/transaction), exactly the
  shape needed to `.flatMap`-compose into a single new `DBIO` chain alongside the advisory lock
  and the conditional insert. Task 3.1's "mirror `pipelineOwnedAction`" instruction is concretely
  actionable against this real code, not aspirational.
- `PipelineRunService.scala:944-950` — I re-read `executeRun`'s `preExec` and confirmed it is
  **exactly** the code design.md cites: `val preExec: Future[Unit] = if (!isDry &&
  pipelineRunRepo != null) pipelineRunRepo.insertRun(...).flatMap(_ =>
  pipelineRunRepo.deleteOldRuns(...)).recoverWith { case _ => Future.successful(()) } else
  Future.successful(())`, followed by `val runFuture = preExec.flatMap { _ => backend.execute(...)
  }` at line 967. Design's claim that `preExec` must become short-circuiting
  (`Future[Either[ServiceError, Unit]]`) so a `Left` skips `backend.execute` is buildable exactly
  as described against this real code. I also checked whether the existing `.recoverWith { case _
  => Future.successful(()) }` could silently swallow a guard rejection: it cannot — a rejection
  expressed as `Left(...)` inside a *successful* `Future` is never touched by `recoverWith`, which
  only intercepts a *failed* `Future`. No hidden defect there.
- `PipelineRunService.scala:291-335` (`runPipeline`) confirms the two intervening async DB calls
  design.md's Resolution 1 describes — `resolveAllRootDataSourcesInternal` (line 303) and
  `pipelineStepRepo.listByPipelineInternal` (line 322) — both complete before `executeRun` is
  reached at line 333, exactly matching the control-flow gap the original round-1 finding
  identified and this resolution now correctly scopes around (leaving those two calls where they
  are, collapsing only the guard-check + insert into one atomic unit at the `preExec` site).

This change request is resolved. The design is now concrete enough to implement without further
architectural guesswork.

**Change request 2 (dry-run/concurrency-cap contradiction).** Verified resolved via option (b),
narrowing the concurrency cap to real runs only, and verified this is stated in every artifact the
round explicitly named:

- `PipelineRunRepository.scala:139-159` (`insertDryRun`/`insertDryRunInternal`) and
  `PipelineRunService.scala:1033, 1068-1096` (`onDryRunSuccess`) re-confirmed: a dry run's
  `pipeline_runs` row is inserted with status `'dry_run'` in a single statement, reached only
  after the dry run has already executed — the underlying factual claim is correct. (Minor:
  design.md attributes the "this dry run's row is inserted above... unlike the real-run path"
  quote to lines "1079-1082"; the actual quote is at lines 1090-1093 — 1079-1082 is a different,
  adjacent doc comment about never persisting NULL. This imprecise pinpoint is carried over
  unchanged from round 1's own citation. Non-blocking — the underlying claim is independently true
  regardless of the exact line number, and `workflow-state.md`'s C7 citation range
  ("1068-1094") does correctly bracket the real quote.)
- I independently confirmed the terminal-status set is exhaustive: `grep`ing every status literal
  assigned to `pipeline_runs.status` across `PipelineRunService.scala` and
  `PipelineRunRepository.scala` turns up only `queued`, `succeeded`, `failed`, and `dry_run` — no
  other status exists (including the HEL-570 "blocked" path, which also writes `failed`). So
  design.md's `NOT IN ('succeeded','failed','dry_run')` concurrency-count predicate is exactly
  right, and "queued" is the sole non-terminal status.
- `design.md` Decision 3 "Resolution 2" section states the exclusion and its rationale explicitly.
- `tasks.md` Standing Constraint C7 states it explicitly, and task group headers/task 2.4/3.2/8.1
  restate the scope split (rate limit: both; concurrency: real-only) at each relevant task.
- `specs/pipeline-run-guard/spec.md`'s second Requirement explicitly scopes the concurrency cap to
  "a real (non-dry) pipeline-run submission," and carries a dedicated scenario ("A dry-run
  submission is not subject to the concurrency cap").
- `workflow-state.md`'s `CONSTRAINTS` JSON carries C7 with the full rationale, `agreed_at:
  "design-gate"`, promoted from the round-1 REFUTE per `CONSTRAINT_REVIEWS`.

This is resolved everywhere the round asked me to check (design.md, tasks.md, spec.md), **except
proposal.md — see Change Request 1 below**, which is a real gap I found on this fresh full pass.

**Non-blocking note (limit < 1 short-circuit).** `grep`ed
`AssistantDailyUsageRepository.scala:28-29`: `def incrementIfUnderCap(userId, limit): Future[Boolean]
= if (limit < 1) Future.successful(false)`. design.md Decision 2 and tasks.md task 2.1 both now
explicitly call out mirroring this short-circuit. Confirmed present.

### Everything else re-checked on this fresh pass

- Both existing trigger-path call sites re-confirmed live: `HookTriggerService.scala:74`
  (`.submit(`) and `PipelineSchedulerService.scala:118` (`.submit(schedule.pipelineId, isDry =
  false, owner, triggerSource = TriggerSource.Scheduled)`). The "single choke point" premise still
  holds against the actual current code.
- `RlsPolicyGuardSpec.scala:78,119-120` re-confirmed: `"assistant_daily_usage" -> None` is exactly
  the allowlist shape task 1.3 asks for.
- `V88__*.sql` re-read in full: its own comment states "no separate
  idx_assistant_daily_usage_user_id is needed: user_id is the PK's leading column already" — the
  same reasoning applies to the new `pipeline_run_rate_window(user_id, window_start)` table (PK
  leading column is `user_id`), so CONTRIBUTING.md's 4th "Adding a new ACL'd table" checklist item
  (indexing `owner_id`) is correctly inapplicable here, consistent with the precedent. Not called
  out explicitly in tasks.md, but not a defect — it mirrors the cited precedent exactly.
- Migration ledger re-checked: `ls backend/src/main/resources/db/migration/` — highest is still
  V108; V109 still free.
- `git status`/`git log` — this worktree has no code changes yet (only the untracked
  `openspec/changes/expensive-op-guards/` planning dir), consistent with being at the design gate
  before any execution cycle; `HEAD` is `e08cce1d`, same as main.

### A real, specific gap found on this fresh pass: proposal.md never states the C7 dry-run exclusion

`grep -n "dry" openspec/changes/expensive-op-guards/proposal.md` returns **zero matches**.
`proposal.md`'s "What Changes" section states: "Add a DB-backed, globally-consistent... concurrency
cap and rate limit on pipeline-run submission... so no trigger path, present or future, can bypass
it" and "Exceeding either cap returns 429... the route handler / trigger service never reaches
Spark execution for a rejected submission" — both **unqualified**, and the "Capabilities" section
describes `pipeline-run-guard` as "enforced uniformly across every trigger path."

None of this is true for a dry run against the concurrency cap: a dry-run submission is
deliberately **not** subject to it (C7) and **does** reach `backend.execute`/Spark execution
regardless of how many real runs the user already has in flight. A reader of proposal.md alone —
plausibly the first (and for a skimming reviewer, the only) artifact consulted, and the one that
typically survives into the archived change-summary — would reasonably conclude both guards apply
without exception.

This matters specifically because of the double standard already visible in the same document:
the sibling scope deviation, C5 (`analyze` excluded from the tighter rate limit), **does** get an
explicit callout in proposal.md ("**Deviation from the ticket's literal AC** (owner-approved
2026-09-23): pipeline `analyze` does **not** get a tighter limit..."). C7 is an equally real,
equally owner-relevant scope narrowing from the ticket's own literal framing ("[dry runs] execute
the same `executeRun`/Spark path... and are just as compute-expensive, so they consume the same
budget" — ticket.md's premise-validation framing, which design.md's own Decision 3 quotes and then
narrows away from). Leaving it out of proposal.md while C5 gets the callout is exactly the kind of
inconsistency the round's own instruction ("verify this is now stated everywhere it needs to be so
it can't be mistaken for an oversight later") was meant to close — the round's enumerated list
(design.md, tasks.md, spec.md, PR body) happened not to name proposal.md explicitly, but this is
squarely the kind of thing a fresh full pass across "the full set of planning artifacts" is
supposed to catch, and I did.

This is a small, mechanical fix — not a re-open of the underlying design decision, which I've
independently verified is sound.

### Verdict: REFUTE

### Change Requests

1. **Add an explicit C7 callout to `proposal.md`**, mirroring C5's existing treatment there. At
   minimum:
   - Qualify the "What Changes" bullet(s) currently claiming the concurrency cap applies
     unconditionally / "uniformly across every trigger path" to note that dry-run submissions are
     excluded from the concurrency cap specifically (while remaining subject to the rate limit).
   - Add a short "Deviation from the ticket's literal AC" style note (matching C5's phrasing
     pattern) stating that this narrows the ticket's "dry runs... consume the same budget" framing,
     with a one-line rationale (mirrors HEL-509/HEL-873's single-statement dry-run persistence
     invariant — see design.md Decision 3 for the full rationale, no need to duplicate it here).

### Non-blocking notes

- design.md's citation "DbContext.scala:34-46" for the `withUserContext` single-`DBIO` signature
  claim — the actual method signature is at lines 50-51 (34-49 is class decl + doc comment).
  Substance is correct; pinpoint is imprecise.
- design.md's citation "PipelineRunService.scala:...1079-1082" for the "this dry run's row is
  inserted above... unlike the real-run path" quote — the actual quote is at lines 1090-1093;
  1079-1082 is a different, adjacent doc comment (about never persisting NULL). Carried over
  unchanged from round 1's own citation. Substance independently re-verified true; pinpoint is
  imprecise. `workflow-state.md`'s broader C7 citation range does correctly bracket the real quote.

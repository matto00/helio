## Context

See proposal.md (Why) and ticket.md (owner rulings Q1-Q5, repro). Current state, verified 2026-10-11 on main 5a53d24b9:

- `PipelineRunService.submit` (:184-205) is the only caller of `runPipeline` → `PipelineRunExecutor.executeRun`. It admits the
  owner, and a grantee only when `findGrantRole == Some("editor")` (viewers 403, non-grantees 404 via `findByIdShared`).
- Every run-persistence write is user-scoped AND owner-filtered: `insertRunIfUnderConcurrencyCap` (lock keyed by caller id,
  count over caller-owned pipelines, `NotOwned` for a non-owner), `updateRunTerminal`, `insertDryRun`, `deleteOldRuns`,
  `deleteOldDryRuns` (PipelineRunRepository), `updateLastRun` (PipelineRepository). Callers: `PipelineRunExecutor` preExec
  (:143-159), `PipelineRunTerminalWrites` (:72-81, :93-130, :157-160, :189-192), `PipelineRunSucceededWrites` (:229-232).
- Privileged siblings already exist: `insertRunInternal`, `updateRunTerminalInternal`, `insertDryRunInternal`,
  `deleteOldRunsInternal`, `deleteOldDryRunsInternal`, `updateLastRunInternal` (used by `SparkJobSubmitter`).
- RLS: V35 `pipeline_runs_owner` (owner-only, all commands) and V39 `pipelines_update` (owner-only). Under the editor's own
  context an INSERT raises 42501 and an UPDATE silently touches 0 rows (repro (e)). `insertAssertions` has no owner filter but
  FKs to the run row, so it is a no-op/failure today for editors only because the parent row is missing.
- `pipeline_runs` has `triggered_by_token_id` (V74) but no user attribution column. Last migration on main: V123.

## Goals / Non-Goals

Goals: the spec deltas (both capabilities) with owner-run behaviour byte-for-byte unchanged except the new column value.
Non-goals: see proposal.md; additionally no change to RLS policies, `RlsPolicyGuardSpec` allowlists, `schemas/`, or the
frontend.

## Decisions

### D1 — One "run owner" for every persistence decision; the submitter is only an attribution
`executeRun` derives `runOwnerId = pipeline.ownerId` and `isOwnerRun = pipeline.ownerId == user.id`. Owner runs keep the
existing user-scoped calls unchanged (RLS-enforced, as HEL-505 Decision 4 required). Editor runs (the only other way
`executeRun` is reached) use the privileged path of D2. Alternative rejected: switch everyone to privileged writes — widens
the privileged surface for no gain and changes HEL-505's owner-path guarantee.

### D2 — Editor writes are privileged but never blind: in-transaction re-authorization
Add to `PipelineRunRepository` a privileged, single-transaction counterpart of `insertRunIfUnderConcurrencyCap` for a
grantee submitter (name at the executor's discretion, e.g. `insertGranteeRunIfUnderOwnerCap`). Inside ONE
`ctx.withSystemContext` DBIO: (1) `pg_advisory_xact_lock(hashtext('pipeline-run-concurrency:' || <OWNER id>))` — the SAME key
the owner's own submits take, so owner and editor submits for one owner serialize against each other; (2) re-check that the
submitter is the pipeline's owner or holds an `editor` row in `resource_permissions` for it (same predicate as
`findGrantRole`) — a grant revoked between `submit`'s check and this write yields a new `ConcurrencyCapResult` case (e.g.
`NotAuthorized`), mapped by `executeRun` to `Left(ServiceError.Forbidden("Forbidden"))` without executing; (3) count the
OWNER's non-terminal real runs (same query as today, keyed by owner id) and insert or return `CapExceeded`.
Terminal/last-run/dry-run/retention writes for an editor run use the existing `*Internal` methods (keyed by the
server-generated `runId` / the already-authorized `pipelineId`); `insertDryRun` for an editor gets the same in-transaction
owner-or-editor predicate (one small privileged method), since it has no preceding authorized row to key on.
`NotOwned` is removed or becomes unreachable; no path may treat "not authorized" as "admitted" any more.
**Authorization is checked at admission, not at every write:** the run-row insert (and the dry-run insert) is the one
authorized write; every lifecycle-completion write for an admitted run (terminal status, assertions, `last_run_*`,
retention) always completes via `*Internal`, even if the grant is revoked mid-run. Re-checking there would leave a
revoked editor's run `queued` forever, permanently holding one of the owner's concurrency slots. A revoke committing
concurrently with the admission check can still be missed; that window is accepted. New privileged call sites carry the
inline comment `withSystemContext` call sites require. Owner ruling Q5 supersedes HEL-505 Decision 4 ("no new
privileged bypass") for the editor path only.
Alternative rejected (owner ruling Q5): extending RLS policies to editors.

### D3 — Attribution column
Migration `V124__pipeline_runs_triggered_by_user.sql` (re-check the next free number on origin/main before committing):
`ALTER TABLE pipeline_runs ADD COLUMN triggered_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;` No default,
no backfill, no data UPDATE (an UPDATE under Flyway's non-BYPASSRLS role is the v0.7.x incident class — avoided entirely).
FK actions bypass RLS, so user deletion keeps working. `insertRunRowAction`/`insertDryRunInternal`/`PipelineRunRow` carry
`triggeredByUserId: Option[UUID]`; every submit path passes `Some(user.id)`. `recordUnrunnable` also passes it.

### D4 — Thread the run's persistence mode through the terminal writers
`PipelineRunTerminalWrites`/`PipelineRunSucceededWrites` currently take `user` and call user-scoped methods. Pass an explicit
flag/value (e.g. `isOwnerRun` or a small `RunPersistence` sum) and branch to the `*Internal` methods for editor runs. Keep
the existing ordering invariants (assertions after their parent row; HEL-873 same-statement truncation pairs; HEL-1366
terminal-event-after-writes). Do not change the owner branch's calls.

### D5 — Tests (red first)
Convert `backend/src/test/scala/com/helio/services/pipelines/Hel1492ReproSpec.scala` (uncommitted characterization spec, runs
as a NOBYPASSRLS role on `VerifiedEmbeddedPostgres.start`) into the permanent spec asserting the NEW behaviour; capture its red
run against unchanged main code before implementing. Invert (never delete) every test pinning the old behaviour: `PipelineRunServiceSpec` :521-545 (two tests),
`PipelineRunGuardIntegrationSpec` :370-385 ("editor real run ... NEVER as a 429"), `PipelineRunRepositorySpec` :626-638
(`NotOwned`); update the NotOwned doc comments (PipelineRunRepository :124-128, :443-447; PipelineRunExecutor :149-152). Cap tests must hold the owner's slot with a genuinely in-flight run (the gated-backend Promise fixture in
`PipelineRunGuardIntegrationSpec` ~:150/:303, or a seeded `queued` row) — `submit` resolves only once terminal, so a
sequential submit never fills a cap. Also fix stale comments at `PipelineRunServiceSpec` :553-556/:578-579 and
`PipelineRunTerminalWrites` :91-100. Retention: 11 editor real runs → 10 rows, 11 editor dry runs → 10 `dry_run` rows,
both failable by leaving the editor branch on owner-scoped `deleteOldRuns`/`deleteOldDryRuns`. Cover: editor
success/failure/blocked/dry and both write-back-failure branches (`Left` at PipelineRunExecutor
:306-308 and the exception path at :301-304), each asserting the row reaches a terminal status and `last_run_*` is
updated, cap (owner at cap → editor 429 without execution;
editor in flight → owner's next submit 429 at cap=1), revoked-grant race (D2 step 2) and viewer/non-grantee no-write,
`triggered_by_user_id` for owner/editor/scheduled. Each new guard-style assertion must be shown failable by a mutation
(count keyed by submitter id, re-auth predicate removed, an editor branch left on owner-scoped `updateRunTerminal`). Lock
keying needs its own deterministic test: hold `pg_advisory_lock(hashtext('pipeline-run-concurrency:'||ownerId))` on a
separate session and assert the editor's admission insert blocks until it is released (the "lock keyed by submitter" mutation
must make this test fail).

## Risks / Trade-offs

- [An editor can consume the owner's concurrency slots] → owner ruling Q2; the owner can revoke the grant; documented in
  CLAUDE.md.
- [Privileged writes on a user-triggered path] → only reached after `submit`'s ACL and re-authorized in the same
  transaction as the insert; terminal writes key on a server-generated run id.
- [Stuck slot: an editor run row left non-terminal (any editor branch still on owner-scoped `updateRunTerminal`) would hold
  one of the owner's slots forever] → every terminal branch, including both write-back-failure paths, is tested for a
  terminal row; lifecycle writes never re-check authorization.
- [Lock-ordering deadlock] → only one advisory lock (owner key) is ever taken per submit.
- [Migration on an RLS-forced table] → DDL only, nullable, no default/backfill.

## Migration Plan

Deploy order irrelevant (additive nullable column; old code ignores it). Rollback: revert code; column may stay.

## Planner Notes

- Self-approved: attribution stored but not exposed (proposal Non-goals); schema-drift baseline gap filed as follow-up.
- Self-approved: the dormant `SparkJobSubmitter` path (:69) keeps writing NULL `triggered_by_user_id` (not reachable by
  editors; no user in scope) — acknowledged, not changed.
- Expected side effect: in-flight editor runs become visible to the scheduler overlap guard and hook duplicate-collapse
  (they read `pipeline_runs`) — correct, since they are real in-flight runs.
- Self-approved: scheduler/hook callers unchanged — their `user` is already the owner or the token's user and flows into D3.

## Forbidden-producer classification (HEL-1492)

`ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` pins every `ServiceError.Forbidden` producer. The new
`PipelineRunExecutor.scala -> 1` (the `NotAuthorized` arm of the admission match) is a legitimate 403, not an
existence leak: it is reachable only after `PipelineRunService.submit` has resolved the pipeline with
`findByIdShared(.., Some(user))` and cleared the owner-or-editor check, so the caller already holds a visible pipeline;
the 403 means "your grant was revoked / the pipeline vanished since that check". An unknown or invisible pipeline is still
the unchanged 404 from `submit`.

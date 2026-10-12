## Context

See proposal.md (Why) and ticket.md (scope, owner rulings). Current state, verified 2026-10-11 on main 60bcd8646:

- `PipelineRunSucceededWrites` (:247-256) captures the baseline with `dataSourceRepo.findByIdOwned(sourceDataSourceId, user)`
  then `pipelineRepo.updateLastSourceSchema(pipelineId, json, user)`. Both are owner-filtered for the SUBMITTER: for an
  editor the read yields `None` → `Vector.empty`, and the write (`withUserContext` + `ownerId === caller`) touches 0 rows.
  The same method already branches every other write on `ownerRun` (HEL-1492 D4), e.g. `writeLastRun`/`writeTerminal`.
- The analyze (compare) side reads each root's source with `findByIdOwned(dsId, user)` (`PipelineAnalyzeReads.scala:77`):
  for the owner's analyze, a root source the owner does not own reads as `[]`. A primary root the owner does not own is
  reachable (an editor can attach a root bound to their own source via `PipelineRootWrites.attachRoot` and remove the
  original). `runPipeline` (`PipelineRunExecutor.scala:52-56`) resolves roots via `*Internal` BEFORE admission; an empty
  result returns `422 "DataSource not found for pipeline"` — and `pipeline_roots` cascades with the pipeline (V99 note).
- Admission (`PipelineRunRepository`): owner path `insertRunIfUnderConcurrencyCap` takes the owner-keyed advisory lock, then
  `pipelineOwnedAction` → `NotAuthorized` when the row is gone; grantee path `insertGranteeRunIfUnderOwnerCap` reads
  `owner_id` unlocked, then lock, re-auth, count, insert. Nothing locks the `pipelines` row, so a `DELETE` committing after
  the existence/owner read and before `insertRunRowAction` makes the insert fail with FK violation 23503
  (`pipeline_runs.pipeline_id REFERENCES pipelines ON DELETE CASCADE`, V24) → unmapped exception → 500.
  `PipelineRunExecutor` (:162-165) maps `NotAuthorized` to `Forbidden`.
- Dry runs skip `preExec` entirely (:145) and execute; `insertGranteeDryRun` re-checks owner-or-editor only AFTER execution
  and silently writes nothing.
- Specs: `pipeline-run-guard/spec.md:34` title "per-user concurrency cap" and Purpose ":4 a single user";
  `pipeline-run-execution/spec.md:4` Purpose "TBD".

## Goals / Non-Goals

Goals: the spec deltas, with owner-run persistence behaviour unchanged except where a delta says otherwise.
Non-goals (in addition to proposal.md): no new `ServiceError` type, no RLS policy change, no migration, no change to
`RlsPolicyGuardSpec` allowlists, no change to lifecycle-completion writes (HEL-1492 D2 "authorize at admission").

## Decisions

### D1 — Baseline write follows the run's persistence mode (item 1)
Add `PipelineRepository.updateLastSourceSchemaInternal(id, schemaJson)` (`withSystemContext`, no owner filter, inline
comment as every `withSystemContext` site requires). `PipelineRunSucceededWrites` calls the existing user-scoped
`updateLastSourceSchema` when `ownerRun`, and the Internal variant otherwise — identical to how HEL-1492 branched
`writeLastRun`. Safe: an editor reaches this method only for a run admitted by `insertGranteeRunIfUnderOwnerCap`'s
in-transaction re-authorization; the write keys on the already-authorized `pipelineId`; per HEL-1492 D2 lifecycle writes
are not re-authorized (a revoke mid-run still refreshes the baseline of a run that legitimately happened).
Alternative rejected: re-check the grant before the baseline write — inconsistent with every other lifecycle write.

### D2 — The baseline's source schema is read as the PIPELINE OWNER sees it, on both branches (item 1)
The capture must equal what the owner's analyze compares against (`findByIdOwned(dsId, owner)`, see Context). Add
`DataSourceRepository.findByIdOwnedByInternal(id, ownerId: UserId)` — system context, filter
`id === id && owner_id === ownerId` (inline `withSystemContext` justification: the run is already authorized; the explicit
owner filter reproduces the owner's own view without impersonating the owner's session). `PipelineRunSucceededWrites`
calls it with the PIPELINE's `ownerId` (threaded from `executeRun`'s `pipeline`) on BOTH branches, replacing
`findByIdOwned(sourceDataSourceId, user)`. Owner runs: identical filter to today (submitter == owner) → byte-for-byte
unchanged. Editor runs: capture exactly what an owner run would — never `[]` merely because the editor does not own the
source, and never the editor-owned source's columns when the owner cannot see that source (which would make the owner's
analyze report every column as removed). Re-read timing after the run is unchanged.
Alternatives rejected: `findByIdInternal` uniform read (round 2: false-drift regression for an owner whose primary root
is editor-owned); editor-only `findByIdInternal` (same regression on the editor branch); constructing an
`AuthenticatedUser` for the owner to call `findByIdOwned` (impersonates a session identity).

### D3 — Admission distinguishes "gone" from "not authorized"; no 500 (item 4)
Both admission transactions start with the SAME plain-SQL row read (Slick has no key-share option; a row lock cannot sit
inside an `.exists` wrapper): `SELECT owner_id::text FROM pipelines WHERE id = $id FOR KEY SHARE`, executed BEFORE the
owner-keyed advisory lock on both paths (uniform lock order: row key-share lock → advisory lock; key-share locks do not
conflict with each other and `DELETE` takes no advisory lock, so no lock cycle is possible). Then:
- Owner path (`insertRunIfUnderConcurrencyCap`, owner's RLS user context; `FOR KEY SHARE` passes V39 `pipelines_update`'s
  USING for the owner): no row → `PipelineGone`; row with `owner_id == caller` → advisory lock, count, insert; row with a
  different owner → `NotAuthorized` (unreachable in production — the owner path is only taken when `submit` saw the caller
  as owner and no ownership-transfer write exists, while RLS would hide a non-owned row and yield `PipelineGone`; reachable
  only under the superuser repository harness, so the `PipelineRunRepositorySpec` :629 `NotAuthorized` pin stays valid
  and unchanged). This replaces `pipelineOwnedAction` in this method only.
- Grantee path (`insertGranteeRunIfUnderOwnerCap`, system context): no row → `PipelineGone`; row → advisory lock keyed by
  that owner id, `submitterMayRunAction` (false → `NotAuthorized`), count, insert — as today.
A concurrent `DELETE` either committed first (row absent → `PipelineGone`) or blocks until admission commits (the run row is
then cascaded with the pipeline — the pre-existing behaviour for any run in flight at deletion). So the FK violation
23503 is unreachable and is NOT separately mapped. `PipelineRunExecutor` maps `PipelineGone` →
`ServiceError.NotFound("Pipeline not found: <id>")`, `NotAuthorized` → `Forbidden` (unchanged).
Deletion BEFORE admission is mostly caught earlier: roots cascade with the pipeline, so `runPipeline`'s empty-roots branch
fires first. That branch gains a privileged existence check (`pipelineRepo.findByIdInternal(pipelineId)` — read-only,
keyed by the id `submit` just authorized): absent → `ServiceError.NotFound("Pipeline not found: <id>")`; present (a
genuinely root-less pipeline) → the existing 422, unchanged. So 404 holds across the whole window: deleted before root
resolution → empty-roots branch; deleted after root resolution → admission `PipelineGone` (real) / D4 re-check (dry).
Existence signal (owner ruling A, accepted): a just-revoked editor can distinguish 403 (exists) from 404 (deleted).
Alternative rejected: catch 23503 only — leaves the owner's mid-submit delete answering 403, and a failed statement
aborts the transaction so the commit can still throw.

### D4 — Dry runs re-verify before executing (item 5)
Add a privileged, read-only `PipelineRunRepository.checkRunAuthorizationInternal` returning a new sealed
`PipelineRunRepository.RunAuthorization` (`Authorized` | `NotAuthorized` | `PipelineGone`; distinct from
`ConcurrencyCapResult`, which has no `Authorized`) for (pipelineId, submitter) using `submitterMayRunAction`. `executeRun` calls it for
every dry run (owner or editor) right after the rate-limit check and before `backend.execute`; `NotAuthorized` →
`Forbidden`, `PipelineGone` → `NotFound` (D3). No row is written for a refused dry run. Placement: after the rate-limit
check (matches real-run admission) and BEFORE the `queued`/`running` events are published; skipped when
`pipelineRunRepo == null` (fixtures), mirroring `preExec`. This adds a second `Forbidden` producer in
`PipelineRunExecutor.scala`: `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` goes 1 → 2, classified here as
legitimate (reached only after `submit`'s `findByIdShared` + owner-or-editor check; the pipeline was visible). A revoke after this check is an
accepted race, identical to the real-run window. `insertGranteeDryRun`'s post-execution check stays.

### D5 — Spec text (item 6)
RENAMED delta for the guard requirement → "Pipeline-run submission enforces the pipeline owner's concurrency cap";
direct edits to `openspec/specs/pipeline-run-guard/spec.md` Purpose and `openspec/specs/pipeline-run-execution/spec.md`
Purpose (openspec: Purpose changes are direct edits, not deltas).

### D6 — Tests (red first)
New spec `Hel1503EditorRunGapsSpec` on `VerifiedEmbeddedPostgres.start`, mirroring
`backend/src/test/scala/com/helio/services/pipelines/PipelineRunEditorPersistenceSpec.scala` (HEL-1492's NOSUPERUSER
NOBYPASSRLS role, advisory-lock-holder pattern, `StaleGrantPipelineRepository` seam). Two deletion seams, both named:
S1 "delete at access check" — a `findByIdShared` override that deletes the pipeline after returning it (the
`StaleGrantPipelineRepository` shape); S2 "delete after root resolution" — a wrapper whose root/step listing
(`pipelineStepRepo.listByPipelineInternal`, reached after roots resolve and before admission/D4) deletes the pipeline.
Red against unchanged main first; one named mutation per case, recorded in red-run.md:
(a) editor real run, source owned by the pipeline owner → `last_source_schema` equals its schema (red: NULL).
    Mutation: owner-scoped write on the editor branch.
(b) editor real run where the PRIMARY root's source is editor-owned (owner cannot see it) → baseline equals what an owner
    run stores (`[]`), matching the owner's analyze (no drift reported). Mutation: `findByIdInternal` read.
(b2) owner real run, owner-owned source → baseline unchanged from today. Mutation: read keyed by submitter not owner is
    caught by (a)/(b), so (b2) is a regression pin only (labelled as such).
(c) owner real run, S1 → 404, spy backend never executes, no run row. Mutation: drop the empty-roots existence check (422).
(d) owner and editor real runs, S2 → 404 (never 403/500), spy never executes, no row. Mutation: map `PipelineGone` to
    `Forbidden`.
(e) row lock taken, owner path and grantee path each: test session holds
    `pg_advisory_lock(hashtext('pipeline-run-concurrency:'||ownerId))`; start admission; poll `pg_locks` until the
    admission's backend is waiting (`granted = false`, `locktype = 'advisory'`) — no `Thread.sleep`; a third session runs
    `SET lock_timeout='500ms'; DELETE FROM pipelines WHERE id=...` and must fail with SQLState 55P03; release.
    Mutation: remove `FOR KEY SHARE` on that path (DELETE succeeds).
(f) revoked editor dry run (seam revokes between ACL and execution) → 403, spy never executes, no row. Mutation: skip D4.
(g) dry run, owner and editor, S1 and S2 → 404, spy never executes, no row. Mutation: D4 maps `PipelineGone` to 403.
(h) live editor dry run and owner dry run unaffected (rows returned, `dry_run` row written) — regression pin.
Invert, never delete: `PipelineRunEditorPersistenceSpec.scala:427-432` ("NotAuthorized for a pipeline that no longer
exists") → `PipelineGone` on both paths; grep `NotAuthorized`/`Forbidden`/`DataSource not found` in pipeline-run specs.
`PipelineRunRepositorySpec` :629 stays (D3). `[hel1468-guard]` must appear in the sbt output.

## Risks / Trade-offs

- [Row lock on `pipelines` during admission] → `FOR KEY SHARE` only conflicts with DELETE/key UPDATE, not ordinary edits;
  held for one short transaction already serialized by the advisory lock.
- [Privileged baseline write] → keyed on an admitted run's pipeline; same justification as HEL-1492 D2.
- [Dry-run re-check adds one query per dry run] → single indexed read; dry runs are rate-limited already.

## Planner Notes

- Self-approved (design-gate round 2): D2 reads as the pipeline owner sees the source; the owner-side "non-owned primary
  root reads as `[]` on both capture and compare" is consistent (no drift), not a bug — no follow-up.
- Self-approved: baseline READ side (grantee analyze shows no drift) is a follow-up, not this change.
- Owner rulings (ticket.md, A/A/A) confirm D3 (404 gone / 403 revoked / no 500) and D4 (dry-run 403 before execute).

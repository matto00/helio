## Context

See proposal.md (Why). Current code, verified on main at 14c08def8:

- `PipelineRootWrites.addRoot`/`removeRoot` accept owner or `editor` (`requireEditorAccess`); viewer gets 403, a user
  with no grant gets 404 from `findByIdShared`.
- `PipelineRootRepository.add` runs its chain (source `FOR KEY SHARE`, cycle guard, definition lock, insert) in
  `ctx.withUserContext(user)`. `removeRoot` runs `removeRootCascadeAction` + `removeAction` + `compactPositions` via
  `pipelineRepo.runTransactionally(user)` = `withUserContext`.
- `pipeline_roots` writes are owner-only (V98 §11); `pipeline_steps` is owner-only for every command (V35). For an
  editor the insert violates `WITH CHECK` (500) and every DELETE in the remove transaction matches 0 rows (200).
- `DraftSaveRlsSpec.scala:57-88` (HEL-1629 C5) pins exactly these two defects as "no editor root race exists", and
  HEL-1629's archived writer inventory (`g1-writers.md` W29/W30) rests on that.
- Editors' step writes already run on the privileged (BYPASSRLS) connection after the service check
  (`PipelineStepRepository` internal variants, HEL-1101 Decision 4); HEL-1629's draft save is one privileged transaction.

## Goals / Non-Goals

**Goals:** one rule (owner or editor may add/remove roots) enforced by the service and honoured by the database path
it uses; no 5xx and no false 2xx for any role; viewer 403 and stranger 404 unchanged.

**Non-Goals:** RLS policy changes; who may attach which source (still `findByIdOwned` = the actor's own source);
frontend changes (HEL-1685 lane owns draft-mode polish); editing archived HEL-1629 evidence.

## Decisions

**D1 — Rule: editors allowed (a delegated decision, newly effective in prod).** The ticket delegates the rule. Editors
win because the service contract (`addRoot`/`removeRoot` scaladoc, HEL-913 R6/R7) already says "Editor or Owner",
editors can already add/delete steps (whose cascade deletes Outputs and unbinds panels), HEL-1629 lets editors save a
definition, and the live spec `dataset-write-auto-run/spec.md:163` already describes an editor's source bound as a root
of another user's pipeline. It is NOT a pure bug fix of a working contract: the HEL-913 design
(`archive/2026-09-04-multi-root-pipelines/design.md:481-488`) called grantee root writes a privilege escalation, and
editors have never been able to do this in prod. The PR body SHALL state the decision and these consequences so the
owner can overturn it: (a) an editor's root remove deletes the owner's steps and Outputs under that root and unbinds
panels on any dashboard; (b) a source an editor attached outlives a later revoked grant; (c) the editor's dataset
writes to that source can auto-run the owner's pipeline (HEL-1093). Alternative "owner-only" (403 editors) rejected
for the reasons above; it remains the fallback if the owner overturns D1.

**D2 — Root writes run on the privileged connection after the service check, for owner and editor alike.**
`PipelineRootRepository.add`'s chain moves to `withSystemContext`; the remove transaction runs via a privileged
transactional runner instead of `runTransactionally(user)`. Every statement is already filtered explicitly by
`pipelineId`/`rootId`/`dataSourceId`; `removeAction` additionally gains a `pipelineId` filter. The executor SHALL audit
each statement in both chains for an RLS-supplied filter and record the result. **Behaviour change, intended:** under
user context an editor's cycle check (`checkAddReadAction` -> `findUpsertWriteEdges`, which joins owner-only
`pipeline_steps`) could not see the owner's steps and passed vacuously; on the privileged pool it sees them, so an
editor's root add that closes a cycle through the owner's `upsertsource` step is now a 400 with nothing written.
Alternatives rejected: editor-aware RLS policies (new migration) fix `pipeline_roots` only, not the
`pipeline_steps`/`node_snapshots` deletes in the same transaction, and widen DB write privilege for every user-context
writer; a privileged path for editors only would leave two paths for one operation.

**D3 — Locks: unchanged, no executor work.** `hel1629_lock_pipelines` is `SECURITY DEFINER` owned by
`helio_privileged` with `row_security = off` (V137); the panel lock follows V129's pattern; the source `FOR KEY SHARE`
is on a source the actor owns. Same statements, same order on the new path (HEL-1629 D5 / HEL-1498).

**D4 — One shared remove transaction; lock-protocol coverage of the editor case.** HEL-1629's W29/W30 "no editor
race" premise becomes false. Today four specs rebuild the phase-2 remove transaction themselves on the user-context
runner (`DraftSaveRaceSpec.scala:142-146`, `DraftSaveDeadlockSpec.scala:81-83`,
`PipelineCascadeLockOrderRaceSpec.scala:85-87`, `OutputDeleteRacesPanelCreateSpec.scala:126-128`), so they would not
run the code production runs after D2. The phase-2 transaction (cascade, `pipelineId`-scoped `removeAction` with the D5
0-row abort, `compactPositions`), run on the privileged connection, SHALL be ONE shared method that `removeRoot` and all
four specs call. Owner and editor then run the identical privileged transaction (same locks, same order; only the
service-level authorization differs), so the owner-actor race/deadlock specs exercise the editor's path too. Add is
already covered: the race specs call `rootRepo.add` directly. The race/deadlock specs SHALL be run on the changed code
with output recorded, plus one editor-actor root-add race case in `DraftSaveRaceSpec`. Mutation: pointing the shared
method back at the user-context runner turns an editor remove case red.

**D5 — No false 2xx on remove.** `removeAction`'s delete count is checked inside the shared transaction; 0 rows aborts
with a dedicated exception that `removeRoot` maps to 404 `Root not found` BEFORE the generic `classifyDbError` recover
(never a 500). Reachable only by a race after phase 1, so it is tested at the shared-method seam with a setup where the
cascade actually deletes steps/snapshots first, via an in-transaction hook between the cascade and `removeAction`
that deletes the root row (deleting the root up front does not work: V98's `root_id ON DELETE CASCADE` takes the steps), asserting 404 and that those steps/snapshots are still present
(rollback is real, not vacuous).

**D6 — Production grant evidence.** This is main code's first privileged-pool INSERT/UPDATE/DELETE on `pipeline_roots`,
and `TwoUserRlsApiFixture.scala:136` grants `helio_privileged` broad write access, which would hide a missing grant.
The executor SHALL prove, independently of that fixture grant, that migrations alone give `helio_privileged`
INSERT/UPDATE/DELETE on `pipeline_roots`, DELETE on `pipeline_steps`/`node_snapshots`, and UPDATE on `data_sources` (the add chain's `FOR KEY SHARE` row lock) — e.g. a
`has_table_privilege` assertion in the non-superuser Flyway migration harness — and add a migration granting them only
if that check is red.

**D7 — Tests are red first, on a NOBYPASSRLS role.** The two `DraftSaveRlsSpec` C5 tests are replaced (their premise
is the defect) by tests asserting: editor add 2xx + root read back; editor remove 2xx + root, its steps and their
snapshots gone; viewer 403 and stranger 404 with state unchanged for both verbs; owner add/remove still 2xx; editor
cycle-closing add 400 with nothing written. The new editor tests are first run against unchanged code and their red
output kept. Mutation: reverting D2's add change alone re-reds the editor-add test; reverting the remove change alone
re-reds the editor-remove test — both required.

## Risks / Trade-offs

- [Privileged path drops a scoping filter RLS used to supply] → D2 audit; viewer/stranger tests assert no mutation.
- [Owner disagrees with D1] → PR body lists consequences; fallback is owner-only 403 for editors.
- [Local superuser DB hides RLS and grants] → MISTAKES.md; only NOBYPASSRLS fixture + D6 grant check count.

## Planner Notes

- The pre-existing race-only 500 when a pipeline is deleted during `add` (pipeline-name `.head`) is out of scope;
  follow-up candidate.
- D1 self-approved because the ticket explicitly delegates it; surfaced to the owner in the PR body, not escalated.
- AC (e): editor draft save on NOBYPASSRLS is already covered by `DraftSaveRlsSpec:14-48`; the evaluator's UI check of
  an editor adding/removing a root runs on a superuser DB and proves the flow only.

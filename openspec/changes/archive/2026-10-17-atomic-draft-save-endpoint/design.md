## Context

`docs/live-draft-preview.md` §8 is the spec; this records how it is built and, above all, how §8.3 is VERIFIED. Facts
checked at planning (main 29cb0a60f): `updateInternal` (PipelineStepRepository.scala:487), `deleteInternal` (:994),
`reorderTrunkInternal` (:866) each run their own `withSystemContext(...transactionally)` on the privileged (BYPASSRLS)
pool; `PatchSetPipelineDefinition.of` hashes a pre-read summary plus six separate privileged `Future` reads;
`PipelineCycleGuard` takes a GLOBAL `pg_advisory_xact_lock`; `rewriteUpsertTargetAction` (:124) locks its step row
FOR UPDATE and THEN takes the advisory lock; an FK child insert (step, root, run, panel or history row on an Output)
takes `FOR KEY SHARE` on the parent, which `FOR NO KEY UPDATE` does not block; `pipelines_update` (V39:87) and
`outputs_update` (V94:246) are owner-only; the journal (`patch_set_applications`, V79) is RLS-scoped to the actor.

## Goals / Non-Goals

**Goals:** one-transaction declarative save; stale-base 409 atomic against every writer of fingerprinted state (G1),
no new deadlocks (G2), complete journal (G3), each proven by specs shown red without the protocol; atomic undo per
ruling; run-after-save through the unchanged guard.
**Non-Goals:** see proposal. No SERIALIZABLE (§8.3: blind to READ COMMITTED writers); no HEL-505/HEL-1492 guard change.

## Decisions

**D1 Contract.** `POST /api/pipelines/:id/draft/save`, body `{baseFingerprint, steps: DraftStep[], outputs:
DraftOutput[], runAfterSave?: "run"|"dryRun"|null, confirmCascade?: {stepIds[], outputIds[], panelIds[],
alertRuleIds[]}}`. `DraftStep = {id|clientId, type, config, enabled, parentStepId|parentClientId?, rootId?,
position}`; `DraftOutput = {id|clientId, name, kind, nodeStepId|nodeStepClientId?, rootId?, config}`. 200 →
`{saved: {fingerprint, definition: {steps, outputs}, applicationId}, run: null | {started: true, runId, status} |
{started: false, code, retryAfterSeconds?, reason}}`. Errors: 400 shape/validation (names the step), 403 viewer, 404
invisible or deleted, 409 `PATCH_SET_STALE` (`stale: [{index: 0, kind: "pipeline", id}]`, `PatchSetStaleMessage`, plus
`currentFingerprint`), 422 cascade impact (`PatchSetPreviewImpact` shape). An `id` not currently in THIS pipeline is a
400 (explicit ids are undo-only, D7). Roots, name, tag, schedule are not editable here but are fingerprinted.

**D2 Diff — the body IS the final tree.** Pure `DraftDiff.plan(current, draft): Either[ServiceError, DraftPlan]`:
removed steps = EXACTLY current ids absent from the draft (no `removalOf` expansion, no splice: the server never
deletes a step the draft keeps; splice/absorb is the client's job when it builds the tree). Removed Outputs = current
Outputs absent from the draft plus those cascaded by a removed node step; a draft Output whose node step is removed is
a 400. The draft must be a valid forest (one root-level head per root lane, `parentStepId`/`rootId` exclusive per V98's
CHECK, no cycles) → else 400. In-tx order so the NO ACTION `parent_step_id` FK (V94:172) cannot trip: (a) insert
creates in topological order with final parents/roots; (b) re-link every surviving step to its final
parent/root/position; (c) delete the removed set in ONE `DELETE` (FK checked at statement end); (d) config/enabled
updates; (e) Output deletes/creates/updates; then `LaneCycleViolations.introduced` and `PipelineCycleValidator` on the
final rows (failure = `DBIO.failed` = rollback). The 422 impact is exactly this removed set plus its panels and alert
rules. Undo (D7) uses the same rule, so restoring a branching step's deletion is just its prior tree.

**D3 Composable writes.** Extract `updateAction`, `reorderTrunkAction` and LOCK-FREE delete cores (`deleteCoreAction`,
`deleteOutputCoreAction`); the existing `Future` methods keep calling `lockForDeletion` then the core inside
`withSystemContext` (behavior-preserving, existing specs green unchanged). The save calls only the cores under its ONE
up-front `lockForDeletion`; a spec asserts exactly one `hel1498_lock_panels` call per save via
`pg_stat_user_functions` deltas on the spec's own embedded DB (no shared mutable test counter).
`PatchSetPipelineDefinition.ofAction(pipelineId): DBIO[JsObject]` re-reads name, tag and roots itself; `of` delegates.
**Pool pinning:** the fingerprint covers other users' panels and alert rules, so `ofAction` MUST run on the privileged
pool at EVERY call site (save, GET, patch-set preview/apply, undo); a user-context run would hide rows, never match the
save's hash and make the save 409 forever (unfixable under reload-only). Parity spec: same state → same hash across
call sites; a rename after an early summary read IS reflected.

**D4 Transaction context.** Privileged pool after the service ACL (`findByIdShared` + owner-or-editor, the
`PipelineStepWrites` precedent); created rows stamped with the PIPELINE OWNER, journal row with the ACTING user, the
run submitted as the actor (HEL-1492 owner-keyed cap). Owner `withUserContext` is rejected: the editor's journal row
fails `patch_set_applications_owner`, and app-pool `FOR UPDATE` silently skips rows RLS hides, voiding G1.

**D5 Lock protocol — HYPOTHESIS H, verified by D6, not assumed.** Order: (1) `lockForDeletion(pipelines = Seq(p))`
once, first (panels, then their dashboards, V129/V130); (2) the cycle advisory lock, iff the pre-lock plan adds or
changes an upsertsource write edge; (3) the pipeline row `FOR NO KEY UPDATE`; (4) alert rules targeting its Outputs `FOR UPDATE` by id;
(5) its Outputs `FOR UPDATE` by (position, id) (verified order and amendments: `docs/live-draft-preview.md` section 8.3.1). Then `ofAction` → re-plan on the locked state → compare → writes →
journal → commit. If the re-plan needs (2) and it was not taken → 409 (an upsert edge changed, so did the state); (2)
is NEVER taken after (3). (3) uses a SECURITY DEFINER helper `hel1629_lock_pipelines(p_pipeline_ids text[], p_source_ids text[]) RETURNS integer` (V129
pattern, id order): an app-pool editor's plain `FOR ... UPDATE` would lock ZERO rows silently under the owner-only
policies. Count < |ids| means a racer deleted a pipeline: the save returns 404; a single-pipeline writer does not branch on the count, its write runs against the vanished pipeline and takes its current not-found path (FK violation / zero rows; pinned by `DraftSaveRaceSpec` "after a racer deleted the pipeline"); a set writer (source delete, teardown) ignores the shorter count and carries on — never a silent successful write, never a new hard 500. Editor-capable app-pool
writers
(`PipelineRootRepository.add` :78, `PipelineRootWrites` remove :216, an editor's `DataSourceRepository.delete` of a
source rooted in the owner's pipeline :274-282) use the helper. Writers FK key-share cannot exclude take (3) after
their own (1)/(2) and BEFORE any step-row lock, only where C1 evidence demands it. **Set-reading writers:** source
delete locks (3) over a set it READ (pipelines rooted on X), which a concurrent root add can grow after the read
(round-3
interleaving: the delete then cascades P's root/steps/Outputs mid-save without P's lock). Hypothesis H′: source delete
first takes its `data_sources` row `FOR UPDATE` (conflicts with every root add's FK key-share, so the set is frozen
before it is read), then `lockForDeletion(dataSources)`, then (3) over the frozen set; root add takes its source's
key-share explicitly BEFORE (2)/(3). That puts source rows at the FRONT of the global order (source → panels →
dashboards → advisory → pipeline → Outputs → alert rules), which must be argued for every participant that locks a
`data_sources` row (dataset write-backs in `applyWriteBacks`/`rewriteUpsertTargetAction` lock a source AFTER their step
row — a candidate cycle to probe). If no consistent order exists, escalate (C3). A pipeline found already deleted by a
racer is dropped from the set and the delete carries on (never refused). `rewriteUpsertTargetAction` needs RESTRUCTURING
(advisory before its step row),
not just an extra lock. Known G2 hazards to probe: (a) that rewrite vs an advisory-holding save; (b) root add
(advisory → pipeline); (c) panel create (dashboard → Output key-share) vs (4); (d) the run's node-snapshot transaction,
whose history inserts key-share Outputs in `position` order (`listByPipelineInternal` :102-107, V115:24) while (4)
locks by id → a node with two Outputs whose position order differs from id order may cycle; (e) alert evaluator vs
(5); (f) `applyWriteBacks`; (g) workspace teardown.

**D6 Verification (iron law: no protocol change without a probe-confirmed cause).** Phase A, before any lock is added:
task 1.1 enumerates (i) every writer of fingerprinted state and FK cascade, and (ii) every transaction that takes ANY
of locks (1)-(5), fingerprint writer or not, each with file:line, pool and lock sequence → `evidence/g1-writers.md`.
Every (ii) participant gets EITHER a written argument, citing its lock statements, that its order is consistent with H,
OR a place in the deadlock spec (the snapshot transaction is in it by name, with a reversed position/id fixture). Race
specs (task 6.3 lists each writer INDIVIDUALLY, per §12(c); grouping only by an identical lock path proven with
file:line in `g1-writers.md`) run against the save BEFORE any writer instrumentation. Only locks the save takes BEFORE
its fingerprint read protect it: under READ COMMITTED a writer uncommitted at that read is overwritten when the save's
UPDATE re-checks after the writer commits. Each race spec choreographs BOTH orders (writer holding its open
transaction across the save's read; save first), asserted by `pg_locks`/`wait_event_type`, not sleeps; the red without
a lock is recorded writer-first. Pass = 409 or the writer waits/fails with a NON-deadlock error; `40P01` is a FAILURE
in every race spec. Only a red race earns a writer the lock (4.1 follows 6.3); a writer excluded by (1)/(4)/(5) shows
green. Task 1.1 flags every writer that locks (3) over a set it read; each gets a THREE-session race spec (set-grower,
set-reader, save), red first. Phase C: every race and the deadlock spec green; each added lock mutation-tested (remove →
red). The deadlock
spec runs the ticket's five plus every writer that gains (3), the rewrite, the snapshot transaction and an
advisory-taking save, plus a root add and a source delete on the SAME source, bounded repeats, no `40P01`. If H cannot
meet G1-G3, STOP and escalate with transcripts and
options (C3); a fix to an existing participant's order also needs its red first (C1).

**D7 Journal and undo.** Same transaction: one `patch_set_applications` row (DBIO `create`, prune-to-20), one edit
`{targetKind: "pipelineDefinition", op: "save", priorState: ofAction(prior) + raw step/Output rows, resultingState:
{fingerprint}}`. `PatchSetUndoService.undo` dispatches it (before `checkAll`) to `DraftSaveService.restore`: a removed
Output with panels or alert rules in the journaled prior state → 409 naming each; else re-run the save with the prior
definition, `baseFingerprint = resultingState.fingerprint`, `allowExplicitIds = true` (original ids; no public request
can set it). What the save created is deleted under a confirmation undo derives itself under the locks; any panel or
alert rule in that impact → 409 naming it, never a delete. A run that rewrote a NewSource upsert step changes the
fingerprint, so such a save can no longer be undone (documented). Undo recreates definitions only: cascade-deleted
run history, snapshots and payloads are data and are not restored (documented). Undo writes its own journal row.

**D8 Run after save.** After commit: `PipelineRunService.submit(p, isDry, user)` unchanged.
`Left(TooManyRequests(s, reason))` → `run: {started: false, code: 429, retryAfterSeconds: s, reason}` in a 200; other
errors → `run: {started: false, code, reason}`; never a rollback.

**D9 Checks kept.** ACL (D4); `validateStepCrossOwnerRefs`, `UpsertTargetCheck` (outside the tx);
`PipelineStep.rawConfigProblem` per created/updated step; cascade 422 unless `confirmCascade` covers every removed
step/Output/panel/alert rule, the impact recomputed under the locks (a panel bound after the client's preview forces a
fresh 422, not a silent delete: G3); one audit row `pipeline.draft.save`.

**D10 Read side.** `GET /api/pipelines/:id` gains `fingerprint` (list unchanged), computed by `ofAction` on the
privileged pool after the ACL, in ONE read-only REPEATABLE READ transaction. Separate step/Output reads are unsafe under
content ABA (X→Y→X), so `?definition=true` also returns `definition: {steps, outputs}` from the SAME snapshot; that is
the read (e) bases a draft on.

**D11 Migration.** V137: `hel1629_lock_pipelines`, owned/granted like V129's `hel1498_lock_panels`; unlike V129 it
returns a count and takes a second `p_source_ids` argument (the pipelines rooted on those sources, read inside the function: a source's owner cannot see, under RLS, another user's pipeline rooted on it), safe because only server code calls it (stated in the migration header). Re-check no branch
holds V137 before committing; a spec applies it and calls it as the non-BYPASSRLS app role (MISTAKES.md).

## Risks / Trade-offs

- New pipeline-row locks on existing writers can create the deadlocks G2 forbids; D6's red-first rule and the deadlock
  spec bound this. Residuals HEL-1485/HEL-1534 are inherited, not widened.
- (1) blocks edits to every dashboard bound to the pipeline for the save's duration; (4) briefly holds up run-history
  inserts. Saves are short; timings recorded by the deadlock spec.
- Cross-owner and upsert-target checks run outside the transaction (inherited from create): follow-up candidate.

## Planner Notes

- Self-approved: endpoint path, `applicationId`/`definition` in the response, `currentFingerprint` added to the 409
  body (existing shape kept), `?definition=true`, audit action name, privileged pool (D4), 404 on a raced delete.
- Specs run on per-spec embedded Postgres (`TwoUserRlsApiFixture` pattern); `helio_hel1629` is for ad-hoc probes only.

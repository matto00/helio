## Context

See proposal.md for motivation. Current state, verified against the tree at aeeb68675:

- `DraftSaveRequest` (`api/protocols/pipelines/DraftSaveProtocol.scala`) has no roots; `DraftDiff.resolveParents` and
  `resolveNode` refuse any `rootId` outside `DefinitionRows.rootIds`.
- `DraftSaveTransaction.run`: `lockDefinition` (O* steps 1-5) → privileged definition read → fingerprint compare →
  `readRows` → re-plan → `checkedKeys`/`needsAdvisory` subset guards → cascade gate → apply chain → journal + audit.
- The fingerprint already covers roots: `PatchSetTargetFingerprint.Allowlist("pipeline")` includes `roots`, and
  `PatchSetPipelineDefinition.assemble` writes `{id, dataSourceId}` per root in position order. So no fingerprint code
  changes; tests pin it.
- Standalone root writes (`PipelineRootRepository.add` / `removeRoot`, `PipelineRootWrites`): add = caller-owned source
  (`findByIdOwned`), source row `FOR KEY SHARE` → `PipelineCycleGuard.checkAddReadAction` (takes the advisory lock) →
  pipeline row (3) → insert at max+1. Remove = panels for the root (1) → (3) → `removeRootCascadeAction` (deletes
  node_snapshots by step and by `root_id`, then steps) → root row → `compactPositions`. Last root refused.
- `DraftSaveJournal.priorState` stores root ids only; `DraftRestore.requestOf` ignores them.
- Sample access (`SourceSampleService.authorized`): the source's OWNER is served first, any `pipelineId` ignored.
- Client: `DRAFT_BLOCK_REASON` disables add/remove source while a draft exists (`PipelineSpine.tsx`,
  `MobilePipelineHeader.tsx`, `SpineSourceCard`). The draft is an op log (`state/draftOps.ts`, `DraftOverlay` v3).

## Goals / Non-Goals

Goals: root add/remove inside the one save transaction under O*, journaled and undoable, with the client op log,
kept draft, stale path and preview carrying them. Non-goals: as in proposal.md (no root reorder, no inline sources in the
save body, no drafting of source creation, no widening of sample access).

## Decisions

**D1 Wire shape: declarative final `roots`, optional.** Public: `roots?: [{id} | {clientId, sourceId}]`, mirroring how
steps and Outputs are declarative; a Public survivor item carrying `sourceId` is a 400 (a survivor's source cannot
change). Restore (server-built only): `{id, sourceId}` for a root to recreate under its original id. `rootClientId` is added to `DraftStepRequest` and `DraftOutputRequest` (exactly one of
parent/parentClientId/rootId/rootClientId; node/nodeClientId/rootId/rootClientId). `confirmCascade.rootIds` and
`impact.rootIds` added. Response `definition.roots: [{id, dataSourceId, dataSourceName}]`. Schemas in
`schemas/pipelines/draft-save-request|response|cascade-required` updated in the same change. Alternative rejected: op
list (`addRoots`/`removeRootIds`) — it splits the declarative model and makes undo a different shape than save. Absent
`roots` = unchanged, so old clients and old journal rows keep working.

**D2 Order and positions (skeptic CR2).** (a) Every root's final position is its index in `roots`. (b) Public: the
survivors must keep their stored relative order (400 otherwise; reorder is a non-goal) and new roots must come after every
survivor (400 otherwise), which is the only order the client's "+ Add source" produces. (c) Restore: `DraftRestore` builds
`roots` from the journal's `rootDefs` sorted by position, so a recreated root returns to its original index and the
restored fingerprint equals the pre-save one; interleaving is allowed in Restore mode only. An empty final list is 400
("Cannot remove the last root of a pipeline"), matching R1. No duplicate-source rule (skeptic CR3): `POST /roots` and
create allow a source to be a root twice, stored pipelines may have it, and a new restriction would break saves and undo
on them; the client add-source flow keeps today's behaviour (it does not filter sources already rooted).

**D3 Planner.** `DraftDiff.plan` gains a pure root pass before steps: resolve `id`/`clientId`, build the final root id set
(new ids from `newId`, or explicit ids in restore mode), compute `rootCreates`, `removedRootIds`, `rootPositionUpdates`.
Steps/Outputs resolve `rootId`/`rootClientId` against the FINAL set. Removed roots' steps must be absent from the draft
(the client omits them; a step still naming a removed root is 400). `removesAnything` includes removed roots;
`DraftPlan.addedSourceIds` (sorted) and `needsAdvisory ||= rootCreates.nonEmpty`.

**D4 Locks (G1/G2).** Before `lockDefinition`, a new step (0): `SELECT id FROM data_sources WHERE id IN (...) ORDER BY id
FOR KEY SHARE` over `preLockPlan.addedSourceIds`, returning the locked ids (skeptic CR4): any added source missing aborts
with 404 `Data source not found: <id>` (Public, `attachRoot`'s message) or 409 "Undo refused: source <id> no longer
exists" (Restore), nothing written, never an FK violation through the generic classifier. The site is behind a new `LockSite.SaveRootSources` so a spec can remove it. Then
the unchanged (1) panels — `lockForDeletion(pipelines = Seq(pid))` already covers panels on root-node Outputs and every
step Output — (2) advisory when `needsAdvisory`, (3)-(5). After re-plan: refuse (409 stale) if the locked plan's
`addedSourceIds` is not a subset of the pre-lock set (can't lock (0) out of order), mirroring the existing
`needsAdvisory`/`checkedKeys` guards. The cycle check for each added source runs inside the transaction after (3) using
`PipelineCycleValidator.checkNoCycle` against read edges + write edges with this pipeline's FINAL write targets (from
the plan's step configs) — the advisory lock is already held, so we call the read/validate part, not `checkAddReadAction`
(which would re-take it; re-entrant for a session advisory lock, but explicit is clearer). A cycle → 400, rollback.

**D5 Apply order (skeptic CR1: `UNIQUE (pipeline_id, position)` from V98 is not deferrable, and V99's statement-level
zero-root trigger fires on delete).** Insert new root rows at non-colliding positions `storedMax + 1 + i` → existing step
inserts → relinks →
`deleteRemoved` → for each removed root, delete node_snapshots exactly as `removeRootCascadeAction` does (by each
removed step under that root, and `root_id = r AND node_step_id IS NULL`; verified: `deleteStepsCoreAction` deletes step
rows only, node_snapshots has no FK) → delete root rows (a new root already exists when the only
root is replaced, so the zero-root trigger is satisfied) → move every root to its final index: update ascending by
current position, each into a freed slot, or (when the target is taken) via a two-pass shift through
`-1 - index` temporary positions, then final; whichever the executor uses must be proven by the two collision cases in
task 3.1 and by task 3.3's restore of position 0 of two (the only taken-slot case) → Outputs (root-node Outputs on a removed root are in
`removedOutputIds` and go with `deleteRemoved`; FK cascade is a backstop, not the mechanism). Then the existing
`laneGate`, definition read, fingerprint, journal, audit (audit payload gains `rootsCreated`/`rootsRemoved`).

**D6 Ownership check.** `checkReferences` (pre-transaction) also requires `findByIdOwned(sourceId, caller)` for every
added source in Public mode → 404 `Data source not found`, same as `attachRoot`. Inside the transaction the source row is
key-share locked, so it cannot be deleted between check and insert. Restore mode skips the caller-ownership check (the
journal recorded a root that was authorised when created) but requires the source row to exist under the (0) lock;
missing → 409 "Undo refused: source X no longer exists".

**D7 Undo journal.** `priorState` adds `rootDefs: [{id, dataSourceId, position}]` (keeps `roots` for old readers).
`DraftRestore.requestOf` builds `roots` from `rootDefs` when present (explicit ids, restore mode), else leaves `roots`
absent (old rows: their saves never changed roots). Steps/Outputs keep their stored `rootId`. Restoring a removed root
recreates it under its original id; the existing dependents checks still refuse when panels/alert rules would be lost.

**D8 Sample access unchanged.** The add-source modal lists only `/api/data-sources` (caller-owned), and D6 requires
ownership, so every draft root's source is the caller's own and the owner path already serves it. Widening the
pipeline-scoped grant to "sources the draft names" would make the endpoint an oracle for arbitrary ids. Pinned by a
`SourceSampleServiceSpec` case (editor, own source, not a root of P, `?pipelineId=P` → 200). The client must include
draft roots' source ids in the `useSourceSamples` request set (today it uses saved roots only).

**D9 Client model.** Two new ops on the same log: `{kind:"rootAdd", clientId, sourceId, dataSourceName}` and
`{kind:"rootRemove", rootId}` (`rootId` a saved id or an earlier rootAdd's clientId). Replay yields draft roots alongside
steps/Outputs; `rootRemove` drops the root's steps (subtree) and Outputs exactly like the server's cascade; a later op
naming a removed root does not apply (counted as dropped). rootAdd then rootRemove of the same clientId prunes to
nothing. `DraftOverlay.version` → 4; `keptDraft` migrates a v3 blob by adding nothing (ops are additive) and refuses
unknown versions as it does today. `buildDraftSaveRequest` sends `roots` only when a root op is present. The cascade
confirmation dialog lists removed sources. `DRAFT_BLOCK_REASON` stops applying to add/remove source; "last source" stays
blocked using the draft root count. Drafted roots use the existing draft visual treatment (DESIGN.md tokens only).
Insert-at-head and "append" anchors accept a draft root's clientId so steps can be added on it.

**D10 No migration.** Root rows are written on the privileged connection inside the existing transaction; no new SQL
function. If the executor finds one is needed, it is V143 and must be renumbered above origin/main's max before merge.

## Risks / Trade-offs

- [New lock site (0) could deadlock with a source delete or teardown] → it is the documented O* step 0 that root add
  already takes; add `DraftSaveDeadlockSpec` "root-adding save vs source delete" with an opposite-order control that
  must raise `40P01`, and a `DraftSaveRaceSpec` "root add"/"root remove" block for the save-side writes (writer-first and
  save-first, control red with `SaveRootSources` removed).
- [Cycle check reads an edge set that moves] → it runs under the advisory lock, which every write-edge writer takes.
- [Cycle checks run while removed roots' read edges are still stored (root rows are deleted after `insertSteps`)] → a
  draft that removes a root to break a would-be cycle while adding the write in the same save gets a conservative 400.
  Accepted: it can be saved in two drafts.
- [Dataset writers (`DataSourceRepository.lockSource` `FOR UPDATE`: append, replace, refresh, form submit) conflict with
  site (0)] → same exposure as the standalone root add; task 3.2 adds them to `g1-writers.md` with the statement (checked
  against code) that none takes (1)-(5) after the source row, and one deadlock-spec case for dataset append.
- [Client op-log replay drift vs server cascade] → unit tests assert the replayed tree equals the server's plan for the
  same draft (shared fixture), plus e2e per action.
- [Concurrent lanes] HEL-1740 edits Output-kind enums; this change does not touch them or `PatchSetTargetFingerprint`.

## Planner Notes

Self-approved: D2 (no reorder, matching non-goal; no duplicate-source rule), D6 restore-mode ownership skip (undo is
only possible for the saving actor: `PatchSetApplicationRepository.findById` filters `owner_id = caller`, and that actor
was authorised for every root the save removed, since it could see and remove it), D8 no access widening (the ticket's
sample bullet is already met by the owner path; verified in `SourceSampleService.authorized`), D9 Discard leaves a
source created from the modal in the library (unchanged pre-draft behaviour). Spinoff candidate, not fixed here: a draft
step delete (HEL-1629) leaves that step's node_snapshots behind, since `deleteStepsCoreAction` does not remove them.
Premise check found the fingerprint bullet already satisfied (minor staleness, see `.concertino/runs/HEL-1734/evidence/premise-validation.md`).

Round-2 skeptic notes adopted: a stored step under a removed root that the draft relinks to a surviving root is ALLOWED
(the root is a placement, the step survives; tested in 3.1); a Restore cycle refusal is 409 "Undo refused: ..." like the
other Restore refusals; site (0) compares locked ids as a distinct set; `buildDraftSaveRequest` maps a parentless step or
root-node Output on a draft root to `rootClientId`; D6's "cannot be deleted" holds from the (0) lock onward (D4 covers the
gap before it); 8.3.1 also records that `pipeline_roots` row writes (delete, position UPDATE) happen after (5), the same
exposure the standalone remove has via `compactPositions`.

## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. The change dir is untracked, so I read the artifacts from the working tree. Source paths are relative to `backend/src/main/scala/com/helio/` and test paths to `backend/src/test/scala/com/helio/`, unless written in full.

### What I verified (with evidence)

- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/shared-step-reference-checks/HEL-1515`.
- **Round-3 CR1 (existing specs that D4 turns red): addressed.**
  - C3 is in tasks.md Standing Constraints and in workflow-state.md CONSTRAINTS. Task 1.6a re-runs every lane-creating spec and names `PatchSetUndoLaneSpec` L141-145. The design.md Planner Notes state the rule: a fixture-only fix, no assertion edits, OWNER REVIEW listing, and escalation when an assertion depends on the cyclic shape.
  - I re-traced the known hit against the tree. `PatchSetUndoLaneSpec` L141-145 seeds the union with `parentStepId = Some(anchor.id)` through `PatchSetUndoServiceFixture.seedPipelineStep` (L173-190), which passes no `attachAsTail`. That takes the splice arm (`PipelineStepCreate` L238-239), which re-parents L.
  - I confirmed the proposed repair works. `attachAsTail` is honoured in the `parentStepId` arm (L231-236, `attachTailInternal`, no re-parent). With it, the union and L become true siblings, the dependents set is empty, and the test's own assertion (the undo Conflict naming L at L147-150) is still exercised.
  - The fixture fix needs a new defaulted parameter on the shared `seedPipelineStep`. That is still fixture-only under C3 (see note 1).
- **Round-3 CR2 (patch-set inheritance): addressed.**
  - The Planner Notes name the callers. I verified each line with grep: `PatchSetApplyForward` L93 (`updateStep`) and L99 (`addStep`); `PatchSetApplyRollback` L161 and L248; `PatchSetUndoService` L247 and L281. The notes describe the undo/rollback sibling re-parent consequence and require an OWNER REVIEW listing plus an undo-fidelity follow-up.
  - Task 1.2 includes the undo probe arm.
  - I confirmed the premise: `PatchSetUndoInverse.pipelineStepCreateRequestFromResponse` (L136-151) rebuilds the request with `parentStepId` and no `attachAsTail`.
- **Round-3 non-blocking notes: folded in.**
  - D4 now reads "`parentStepId` + `attachAsTail` -> none (`attachAsTail` is ignored in the `rootId`/no-anchor arms)". That matches the code: `attachAsTail` is read only at L231.
  - The roots read and the multi-root guard are kept ("that guard is not bent").
  - The time-of-check/time-of-use window is noted.
- **Fresh pass.**
  - There are no TODO/TBD placeholders.
  - Every AC has a task: AC1 → D1/D2, 1.3-1.5; AC2 → D3, 3.1; AC3 → D4, 1.2/1.6/1.6a, 3.2; AC4 → D5, 2.1/3.3.
  - C2 and C3 are consistent with D2's "AC1 spec diff empty except AC2 pins". The C3 fixture edit belongs to AC3, not AC1.
  - The spec delta is consistent with D4 and the proposal.
- **The update arm checks config only, and position never re-parents.** In `PipelineStepWrites.updateStep` (L67-120), the lane chain runs only in the `Some(cfgJson)` branch. `PipelineStepRepository.updateInternal` (L505) applies `position` through `positionScopedUpdateAction`. That is sibling-scoped and never changes `parentStepId`. So an update with both config and position cannot invalidate the pre-update dependents closure. The undo/rollback follow-up `updateStep(position=...)` calls at `PatchSetUndoService` L286 and `PatchSetApplyRollback` L255 send `config = None` and never reach the new branch.
- **Other lane-seeding specs.** I grepped `JsString("lane")`/`laneJoin` under `backend/src/test` and found 18 files. I spot-checked `Hel914Ac1EndToEndSpec`: it seeds lanes through the transactional create, which is out of scope and does not route through `addStep`. Task 1.6a's mandatory sweep plus escalation covers any hit I have not traced.

### Verdict: CONFIRM

### Non-blocking notes

1. The C3 fix for `PatchSetUndoLaneSpec` means adding an `attachAsTail: Option[Boolean] = None` parameter to the shared `PatchSetUndoServiceFixture.seedPipelineStep`. With the default, every other caller is unaffected. List both files under OWNER REVIEW and in `files-modified.md`.
2. Rollback (`PatchSetApplyRollback` L248) is a different failure surface from undo. A 400 from the recreate mid-rollback leaves a partially rolled-back application. Task 1.2 probes only the undo arm. The executor should at least record, from code, how a recreate failure in rollback is reported, so the OWNER REVIEW entry is accurate for both.
3. Undo of a config update (`PatchSetUndoService` L247) restores a prior config through `updateStep`. If the graph changed since then, it can now get the dependents 400. This is covered by the general "inherits the new 400" note; mention it in the same OWNER REVIEW bullet.

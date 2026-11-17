## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 46ab3251e0677951520fe948f21bc9f716fc9369. The planning artifacts are untracked: design.md (150 lines), tasks.md (52), specs/pipeline-draft-mode-ui/spec.md, proposal.md (43).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.
- **Owner ruling.** `.concertino/runs/HEL-1684/events.jsonl` in the main checkout:
  - line 6 is `escalation.answered`, `answer":"split-as-proposed"`, `answer_source":"human"`;
  - proposal.md's Why and Non-goals and the design's Non-Goals match it (roots go to HEL-1734, Outputs and shapes to HEL-1733).

**Round-2 CR1 (temp `step-N` steps): RESOLVED.** D1a, D10, the spec requirement and scenario, and tasks 2.6, 4.5 and 4.6 all cover it. I checked each point against the live code:

- **Temp steps in the lane.** `makeStep` (`state/stepNarrowing.ts:384`) mints an inserted temp step with no `parentStepId`. `buildLaneGraph`'s totality sweep (`state/stepTree.ts` ~line 211) then appends it to the first non-empty lane. A lane temp step (`usePipelineLaneStepCreation.ts`) gets a parent and position >= 1, so it is never on a trunk. D1a's premise is accurate.
- **One trunk function.** D1a names `liveTrunkIds(steps, rootId)` as the single function for both recording a reorder and validating one at render and at save. Temp ids are excluded, matching `handleReorderSteps`'s `filter((s) => !isTempStepId(s.id))` (`usePipelineStepMutations.ts`).
- **Insert anchor.** `computeInsertAnchor` (`state/insertAnchor.ts:17-31`) already skips temp ids, and treats any non-temp id (a `draft-…` clientId included) as a valid anchor. So "resolved over `draftSteps`" works with the function as it is.
- **"+ lane" and duplicate on a temp step** are disabled during a draft, with the reason stated.
- **`post()` refusal.** `post()` (`usePipelineDraftSave.ts:260-273`) replays over `definition.steps`, after `definitionMatchesBase` against the temp-filtered `stepsRef`. D1a makes `dropped > 0` refuse to send, never send a reduced tree. Because no op may reference a temp id, the render-time replay and the save-time replay validate the same id set, so the refusal is defensive.
- **Unit tests** are specified for all three rules (task 2.6).

**Round-2 non-blocking notes: taken up.**

- 4.5 and 4.6 are in order.
- D1 names the owners: `usePipelineDraft` computes and prunes, and exposes `droppedNotice`; `usePipelineDraftSave` owns `setNotice`.
- The incomplete-config duplicate 400 is noted for the PR body in Planner Notes.
- "Only draft change is …" scenarios are constructed by reverting an opening edit.
- A stale-restored draft is not pruned, so `rebase` reports every op it drops.

**Fresh review against live code**

- **Routing (D3).** `usePipelineDetailPage.ts:340-363` already routes temp ids outside the draft for config, enabled and delete. A `draft-…` clientId is not `isTempStepId`, so edits to a new step go into `configs[clientId]` as D1 intends. `draftBlockReason` sits at `:420` (`draft.hasDraft ? DRAFT_BLOCK_REASON : null`), and D3 splits it there.
- **Wire contract (D5).**
  - `schemas/pipelines/draft-save-request.schema.json` allows `clientId` (oneOf with `id`).
  - A step names exactly one of `parentStepId`, `parentClientId` or `rootId`. That covers a saved step re-parented under a new step (the insert splice) and an old head displaced by a head insert.
  - `DraftDiff.scala:144-154` enforces it.
  - No schema change is needed, which matches "frontend only".
- **Reorder (D10).** `reorderLane` (`stepTree.ts:264-298`) relinks every step in the lane by array index, the swept temp step included. That is why D10 must filter, and it does (but see note 2).
- **e2e (D11).**
  - Red-first is planned (task 1.1).
  - Readiness waits are named: aria-current, a loaded card's count.
  - Phone dark, desktop light, and cross-pair smokes are covered.
  - `hel1631-draft-mode.spec.ts:527` ("structural controls are disabled…") is planned for update. It currently asserts "+ Add transformation step" and "Duplicate step" are disabled, both of which this change enables.
- **Placeholders and scope.** No TODO or TBD markers. Every AC maps to a task:
  - "each action works inside a draft, applied on Save & run or discarded" → 2.x, 4.1, 4.2, D11;
  - "kept-draft restore and stale base still work" → 3.1, D7, D8, D11;
  - "desktop and phone, light and dark, e2e per action that fails first" → 1.1, 6.2, 6.3.
  - The descoped actions (roots, shapes, Outputs) are owner-ruled.

### Verdict: CONFIRM

The temp-step gap is closed with one named function, an explicit anchor rule, a stated disable rule and a save-time refusal, and each claim matches the live code. I found no contradictions, placeholders or uncovered ACs. The remaining items are implementation-precision notes that the final gate can check.

### Non-blocking notes

1. **Append detection in a draft.**
   - `handleInsertStep` (`usePipelineStepCreation.ts:153`) computes `isAppend = index >= stepsRef.current.length`, which compares against the base length.
   - In a draft holding new steps, a river gap index into the longer draft lane can be >= the base length. If the draft branch reuses that `isAppend`, a mid-lane insert silently becomes an append.
   - Decide append in the draft branch by the caller (`handleAddStep`), or by comparing against the draft lane, not `stepsRef`.
   - Add a unit or component test: a draft with two new steps, then an insert at the last gap.
2. **What D10's "filtered to `liveTrunkIds`" is filtered against.** Take the reordered trunk lane's id order and keep only the ids in `liveTrunkIds(draftSteps-before-the-move, rootId)`. Do not call `liveTrunkIds` on `reorderLane`'s output:
   - `reorderLane` gives the swept temp step a parent and makes the next step its child.
   - A parent-link walk that stops at the temp step would truncate the trunk. The exact-set check would then drop the reorder the moment it is recorded.
   - The D1a unit test should move a saved step across the temp step, for example Move down on the last saved step when the temp step is swept after it.
3. **The restore effect prunes before staleness is known.**
   - The restore effect (`usePipelineDraft.ts:61`) still calls `rebaseOverlay` on read, before it checks staleness.
   - D1 says a stale-restored overlay is not pruned. For that to hold, the v2 restore must not rebase at read time, at least when `kept.base` differs. Otherwise the D8 count under-reports.
4. **Effect of a temp step's deferred create.** A pending AI temp step's deferred create can complete while a draft holds a reorder of that root. It lands as a real trunk step, so the reorder is dropped whole, with the notice. That is consistent with D1, but worth a line in the PR body: the "Reorder past a pending AI step" scenario holds only while the AI step stays incomplete.

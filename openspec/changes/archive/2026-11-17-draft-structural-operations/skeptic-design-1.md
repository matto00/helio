## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 46ab3251e0677951520fe948f21bc9f716fc9369 (planning artifacts are untracked in the worktree).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.
- **Owner ruling exists:** `.concertino/runs/HEL-1684/events.jsonl` lines 5-6: `escalation.raised`, then `escalation.answered` with `answer":"split-as-proposed"`, `answer_source":"human"`. The scope cut (roots to HEL-1734, Outputs and shapes to HEL-1733) is authorised, and the proposal and design reflect it.
- **Insert primitive** (`PipelineStepRepository.scala` `spliceInsertReportingInternal`): the new row gets position 0 under the anchor. Every existing child of the anchor (`siblingsQuery(pipelineId, parentStepId)`, tails included) is re-parented to the new id with `position` untouched. With no parent and an explicit root, the root's parentless steps are the ones re-parented. **The design's Context matches.**
- **Append:** `insertWireArgs(undefined, …)` gives `{rootId}` with no position. `StepPlacement.resolveCreateAnchor` then goes to `PipelineService.resolveRootTrunkAnchor(…, None)`, which returns `trunk.lastOption`, and that becomes a splice under the last trunk step. So append also moves the last trunk step's tails under the new step. That is consistent with D1 treating `append` as an insert anchor, but the design never says it out loud.
- **"+ lane"** (`attachTailInternalAction`): `position = maxPos.map(_ + 1).getOrElse(1).max(1)`, a new child, nothing re-parented. **Matches D1/Context.**
- **Duplicate** (`PipelineStepWrites.duplicateStep`): calls `spliceInsertAtInternal(… existing.kind, typedConfig, Some(existing.id), existing.enabled …)`. The clone takes over all of the original's children. **Matches.**
- **Reorder** (`reorderTrunkAction`): this is a permutation of the union of every root's trunk, partitioned by root, with position set to 0 and tails left untouched. Trunk steps are position 0 by definition (`trunkOf`/`trunkOfRoot` use `find(_.position == 0)`), so Move down then Move up does restore the identical tree. Client `reorderLane` (`stepTree.ts:264`) relinks the same way. **Matches D1/D10.**
- **DraftDiff** (`draft/DraftDiff.scala`):
  - `resolveSteps` accepts `clientId` (it is the error key, and the server mints the id).
  - `resolveParents` accepts exactly one of `parentStepId`/`parentClientId`/`rootId`.
  - Positions are stored as sent (`toWrite`), and `orderParentsFirst` handles new-under-new.
  - Lane clientIds inside configs are rewritten (`rewriteLaneClientId`).
  - New steps are always validated, and for AI kinds `validateRawConfig` runs `AnalyzeWithAiConfig.validate`/`GenerateTextConfig.validate` (`AnalyzeWithAiStep.scala:193`, `GenerateTextStep.scala:97`). So D3's "an incomplete AI config is refused by the save's existing 400, mapped to that step" holds: the message is `Step '<clientId>': …`.
- **D4 "per-step fetches suspended in a draft":** confirmed. `useStepPreviewFetch.ts:33` pauses during a draft, and analyze gets `suspended: draft.hasDraft` (`usePipelineDetailPage.ts:235`). `isTempStepId` is `/^step-\d+$/`, so `draft-…` ids are not temp ids. The draft-preview schema caps ids at 64 (`draft-preview-request.schema.json`). The draft-preview service does no stored-id check, so clientIds pass.
- **D3 routing anchor points exist as cited:** the saved/temp routing is at `usePipelineDetailPage.ts:342-365`, and `draftBlockReason` is at `:420`. The laneGraph that `useLaneReorder` reorders is built from `draftSteps` (`:197`), so a draft-mode reorder sees new steps. Every consumer of the block reason listed in the design exists (`useSpineStepActions`, `StepCardFocused`, `MobileStepSheet`, `PipelineMobileLayout`, `PipelineSpineLayout`, `MobilePipelineHeader`). `e2e/hel1631-draft-mode.spec.ts:527` is the "structural controls are disabled" test the design says to update.
- **D5/D6:**
  - `stepNamedBy` matches any page step id by substring, so a clientId held as `Step.id` resolves.
  - `response.saved.definition` is adopted (`usePipelineDraftSave.ts:189`).
  - The `DraftStep` wire type already has `clientId`/`parentClientId`.
- **D7:** today's `readKeptDraft` requires `Array.isArray(o.deleted)`. That confirms the risk note: an older build reads a v2 kept draft as absent and never misapplies it.
- **D3 soundness on its own terms:** with no draft, `draftSteps === base`, so the immediate paths (which read `stepsRef`, the base) are unaffected. Routing structure into the draft only while `hasDraft` holds is sound as a product rule and is listed for the PR body. The defect is a gap at the boundary between the two worlds; see CR3.

### Verdict: REFUTE

The plan is close: every server-semantics claim I checked is accurate. Four plan-level gaps would still let a competent implementer build two different things, or ship a tree-corrupting replay.

### Change Requests

1. **D1: the `duplicate` op shape contradicts its own semantics.** The union lists `duplicate {clientId, of}`. The next sentence says duplicate "captures the source's draft config and enabled flag at the time of the op", and D2 prunes `configs[clientId]` when it equals "the op's own config". With `{clientId, of}`, the op has no config to capture or compare against, and replay would re-read the original's current draft config, which is exactly what the sentence forbids. Make the op `duplicate {clientId, of, kind, config, enabled}` (or say explicitly where the capture lives). D7's op-by-op v2 validation must then require those fields.

2. **Deleting a new step contradicts the "Add then delete" scenario, so pick a rule and state it.** D1 says every op mirrors the server, and HEL-1631's `deleteStep` mirrors server delete: the first child by position is promoted, and every other child is removed with its subtree (`pipelineDraft.ts` `removalOf`). A splice insert or duplicate moves all of the anchor's children (tails included) under the new step, and append moves the last trunk step's tails too. Deleting that new step therefore removes the saved tails.

   So the spec scenario "Add then delete → no draft exists" is false whenever the anchor had a tail. In that case the draft silently removes saved steps, and their Outputs on Save (the cascade confirmation then fires). An implementer will either:
   - special-case new-step delete as an undo of the op, which diverges from D1, or
   - keep the mirror and fail the scenario, or pick a fixture that hides the case.

   Decide which, and write it into design.md and spec.md:
   - **If mirror:** qualify the scenario (the anchor has at most one child) and add a scenario for the tail case.
   - **If undo-of-op:** say that delete of a draft-new step removes its op and restores the moved children, and add a unit test for an anchor with a tail.

3. **Replay over a base that changes mid-session is unspecified, and a stale `reorder` permutation would corrupt the tree.** D8 covers only "Reload the saved pipeline". The base (`steps`) can still change while an op log exists:
   - an immediate write started before the draft existed lands after it (`applyCreated`, `syncStepsFromServer` in `usePipelineStepCreation`/`usePipelineStepMutations`);
   - a pending temp AI step's deferred create completes while the user is editing another step (`createDraftIfComplete`).

   `reorder {rootId, trunk}` records a full trunk permutation. If the live trunk at replay has a member the record lacks (or lacks one it has), a naive applier relinks only the listed ids. That leaves an unlisted step still parented on a moved step, so one parent ends up with two position-0 children (a broken trunk). On the server this is a 422 (`validateTrunkReorderRequest`), but in the client nothing would catch it. Specify that `applyOverlay` validates every op on every replay, not only on Reload. In particular, a `reorder` whose recorded id set is not exactly the live trunk set of that root is dropped, never partially applied. Say how such a drop is surfaced (reuse the D8 count and notice, or another mechanism), and add a unit test with a base that gains a trunk step under an existing reorder op.

4. **No plan covers atomic undo of a structural save.** The ticket says the save "must accept them, along with the stale-base 409 and atomic undo". Server undo (`DraftRestore`) restores the journaled prior definition through the same transaction, so created steps are removed and relinks are reversed. But no task or e2e checks the client's Undo after a save that created or moved steps. That includes what happens to a selection D6 moved onto a newly saved step that the undo then removes. Add one e2e (or a component test plus one e2e step): save with an inserted step and a reorder, then press Undo. The saved structure should equal the pre-draft base, and the selection should land on a step that still exists.

### Non-blocking notes

- `DraftSaveTransaction.laneGate` reports `Step '<server id>'` for a lane-cycle violation. For a new step that is the server-minted id of a rolled-back row, so `stepNamedBy` cannot map it to the clientId. D5's claim holds for `DraftDiff` errors only. Either accept the generic message or note it.
- `resolveRootTrunkAnchor` starts the trunk walk at the lowest-position parentless step of the root, not at a position-0 one (`trunkOfRoot`). The `append` mirror test should cite this function, not `trunkOfRoot`.
- After Save & run, the `?step=` URL param (`STEP_PARAM`, `useStepDeepLink`) may still hold a clientId. D6 should rewrite it along with the in-memory selection. Before the save, kept-draft restore with `?step=draft-…` should resolve to the restored new step.
- D6: a head insert at a root has no saved step ancestor, so the root is the anchor of the `(position, type)` match. Say so.
- Phone coverage: drag is desktop only (D10). Phone Move up/down lives in the sheet's "Step actions" menu (`PipelineMobileLayout.tsx:89`), so make the phone describe drive it there.

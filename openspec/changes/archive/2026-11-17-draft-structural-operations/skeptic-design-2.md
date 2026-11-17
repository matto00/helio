## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 46ab3251e0677951520fe948f21bc9f716fc9369. The planning artifacts are untracked in the worktree: design.md (147 lines), specs/pipeline-draft-mode-ui/spec.md (67), tasks.md (51), proposal.md (43).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.

**Round-1 change requests**

- **CR1 (duplicate op shape): RESOLVED.**
  - D1 now reads `duplicate {clientId, of, kind, config, enabled}` and says the capture happens at record time.
  - D7 requires all five fields, and rejects the whole kept draft on a missing field.
  - Task 3.1 adds a unit test for a duplicate op missing `config`.
  - D2's "configs[clientId] equal to the op's own config is pruned" now has a config to compare against.
- **CR2 (deleting a new step): RESOLVED. The mirror rule was chosen and stated** (D1, "Deleting a new step mirrors the server too"). I checked it against live `removalOf`/`deleteStep` (`state/pipelineDraft.ts`):
  - Insert after an anchor whose only child is its position-0 continuation makes that child the new step's sole child. Deleting the new step promotes it back into the slot, so the tree equals the base. The qualified "Add then delete" scenario is therefore true.
  - The tail case is now its own spec scenario, and D11 adds an e2e for it.
  - The cascade claim holds. `DraftSaveTransaction.cascadeGate` says "every removed step, Output, panel and alert rule must be listed in `confirmCascade`", so a removed tail with no Output still triggers the 422 confirmation.
- **CR3 (per-replay validation, stale reorder): RESOLVED as written.**
  - D1 validates every op on every replay.
  - A reorder whose id set is not exactly the live trunk set is dropped whole.
  - `applyOverlay` returns `{steps, dropped}`, and the drop is surfaced through the existing `dropped` notice. That notice exists: `usePipelineDraftSave.ts:45` and `:358-359`.
  - Unit test in task 2.3, spec scenario "Saved pipeline changes under a reorder".
  - But see the new CR1 below: the rule is sound, and the plan has not worked out how it meets temp steps.
- **CR4 (undo after a structural save): RESOLVED.**
  - D6 covers selection fallback after Undo.
  - The spec adds "Undo a structural save".
  - D11 adds the e2e (insert + Move down, Save & run, Undo, base structure, surviving selection).
  - Live `undo` (`usePipelineDraftSave.ts:152-176`) re-reads the definition and adopts it, so the plan's premise holds.
- **Round-1 non-blocking notes: all taken up.** The laneGate generic message is accepted in D5. The append mirror cites `resolveRootTrunkAnchor`. `?step=` is rewritten and restored (D6). The head insert anchors on the root (D6). Phone Move up/down goes through "Step actions" (D10/D11).

**Fresh review against live code**

- **Base steps include temp steps.**
  - `usePipelineDetailPage.ts:107-113` builds the draft over `steps`, which holds local `step-N` temp steps.
  - `laneGraph` is built from `draftSteps` (`:197`).
  - `makeStep` (`stepNarrowing.ts:384`) gives an inserted temp step no `parentStepId` and no `rootId`. `buildLaneGraph`'s totality sweep (`stepTree.ts` ~line 211) then appends it to the first non-empty lane in array order. So a temp step appears in root 0's trunk lane, but it is not on any parent-link trunk.
- **The immediate paths deliberately skip temp ids:**
  - `handleReorderSteps` (`usePipelineStepMutations.ts:137-140`, "Temp (`step-N`) steps have no backend row yet … exclude them");
  - `computeInsertAnchor` (`insertAnchor.ts`, "the nearest PERSISTED step before the gap");
  - `insertWireArgs`, which falls back to append for an absent anchor.
- **Save replays the overlay over the freshly read saved steps, never over `stepsRef`.** `post()` in `usePipelineDraftSave.ts` calls `applyOverlay(savedSteps, draft.overlayRef.current)`, where `savedSteps = definition.steps` and temp steps are filtered out of the base comparison (`/^step-\d+$/`).
- **A temp step can coexist with an open draft.** HEL-1631 routes temp-id edits outside the draft (`usePipelineDetailPage.ts:338-365`). An AI step added before the draft opens stays a temp step while the user edits a saved step.
- **`handleInsertStep` takes a flat `index`** and resolves the anchor over `stepsRef` (the base), via `computeInsertAnchor(stepsRef.current, roots, index)`. In a draft, the river's index is an index into the draft lane.
- **Other checks:**
  - `DraftDiff` accepts `clientId` with no format constraint beyond non-empty (`draft-save-request.schema.json:25`).
  - `isTempStepId` is `/^step-\d+$/`, so `draft-…` is safe.
  - `readKeptDraft` (`keptDraft.ts`) requires `Array.isArray(o.deleted)`, so D7's older-build risk note is accurate.
  - `duplicateStep` (`PipelineStepWrites.scala:214`) clones the step only, with no Outputs.

### Verdict: REFUTE

All four round-1 change requests are addressed, and accurately against the live code. One new plan-level gap remains, at the seam with temp steps. It would make a visible draft action silently fail to persist, or vanish the moment it is made. That violates the first AC ("applied atomically on Save & run").

### Change Requests

1. **Specify how draft structure ops treat local temp (`step-N`) steps.**

   **What goes wrong.** A temp step can sit in the draft base, in root 0's trunk lane, through the totality sweep. With the plan as written:
   - **(a) Reorder.** `reorderLane`'s result includes the temp id. D10 records `reorder {rootId, trunk}` "from `reorderLane`'s result", so the trunk holds the temp id. Meanwhile:
     - The D1 applier mirrors `reorderTrunkAction`, a parent-link trunk on which a parentless temp step never appears. By D1's own exact-set rule, the reorder is dropped on the very render that recorded it: Move down does nothing and shows "1 draft change could not be applied".
     - If the implementer instead derives the live trunk from the lane graph, the reorder shows on screen. Save then replays over `savedSteps`, which has no temp step, and the reorder is dropped there.
   - **(b) Insert, "+ lane" and duplicate anchored on a temp step.** An op that records `after: step-N`, `parent: step-N` or `of: step-N` displays fine. At save, replay over `savedSteps` drops it, together with every dependent op.
   - **(c) Silent save-time drops.** The design gives no rule for drops during `post()`'s replay over `savedSteps`. The request is built from whatever survived, so a dropped op is silently not saved, while the e2e's "saved == pre-save draft" assertion only catches it if the fixture happens to include a temp step.

   **Required revisions to design.md (D1/D3/D10) and tasks.md:**
   - Recorded reorder trunks exclude temp ids, as `handleReorderSteps` does today. The "live trunk set" used for D1's validation is computed the same way, from parent links with temp steps excluded, both at render and at save. Name the one function both use.
   - Insert anchors are resolved over **draftSteps** (not `stepsRef`), skipping temp ids as `computeInsertAnchor` does (a clientId counts as a valid anchor). "+ lane" and duplicate are disabled on a temp step during a draft, with a stated reason; or name another explicit rule.
   - `post()` refuses (an error notice, no request) when replay over the fresh `savedSteps` reports `dropped > 0`, rather than sending a reduced tree.
   - Unit tests:
     - a draft reorder over a trunk lane that contains a parentless temp step is recorded without it, and survives replay over the base without temp steps;
     - an insert in a draft at a gap after a temp step anchors on the nearest non-temp step.

   One spec scenario, or a sentence in the "Step structure actions inside a draft" requirement, so the behavior is checkable.

### Non-blocking notes

- tasks.md lists 4.6 before 4.5. Renumber.
- The D1 drop notice belongs to `usePipelineDraftSave`'s `setNotice`, not `usePipelineDraft`. Say which hook owns the render-time drop count, so the two do not race (render-time pruning in an effect, versus `rebase`'s return value).
- The immediate `duplicateStep` deliberately skips `requiredConfigProblems` ("drafts stay duplicable"), while `DraftDiff` validates a new step strictly. So duplicating a saved step whose stored config is incomplete succeeds immediately but makes the draft's Save fail with a 400. That is consistent with D3's acceptance of the 400, but worth a line in the PR body.
- The "Reorder back to the saved order" and "Add then delete" scenarios say "the only draft change is …". Under D3 that state is reachable only by opening the draft with another edit and then reverting that edit. The e2e and unit tests should construct it that way (or say "starting from a draft whose other changes have been reverted").
- The kept-draft restore currently applies `rebaseOverlay` silently on read (`usePipelineDraft.ts` restore effect). With D1 pruning on every replay, a stale-restored v2 draft may lose ops before the stale notice's "Reload" ever reports a count. Make sure the D8 count still reflects them, or accept and state it.

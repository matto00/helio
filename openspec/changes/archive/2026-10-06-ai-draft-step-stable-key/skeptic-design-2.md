## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 90f8a949c4ad25cf7789d90de22d20aa78e850a8. The worktree is on the main tip and the change dir is untracked. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/ai-draft-step-collapse/HEL-1321`.

### What I verified (with evidence)

**Round-1 CR1 (Defect A, childless-anchor lane-add draft) is addressed in substance, not just reworded.**
- The design adds D2b: a provisional `position` set only in `handleAddLaneStep`'s `requiresCompleteConfigForCreate` branch. The Risks section, the D2 "why it is safe" bullet, tasks 1.1/2.5/3.1 and a new spec scenario ("A lane-add draft on a step with no children...") all cover it.
- Checked against `buildLaneGraph` (`frontend/src/features/pipelines/state/stepTree.ts:174-182`):
  - The continuation is the first `position === 0` kid. A kid with undefined position is the continuation only if it is the sole kid.
  - A draft with `position >= 1` is therefore always queued as its own lane, with lane id = its temp id. `sortSiblings` (L81-88) orders it after every persisted sibling.
- Checked against the backend `attachTailInternalAction` (`PipelineStepRepository.scala:794-815`): `position = maxPos.map(_ + 1).getOrElse(1).max(1)`.
  - The client rule (max of the anchor's children, undefined counted as 0, plus 1) gives the same value whenever every sibling is persisted, and 1 for a childless anchor.
  - Where the two can diverge (another unpersisted sibling), only sibling order changes.
- Sibling reorder does not remount the draft. Child lanes render as a keyed `.map` inside one `pipeline-detail-page__lane-row` div, both in `PipelineRiverView.tsx:418-450` and in `LaneColumn.tsx:147-182`.
- The compact/non-compact branch of `LaneColumn` (`isCompact = childLane.steps.length === 1`) does not flip on the swap: the draft's lane has one step before and after.
- The lane render key is stable across the swap:
  - Before the swap: the head has no renderKey, so the key falls back to `lane.id` = temp id.
  - After the swap: the head's renderKey = temp id.
  - The inner card key (`LaneColumn.tsx:203` tail-chain-step) is covered by task 2.3.
- The provisional position is never sent on the wire. The draft create (`usePipelineDetailPage.ts:1078-1086`) passes only `meta.index/parentStepId/attachAsTail/rootId`. Lane-add meta has no `index`, and the step's own `position` is not read.
- `position` is read only in `stepTree.ts` (sort and continuation) and in `stepNarrowing.ts:485` (wire to Step). That grep is exhaustive for non-test code under `features/pipelines`.
- HEL-1294 is unaffected:
  - The create-immediately branch and `makeStep` are untouched.
  - Corner case: the anchor already holds a create-immediately lane-add temp whose position is undefined. On main, two undefined-position kids already give no continuation. With D2b there are also two kids and no continuation, so behaviour is identical.
- The new probe is red on main by construction. Before the swap, a sole undefined-position kid is the continuation, so the draft renders in the anchor's lane (a `primarySteps` Fragment for a trunk anchor). After the swap it has `position >= 1` and becomes a new `LaneColumn`. Its parent element changes, so React remounts it.

**Round-1 CR2 (Defect B, stepsRef timing) is addressed.** D3 now says:
- look the draft up in `stepsRef.current` by the **temp `stepId`**, because the ref is pre-swap inside `.then` (confirmed: `stepsRef.current = steps` is assigned during render, `usePipelineDetailPage.ts:158`);
- compare by **reference**, which is valid because `handleStepConfigChange` L1057 stores the incoming `config` object as-is, so no edit means the same reference as the POSTed `config` argument;
- call `updatePipelineStep` from `.then` and never inside a `setSteps` updater.

**Round-1 CR3 (Defect C, failure surface) is addressed.**
- The "same as the normal PATCH" wording is gone. The failure surface is named: `draftCreateErrors[persisted.id]`.
- It renders via `StepCard.tsx:391` `<InlineError error={draftError ?? null} />`, which is passed for every step at `PipelineRiverView.tsx:394` and `LaneColumn.tsx`.
- It is cleared by the existing clear in `handleStepConfigChange` (L1063-1068), which is keyed by the id the card emits, and that id is real after the swap.
- A test assertion is present: task 2.6 and task 3.1 "rejected flush visible inline". The spec scenario was added.

**Round-1 non-blocking reorder-race note** is now in Risks.

**Other re-checks**
- The append-draft path survives on the same key. Before the swap, the totality fallback appends the draft to the first non-empty lane. After the swap, it is the `position 0` continuation of the trunk-last step. Both are in the same `primarySteps` keyed list.
- The insert-between draft's post-swap sibling staleness (CR9) is pre-existing and still correctly scoped out. The card stays inside the same keyed list.
- No placeholders, no TBDs. Every AC maps to a task:
  - deterministic probe: 1.1
  - fix: 2.x
  - red-without-fix RTL test: 3.1
  - HEL-1294 unchanged: 3.2, unmodified test file
  - the "explain why it's safe" ask: D2

### Verdict: CONFIRM

### Non-blocking notes

- **D2b mechanics.** In `handleAddLaneStep` (L826-836), `tempStep` is spliced into state **before** the `requiresCompleteConfigForCreate` check. Set the provisional position on the object that gets spliced: compute it from `stepsRef.current` before the `setSteps` and only when `requiresCompleteConfigForCreate(opType.id)`. The create-immediately splice must keep using the plain `makeStep` result. Compute the max over the anchor's children excluding the new temp itself. Including it is harmless (undefined counts as 0), but excluding it is cleaner.
- **Page-level state keyed by step id.** The D2 audit should also glance at page-level UI state keyed by step id, for example `laneDropdownForStepId` in `PipelineRiverView`/`LaneColumn` and `duplicatingStepIds`. A temp id held there simply stops matching after the swap, which is benign but worth a line in the audit record.
- Line references have drifted by one: `pendingDraftMetaRef.current.delete` is L1077, not L1076. This is cosmetic.

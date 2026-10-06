## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 90f8a949c4ad25cf7789d90de22d20aa78e850a8 (worktree on main tip, change dir untracked).

### What I verified (with evidence)

- **Draft path swap and no resync: CONFIRMED.** `usePipelineDetailPage.ts:1077-1104`: `createPipelineStep(...)` then
  `.then` does an in-place `setSteps(prev.map(s => s.id === stepId ? { ...pipelineStepToStep(persisted), config: s.config } : s))`.
  There is no `syncStepsFromServer` on this path. `pendingDraftMetaRef.current.delete(stepId)` (L1076) runs before the
  POST, and `creatingDraftIdsRef` (L1074) blocks a second create.
- **Temp-id PATCH skip and the in-flight drop: CONFIRMED by reading the code.** `useStepCardState.ts:282`, `persist()` returns early when
  `isTempStepId(step.id)`. AI kinds route through `emitOrPersist` (L504-510), which only calls
  `onConfigChange` for a temp id. `handleStepConfigChange` updates local config (L1057), then returns at L1067 because the
  meta was already deleted. An edit made while the create is in flight therefore stays in local state, and nothing ever
  sends it to the server. The D1 probe still needs to show this live.
- **Lane id derives from the head step id: CONFIRMED.** `stepTree.ts:186` `lanes.push({ id: startStep.id, ... })`, and
  totality fallback L220 `id: s.id`. Render keys: `PipelineRiverView.tsx:354` (`Fragment key={step.id}`), `:425`
  (`key={childLane.id}`), `:502` (`key={root.id}`, a pipeline root id, not a step id, so it is unaffected),
  `LaneColumn.tsx:152/203/249`. `RootColumn.tsx` has no `key=`.
- **HEL-1294 is isolated: CONFIRMED.** `markCreating`/`creatingStepIds` (L183-184) are used only on the
  `handleInsertStep`/`handleAddLaneStep` create-immediately branches. Both call `syncStepsFromServer`, which replaces the whole
  list. A renderKey carried forward only for ids that already had one cannot touch those paths.
  `PipelineDetailPage.creatingStep.test.tsx` exists.
- **No Step spread duplicates a renderKey into a second step.** Spreads are `{...s, config}` (L1057), `{...s, enabled}`
  (L1320) and `stepTree.ts:271` (same step re-flattened). Duplicate does not spread a Step, so siblings cannot share a key.
- **Temp to real id in a preserved subtree.** `StepCard.tsx:180` local `expanded`. `useStepCardPreview({ stepId: step.id })`
  (L203) receives the id per render, and the design's mandatory audit covers it. `useStepCardState` reads `step.id` per render
  inside `persist`. Its during-render reset keys on the `step.config` reference, which the swap keeps (`config: s.config`),
  so editor state is not reset. The audit requirement plus the post-swap PATCH assertion is adequate.

### Defects found

**A. A lane-add draft on a childless anchor still remounts. A stable key cannot fix it, and the design does not cover it.**
`handleAddLaneStep` builds the draft with `makeStep(opType, parentStepId)`, which sets `parentStepId` and leaves `position` undefined
(`stepNarrowing.ts:384-395`). In `buildLaneGraph` (`stepTree.ts:174-176`), a sole child with no position becomes the
anchor's **continuation**. So while the draft is temp it renders inside the anchor's own lane (for a trunk step, as a
`primarySteps` Fragment in `PipelineRiverView`). The server's `attachTailInternalAction`
(`PipelineStepRepository.scala:807-808`) always assigns `position >= 1`. After the swap the step is therefore no longer a
continuation, and it becomes the head of a **new child `LaneColumn`**. The card moves to a different parent element, so
React remounts it whatever its key is, and the card collapses. The "+ lane" affordance is unconditional, so this happens
on every leaf step, including the trunk-last step: the most common case. The design's "lane-head draft not remounted"
test is only satisfied when the anchor already has a continuation child. In that case the draft heads its own lane from
the start.

**B. D3: the stepsRef timing is ambiguous and invites a silent no-op.** `stepsRef.current = steps` is assigned during
render (`usePipelineDetailPage.ts:158`). In the create's `.then`, right after `setSteps(...)`, `stepsRef` still holds the
**pre-swap** list. Telling the implementer to "read the draft's latest local config from `stepsRef` after the swap" points them toward a
lookup by `persisted.id`, which finds nothing and silently skips the flush. The comparison semantics ("differs from the
config that was POSTed": by reference or deep) are also not stated.

**C. D3: the failure handling contradicts itself.** "surfaces through the same failure feedback the normal config PATCH uses
(do not swallow)". The normal PATCH **does** swallow failures for every kind except `upsertsource`
(`useStepCardState.ts:298-313`, where `captureErrors` is only passed by `onUpsertSourceChange`), and that includes the AI kinds.
An implementer can satisfy only one half of this sentence.

### Verdict: REFUTE

### Change Requests

1. **Cover the childless-anchor lane-add draft (Defect A).** Either:
   - make the temp draft render where it will land. For example, in `handleAddLaneStep`'s
     `requiresCompleteConfigForCreate` branch only, give the temp draft a provisional non-zero `position` so
     `buildLaneGraph` makes it the head of its own lane from the start. Its lane render key is then the temp id, which
     `renderKey` preserves across the swap. Keep `makeStep` and the create-immediately branch unchanged so HEL-1294 stays
     byte-identical; or
   - explicitly scope the case out, with a ticket-grounded justification and a follow-up.

   Update design.md (the D2 "Why it is safe" claim and the Risks section) and the spec delta. Add a test case in tasks 1.1
   and 3.1: a lane-add AI draft on a **childless** anchor (for example the trunk-last step) stays expanded after its
   create resolves. It must be red on main.
2. **D3: say exactly how the latest config is read (Defect B).** Look it up in `stepsRef.current` by the **temp `stepId`**,
   noting that the ref is still pre-swap inside `.then`. The functional `setSteps` updater must not be used for side
   effects. State the comparison rule: reference inequality is enough, because every edit replaces `config` with a new object.
3. **D3: name the concrete failure surface (Defect C).** Pick one, for example setting
   `draftCreateErrors[persisted.id]`, which renders via `StepCard.tsx:391` `InlineError` for any step, or a toast. Remove
   the "same as the normal PATCH" wording. Add a test assertion that a rejected flush PATCH is visible.

### Non-blocking notes

- The pre-existing missing resync after a positional draft insert (the CR9 reparent) is fine to leave out of scope as
  noted. If the implementer ever adds a resync, the `renderKey` carry-forward in `syncStepsFromServer` already handles it.
- The D3 flush PATCH (from the page) and a post-swap debounced card PATCH (from `useStepCardState`'s token guard) are
  independent requests. If they are reordered in flight, the older config could land last. The window is small (the flush fires
  immediately and the card PATCH 400ms later), but it is worth a sentence in Risks.

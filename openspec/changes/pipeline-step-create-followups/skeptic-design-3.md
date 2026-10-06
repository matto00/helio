## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `b16bfa1b3a74905eefc0208a01793efa047909c5`. The worktree has no commits beyond main. `usePipelineDetailPage.ts` is 1598 lines. I re-derived everything below from the source.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-step-create-followups/HEL-1340`.
- **Scope:** `events.jsonl` has `escalation.answered answer:"H2-move-ac4-to-hel1345" answer_source:"human"`. ticket.md, proposal.md, design.md D5 and tasks.md C6 all agree. No task covers item 4. Item 5 stays excluded by C1.

- **CR1 (D3 effect order vs. the hook boundary): RESOLVED.**
  - The constraint now reads "No `useEffect` changes its relative declaration order, and the new hook declares no effect". It explicitly relocates the `useRef`/`useState`/`useCallback` declarations at :175-195 to the call site after :731.
  - `grep useEffect(` finds effects at :321, 338, 403, 404, 482, 489, 607 and 672 only. None sits after :731, so a call site there crosses no effect.
  - I re-ran the grep for `creatingDraftIdsRef|DraftCreateErrors|creatingStepIds|markCreating|handleInsertStep|handleAddStep|handleAddLaneStep`. Every real use is at :175-195, :759-905, :1089-1151, or the return keys at :1561/:1579-1590. Nothing between :195 and :731 reads them, so the relocation is safe.
  - I read the moved handlers (:759-905, :1081-1154). Their free variables are `id`, `setStepsInitialized`, `setSteps`, `stepsRef`, `pendingDraftMetaRef`, `roots` (:371), `pushToast`, `syncStepsFromServer` and `markCreating` (moved), plus module imports. That matches D3's input list exactly.
  - `handleStepConfigChange` (:1081) is declared after :731, so it can call `clearDraftCreateError` and then `createDraftIfComplete`. That keeps today's order: setSteps, then clear the error, then the create guard chain.
  - Its deps grow from `[id]` to include those two callbacks. Its identity stays stable only if both are `useCallback`s over `id`, refs and setters. D3's identity-stability constraint already requires that.

- **CR2 (D4 fallback-map location, read path, re-keying): RESOLVED.**
  - (a) The readers `getDraftFallbackSchema`/`getAnalyzeColumns`/`getAnalyzeSchema` (:557-588) are declared before the call site. So the map must be a page-hook ref next to `pendingDraftMetaRef` (:166), passed in during commit 3. D4(a) says exactly this, and correctly scopes D3's stop condition to commit 2 only.
  - (b) `getDraftFallbackSchema` passes `pendingDraftMetaRef.current.get(stepId)` as `meta` (:564). `resolveDraftFallbackSchema` (`state/stepNarrowing.ts`) takes the exact-anchor branch only when `meta?.parentStepId` is set. D4(b)'s `?? <fallback map>.get(stepId)` therefore keeps lane drafts on exact-anchor resolution and avoids the array walk. The new lane-draft test variant pins this.
  - (c) D4(c) re-keys the entry from the temp id to the persisted id in the same `.then`, before `setSteps` (:1113-1131). The re-render that the swap triggers therefore already sees the persisted-id entry, because `steps` changes, so `getDraftFallbackSchema` and its dependents get new identities. On failure the entry is deleted and the meta is restored to `pendingDraftMetaRef` (:1145-1148), as today.
  - Root-cause plausibility:
    - :1103 deletes the meta synchronously, inside the same handler whose `setSteps` (:1083) causes the next render.
    - `LaneColumn.tsx:215-216/266-267` call `getAnalyzeColumns(step.id)`/`getAnalyzeSchema(step.id)` at render time, so that render gets `EMPTY_ANALYZE_SCHEMA`.
    - Writing the fallback entry in the same synchronous handler closes that gap. D4 still makes the executor confirm the root cause by probe, which is correct.
  - The `pendingDraftMetaRef` semantics are untouched: the create-once guard at :1095 and the `stepsFingerprint` filter at :362 stay as they are.

- **Rest of plan re-checked:**
  - D2's mutation target :1290 is the `renderKey: s.renderKey` carry in `handleReorderSteps`.
  - `PipelineDetailPage.draftCreate.test.tsx` has a `jest.mock` factory (:36) with `analyzePipeline: jest.fn()` (:47). Commit 1 adds `reorderPipelineSteps` to it, which is allowed: only the refactor commit is barred from test edits.
  - D1's commit order, C2-C6 and the tasks are consistent with D3/D4. The spec delta's two scenarios match D4's in-flight and post-swap windows.

### Verdict: CONFIRM

### Non-blocking notes

- D4 says the fallback is "dropped once `analyzeByStepId` has the persisted id", but (c) allows the entry to be deleted lazily. Read order makes the two equivalent while the analyze entry exists. A stale entry would apply again, though, if a later analyze failure or empty result cleared `analyzeByStepId`. For a trunk draft that has since been reordered, it would then walk from its new position. Recommend deleting the entry when an analyze entry for the persisted id first appears, or when the step is removed. Optional.
- `workflow-state.md` `CONSTRAINTS` C3 still says "items 1/3/4". tasks.md C3 correctly says items 1 and 3. This is cosmetic orchestrator state.
- The HEL-1345 handoff comment (5a98b381) is still unverified, because comments are not readable here. Before delivery, confirm it carries item 4, the CR1/CR3 reconcile hazards, and the `handleInsertStep` local-step-drop risk.

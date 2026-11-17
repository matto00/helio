## Standing Constraints

<!-- methodology-carryover (CON-161): agreed constraints, one bullet per id. -->

## 1. Red first

- [x] 1.1 Write `e2e/hel1684-draft-structural.spec.ts` (design.md D11) and run it against the unchanged code. Keep the
      failing transcript (disabled controls) as evidence in `openspec/changes/draft-structural-operations/evidence/`.

## 2. Draft model (`state/pipelineDraft.ts`)

- [x] 2.1 `DraftOverlay` v2 op log, `DraftOp` union, `isDraftClientId`, clientId minting (D1, D4).
- [x] 2.2 Pure op appliers `insert`/`append`/`head`, `lane`, `duplicate`, `reorder` over `Step[]`, each unit-tested
      against the server primitive it mirrors, with the Scala line cited in the test (D1). `delete` keeps its current
      semantics and also handles new steps.
- [x] 2.3 `applyOverlay` replay returning `{steps, dropped}` with per-op validation on every replay (D1); a reorder
      whose id set differs from the live trunk set is dropped whole (unit test: base gains a trunk step). Canonical
      empty (D2), `pruneOverlay` for clientId configs/enabled. Delete of a new step with a tail (unit test).
- [x] 2.4 `rebaseOverlay` with dependent-op dropping and counts (D8).
- [x] 2.5 `toDraftSteps` with `clientId`/`parentClientId` (D5); `toDraftOutputs` unchanged.
- [x] 2.6 `liveTrunkIds` and the temp-step rules (D1a) with their unit tests; `post()` refuses on a dropping replay.

## 3. Kept draft (`state/keptDraft.ts`)

- [x] 3.1 v2 write/read with op-by-op validation; v1 restore as delete ops (D7). Unit tests for v1, v2, malformed, and a duplicate op missing `config`.

## 4. Hooks and routing

- [x] 4.1 `usePipelineDraft`: `insertStep`, `addLaneStep`, `duplicateStep`, `reorderTrunk` actions.
- [x] 4.2 `usePipelineDetailPage`: route the five actions into the draft while `hasDraft` (D3), for AI kinds too.
      Split the block reason: step actions unblocked; roots, shapes and Outputs (incl. aggregate-tail Output and
      add Output) stay blocked.
- [x] 4.3 Per-step fetches skip clientIds (D4).
- [x] 4.4 `usePipelineDraftSave`: `stepNamedBy` resolves clientIds (D5); selection and `?step=` after save and after
      Undo (D6).
- [x] 4.5 `usePipelineDraft`: drop ops that no longer apply after a base change and surface the count (D1/D8). (Covered at the pure level by `draftOps.test.ts`/`pipelineDraft.test.ts`; the effect itself has no hook-level test.)
- [x] 4.6 Frames: new steps show only the draft count (D9); a unit test for a clientId through `draftPreviewRequest`.

## 5. UI wiring

- [x] 5.1 Spine, `useSpineStepActions`, `StepCardFocused`, `MobileStepSheet`, `MobilePipelineHeader`,
      `PipelineMobileLayout`: step actions enabled during a draft; root/shape/Output controls keep the reason.
- [x] 5.2 Update `PipelineDetailPage.draftMode.test.tsx` and `e2e/hel1631-draft-mode.spec.ts:527` to the new blocked
      set.

## 6. Verification

- [x] 6.1 Unit + component tests green (jest maxWorkers 3); lint, typecheck, format.
- [x] 6.2 The new e2e spec green on desktop and phone; plus hel1631, hel1685, hel1632, hel1705, hel1582 and hel1668
      (Playwright workers 2).
- [x] 6.3 Visual check against the running app: desktop and 375px phone, light and dark, a draft with a new step and a
      lane step; screenshots in evidence.

## 7. Design-gate round-3 notes (binding guidance, see skeptic-design-3.md)

- [x] 7.1 Append vs insert in a draft is decided by the caller (`handleAddStep`) or against the draft lane, never by
      `index >= stepsRef.current.length`. Test: a draft with two new steps, then an insert at the last gap.
- [x] 7.2 D10 filter: keep the reordered lane's ids that are in `liveTrunkIds(draftSteps before the move, rootId)`.
      Never call it on `reorderLane`'s output. The D1a test moves a saved step across the swept temp step.
- [x] 7.3 The v2 restore does not rebase at read time when `kept.base` differs (stale), so D8's count stays complete.
- [x] 7.4 PR body: a pending AI step's deferred create landing mid-draft drops a reorder of that root (with the notice).

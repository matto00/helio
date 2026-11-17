## Standing Constraints

<!-- methodology-carryover (CON-161): agreed constraints, one bullet per id. -->
- [C1] Draft Output delete keeps the sheet two-click confirm (records the op); Save shows the existing cascade dialog
- [C2] Every draftable action gets an e2e that fails first, desktop+phone, light+dark, real readiness waits
- [C3] Backend DraftDiff.planOutputs edit validation fix ships with a backend test that fails first
- [C4] One PR covers Outputs and shapes (owner ruling one-pr); never split unilaterally, escalate with evidence

## 1. Red first

- [x] 1.1 Write `e2e/hel1733-draft-outputs-shapes.spec.ts` (design.md D13) and run it against the unchanged code; keep
      the failing transcript (disabled controls) in `openspec/changes/draft-outputs-and-shapes/evidence/`.
- [x] 1.2 Write the `DraftDiffSpec` cases (D12 a-c) and the route-level case; run them on unchanged code and keep the red
      transcript in the same evidence folder.

## 2. Backend (D12, D7)

- [x] 2.1 `DraftDiff.planOutputs`: update branch validates against `cur.config`; `RestorePriorStored` under restore for
      update and create. Tests from 1.2 go green; the rest of the draft-save suite stays green (`sbt testFull`, read the
      summary).
- [x] 2.2 `NodeCapabilitiesParitySpec` + checked-in fixture `frontend/src/features/pipelines/state/__fixtures__/nodeCapabilitiesParity.json`
      (capabilities over every field type, synonyms and an unknown type, every kind, plus `mergeConfig` cases);
      `buildNodeCapabilities` moved unchanged to the `PipelineNodeReads` companion (D7).

## 3. Draft model

- [x] 3.1 Overlay v3: `outputCreate`/`outputDelete` ops, `outputEdits` map, Output clientIds (D1).
- [x] 3.2 Interleaved replay in `replayOps` with `state/draftOutputs.ts` helpers (D1); unit tests per rule: rebase with a
      vanished saved node (counted, Save sends nothing), Output on a step a later delete removes (not counted),
      edit-then-delete (dropped 0).
- [x] 3.3 `isOverlayEmpty`/`pruneOverlay` over Outputs (D2): the structure reset drops step ops only (test: config edit +
      outputCreate keeps the create); edit-back, create-then-delete, edit-then-delete.
- [x] 3.4 `draftMerge` (D4) unit-tested against the parity fixture's merge cases.
- [x] 3.5 `state/nodeCapabilities.ts` port (D5) asserted against the parity fixture (D7); labelled guard with recorded
      mutation.
- [x] 3.6 Rebase/replay counts include Output ops (D1, D11).

## 4. Kept draft (D11)

- [x] 4.1 v3 write/read (`outputsBase` separate from `base`) with op-by-op validation; v2 and v1 restore compared on
      steps only and NOT stale; unit tests for v1, v2, v3, malformed Output op.
- [x] 4.2 Base-Outputs readiness (D15): the restore stays at steps-ready (unchanged effect and condition); effect-free
      selectors moved up; page-local `outputsStatus` from this page's own `fetchOutputs`; the Output part of the replay,
      prune and counting wait for "loaded"; the Output-base judgement runs inside the existing drop/prune effect before any
      count, one-shot per restore, keeping Output ops on a stale flip; the failed-list behavior; the "Outputs are still
      loading" gate only while a draft exists; judgement trigger on restore AND loaded in either order. Unit tests (1)-(8) of D15.

## 5. Save request (D9)

- [x] 5.1 `buildDraftSaveRequest` emits replayed Outputs (`id`/`clientId`, `nodeStepId`/`nodeStepClientId`/`rootId`);
      unit tests incl. a dropping replay sending nothing and cascade names for draft Outputs; `stepNamedBy` names a
      created Output.
- [x] 5.2 Post-save pick resolution for a created Output (D10); unit test.

## 6. Routing and hooks (D3, D8)

- [x] 6.1 `usePipelineDraft`: `createOutput`, `editOutput`, `deleteOutput`, `applyShape`, `addAggregateTail` actions (one
      overlay update each).
- [x] 6.2 `usePipelineDraftRouting`: the five routed handlers; `useOutputImmediateActions` holds the moved immediate
      thunks unchanged. Key-set guard (`usePipelineDetailPage.keys.test.tsx`) updated deliberately for new keys only.
- [x] 6.3 (assertions in `ui/spine/draftBlocks.test.tsx`, `PipelineDetailPage.draftMode.test.tsx`, `usePipelineDraftRouting.outputs.test.tsx`) Apply the D3 consumer table (roots blocked; Outputs/shape unblocked; temp-step guards kept and extended to
      "Add output", the picker and the aggregate tail); one unit assertion per row, draft and no-draft; routed handlers
      refuse temp targets. Root rule for a "Pipeline source" target (D1, single root only).
- [x] 6.4 Shape: fresh `draft-` clientIds per expansion step, expansion ids only as map keys, anchor over draft steps,
      one overlay update; unit test with an Output-bearing expansion fixture (D8). Aggregate tail via a lane op.

## 7. UI

- [x] 7.1 `OutputEditorSheet` draft mode: page handlers instead of thunks, draft capabilities/columns/preview with the D5
      fallbacks, footer hint, two-click delete text unchanged (C1), History disabled for a created Output.
- [x] 7.2 (Jest (a)-(g) and the picker wiring in `OutputEditorSheet.draft.test.tsx`; the e2e uses the type-sensitive histogram control, see design.md D5) `sheetNodeStepId` page state set by the sheet's Step picker; `sheetDraftNode` holder written by the active
      layout while the sheet is open; sheet node added to `outputNodeStepIds` (D5 wiring). Typed schema (D5): unchanged
      root node -> saved capabilities; every step node in a draft -> `analyze-proposal` over the draft (with
      `pipelineName`, every step's `enabled`, no temp steps) + TS port; disabled node -> nearest enabled ancestor's
      schema; unavailable (404 for an editor grantee, verified in skeptic-design-4.md; 500) -> type-restricted kinds not
      savable. Jest (a)-(g) and the picker change.
- [x] 7.3 `page.draftOutputs` feeding `SpineOutputs`, step Output chips, `resolveDisplayedOutput` and the Live Output
      column; card meta copy; per-Output server reads skip clientIds (D10).

## 8. Verification

- [x] 8.1 Update `hel1631-draft-mode.spec.ts` and `hel1684-draft-structural.spec.ts` blocked-set assertions (roots only).
- [x] 8.2 e2e from 1.1 green; run alongside `hel1631`, `hel1684`, `hel1685`, `hel1705`, `hel1704` (Playwright workers 2).
- [x] 8.3 Visual check in the running app: light and dark, desktop and 375px phone (D14); screenshots in evidence.
- [x] 8.4 Remove this run's dev-DB residue by exact id before Delivery.

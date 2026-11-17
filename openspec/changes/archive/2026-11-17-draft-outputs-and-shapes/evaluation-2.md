## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `9326c352508718acd6a7c0a9b501c77e9aa0b461` (commits 110569048 and 9326c3525 on top of cycle 1's 60177b735) against the live-resolved base `e0443c24d0c02b41cdda105a410cea0b6bdf2b33`.

### Fresh gate runs (this evaluator, in WORKTREE_PATH)
- `npm run lint`, `npm run format:check`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`: all exit 0.
- `npm test` (`HELIO_JEST_MAX_WORKERS=3`): root 66 suites / 579 tests passed; frontend 787 suites / 9638 tests passed (+19 since cycle 1); exit 0.
- Backend: `git diff --name-only 60177b735..HEAD -- backend` is empty, so nothing changed since cycle 1. My cycle-1 `sbt testFull` run (9588 succeeded, 0 failed, 5 canceled, "All tests passed.") still covers the identical backend tree.
- e2e (`DEV_PORT=7165 BACKEND_PORT=10072`, `--project=dev --workers=2`): `hel1733` together with `hel1631`, `hel1632`, `hel1684`, `hel1685`, `hel1704` and `hel1705` gave **89 passed, 0 failed, 0 flaky** (6.4 min).

### The 11 cycle-1 change requests, each checked
1. **Done.** Routing now goes through `usePipelineDraftRouting`. `handleCreateOutput`, `handleUpdateOutput` and `handleDeleteOutput` each fall back to `outputActionsNow` (`hooks/useOutputImmediateActions.ts`, the thunks and post-create `previewOutput` moved verbatim) when `!inDraft`. `PipelineDetailDialogs` passes them as the sheet's `actions`. `OutputEditorSheet.tsx` is now 387 lines (was 491); node data moved to `ui/outputEditor/useOutputSheetNode.ts` (79 lines) and draft derivations to `draftSheetState` in `outputSheetDraft.ts`. A unit test covers the no-draft fallback ("routed Output handlers with no draft fall back to the immediate writes").
2. **Done.** `state/pipelineDraft.ts` is 379 lines (was 414). The Output prune rules moved to `state/draftOutputs.ts` (197). `jsonEqual` moved unchanged to `state/jsonEqual.ts` and is re-exported.
3. **Done.** A4 now picks Bar. `verifyBody` asserts `config` `{chartType: "bar", fieldMapping: SEEDED_MAPPING}`, and a new `verifyStored` re-reads `GET /api/pipelines/:id/outputs` after reload and asserts the same. It runs in desktop-light and phone-dark and passed in my run.
4. **Done.** The e2e "the Live Output column renders a created Output from the draft rows and requests nothing by its client id" selects the created Output and waits for "Rendered from the cached sample." with Rows out 14. It asserts no `draft-` request. `LiveOutputColumn.test.tsx` adds a "with an Output the draft created" block, with a recorded mutation (ignoring `isDraftOutput` turns both cases red).
5. **Done.** The e2e "Discard drops a created Output, an edit, a delete, a shape and an aggregate tail at once, with no request" restores the saved step titles and Outputs exactly, and records an empty request log.
6. **Done**, with a caveat on the red evidence (non-blocking).
   - The real-backend e2e opens the histogram field with the real `analyze-proposal`. It asserts `status` is absent before a draft cast and offered after a draft `cast status -> float`.
   - Jest adds D5 (c), (d) and the picker-wiring test ("changing the Step picker to a draft-new step reports the node, and the columns become that step's").
   - `e2e-type-seam-red.txt` is genuine (base-commit `frontend/src`). But it stops at the disabled "Add output", not at the type assertion. The guard's real failability is the positive "after the cast" assertion: it cannot pass vacuously, because a sheet typed from frame names or saved capabilities would not offer `status`.
   - Case (e) now mocks only the 404 rejection; the 500 half is not separately exercised. Both go through the same rejection handler in `useDraftNodeCapabilities`.
7. **Done.** `ui/spine/draftBlocks.test.tsx` holds the D3 rows: Add source blocked; "+ Output" enabled plus its loading/failed reason; shape button enabled, anchoring on the last real trunk step, and disabled for an all-temp trunk; step "Add output" on saved vs `step-N` and with no draft, plus its loading reason; phone header "Add source" blocked; phone shape item enabled, anchoring on the last real step, and waiting while loading; nothing blocked with no draft.
   - The executor reports partial coverage of the aggregate tail's loading reason and the phone all-temp trunk. I accept that: the aggregate tail is only reachable through the sheet, whose entry points ("+ Output", step "Add output") are themselves gated and tested; and the phone shape item uses the same anchor rule as the desktop test.
8. **Done.** `HISTORY_AFTER_SAVE` is removed. `SpineOutputs.tsx` keeps the single literal.
9. **Done.** `usePipelineDraftRouting.ts` passes `config: aggregateConfig` with no cast.
10. **Done.** `evidence/backend-testFull.txt` is now the summary excerpt. The 15.5 MB blob remains in branch history until the squash merge.
11. **Done.** tasks.md 6.2, 6.3 and 7.2, and design.md D3, the D5 hint placement and the D5(a) substitution, now describe what is implemented and tested.

### Points the executor raised
- **The sheet falls back to `useOutputImmediateActions` when `actions` is omitted.** The only production call site (`PipelineDetailDialogs.tsx:45`) always passes `actions`, so the app's decision lives in `usePipelineDraftRouting`. Non-blocking; see Suggestions.
- **hel1631 "a server-only step updates through the draft-preview transport".** It passed in my 89-test run alongside the new spec (2 workers). That is no evidence this diff causes it; I record it as a load-sensitive one-off, not a regression.
- **Specs not re-run by the executor** (hel1632/1684/1685/1704/1705): all re-run by me, all green (counts above).

### Phase 1: Spec Review — PASS
Issues: none.
- All three ACs are addressed with e2e coverage: each action applied atomically or discarded; kept-draft restore, v2 restore, stale base and undo; desktop and phone, light and dark, red first.
- Constraints C1-C4 are honored.
- The planning artifacts now match the implementation.

### Phase 2: Code Review — PASS
Issues: none blocking.
- The refactor preserves behavior. The no-draft paths dispatch the same thunks, in the same order, with the same post-create preview.
- One drive-by: `OutputEditorSheet.tsx` (save error handler) now shows `err.message` for an `Error` on the immediate path too, where it previously showed "Failed to save output.". The thunks reject with strings (`rejectWithValue`) or plain serialized objects, so this is practically unreachable.
- No dead code, no new escape hatches, no new CSS or tokens.

### Phase 3: UI Review — PASS
Issues: none.
- No CSS or visual change in cycle 2; the only copy-placement decision (the hint at the bottom of the sheet body) is unchanged and remains the skeptic's call.
- My cycle-1 live review (1440/1100/768/375, light and dark) stands.
- The cycle-2 e2e exercises the new Live Output and type-seam paths against the running app.

### Overall: PASS

### Non-blocking Suggestions
- Make `OutputEditorSheet`'s `actions` prop required and have the standalone sheet tests pass `useOutputImmediateActions(pipelineId)` through a tiny wrapper. That removes the second, test-only route to immediate writes.
- Add the 500 variant to D5 case (e) (`OutputEditorSheet.draft.test.tsx:140`), e.g. as a parameterised case.
- Record a mutation for the type-seam e2e: e.g. have `useDraftNodeCapabilities` return `savedCapabilities` for step nodes, and show the "after the cast" assertion going red. The current red transcript stops at the disabled control.
- `evidence/e2e-green-alongside.txt` still holds the cycle-1 86-test run. Refresh it, or note the 89-test run above.
- `sheetReady` could wait for a populated field picker rather than only the absence of "Checking column types" (the "before the cast" negative assertion can pass while the projection is still checking).

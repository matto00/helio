## Refactor rules (bind every task)

- Behaviour-preserving only: a bug found during the split becomes a filed follow-up (named in the PR), never a fix here.
- Preserve the relative call order of every effect-bearing hook; effect-free calls may move (design.md D1).
- Returned keys and exported names of both hooks unchanged; consumers untouched except import paths.
- Any new e2e or guard fails first, or is labelled a guard with a recorded mutation that turns it red.

## 1. Baseline

- [x] 1.1 On the unmodified branch, run jest (pipelines hooks + `PipelineDetailPage` tests) and the hel1631, hel1684, hel1685, hel1705 e2e specs; record pass counts in `evidence.md`
- [x] 1.2 Record the returned key sets of `usePipelineDetailPage` and `usePipelineDraftSave` on main in a jest key-set guard; verify green, then a recorded mutation (drop a key) turns it red

### Frontend

## 2. Split usePipelineDraftSave (design.md D3)

- [x] 2.1 Extract `draftSaveRequest.ts` (builder, `noticeForSaveError`, `runRefusedMessage`, `stepNamedBy`, notice types); verify typecheck and the `dropped` test pass
- [x] 2.2 Extract `usePipelineDraftAdopt.ts`, `usePipelineDraftUndo.ts`, `usePipelineDraftSettle.ts` with D3's inputs/outputs; keep re-exports; verify every D3 file <= 250 and jest green

## 3. Split usePipelineDetailPage (design.md D1, D2)

- [x] 3.1 Extract `usePipelineDraftRouting.ts` and `usePipelineDetailStepActions.ts`; verify identity tests green
- [x] 3.2 Extract `usePipelineDetailAnalyze.ts`, `usePipelineDetailUiState.ts`, `usePipelineStepsSeed.ts`, `usePipelineDetailSaveWiring.ts`; verify analyze/sourceSamples/identity tests green
- [x] 3.3 Rebuild the composer's return via exact-key spreads; verify the key-set guard green, every new file <= 250, composer <= 300, and record measured sizes in design.md

## 4. Narrow-desktop step preview (design.md D4)

- [x] 4.1 Write `e2e/hel1704-narrow-preview-title.spec.ts` (D5); run it before any CSS change and record the expected red (900x600 title, both themes) in `evidence.md`
- [x] 4.2 Apply the D4 CSS (title-row min-height from tokens, shrinkable editor, disclosure only); verify the new spec and hel1685 addendum G green; if title + first row cannot both hold, stop and return ESCALATION
- [x] 4.3 Rewrite the `PipelineSpineLayout.css:64` comment; screenshot the running app at 900x700 and 900x600, light and dark, and at 1280x800 to show nothing else moved

### Tests

## 5. Verification

- [x] 5.1 Unit test `buildDraftSaveRequest` (4 kinds) and `noticeForSaveError` (3 kinds), labelled characterization guards with recorded mutations
- [x] 5.2 Re-run the full jest suite, lint, typecheck and the four e2e specs plus the new one; record results next to the 1.1 baseline
- [x] 5.3 Delete any dev-DB residue this change created, by exact id; file a follow-up for each bug found

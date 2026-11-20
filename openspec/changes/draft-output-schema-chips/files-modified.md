- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.tsx` — `showsDraftGrid` + one `draftFields` list feeding grid and chips
- `frontend/src/features/pipelines/state/draftSchemaFields.ts` — pure type/name field-list helper (rules 1-3)
- `frontend/src/features/pipelines/state/draftSchemaFields.test.ts` — unit tests (swap, overwrite, fold-vs-insertion chain, rules)
- `frontend/src/features/pipelines/evaluator/steps/rowOps.ts` — exported `renameOrigins` on `foldRenames`
- `frontend/src/features/pipelines/state/draftColumnOrder.ts` — exported existing `renamesOf` (fold order)
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.schemaChips.test.tsx` — D5 component tests (committed red first, 126e4eece)

## Evidence
- Red run (full StepPreviewTable files, unchanged code): 3 failed (rename, large schema, descendant), 8 passed; `.concertino/scratch/HEL-1777/red-run.txt`. Red commit used `-n` (hook jest would fail on red by design).
- Mutations (`.concertino/scratch/HEL-1777/mutations.txt`): M1 chips back to analyzeOutputSchema -> 3 red; M2 rule 1 removed -> 1 red (rename); M3 showsDraftGrid ignoring step.enabled -> 1 red (disabled-step).
- Gates: lint, format:check, typecheck, jest features/pipelines (207 suites, 3200 tests) pass, frontend build ok.
- e2e (lane DB helio_hel1777, 2 workers): hel1631-draft-mode 10 passed; hel1632-live-output 15 passed. No selector altered (e2e "Output schema" dialog selectors unchanged).

## Round 1 (skeptic-final-1)
- `StepPreviewTable.tsx` — chips fall back to the saved schema when the draft frame has zero rows (new D1a + spec scenario "An empty draft frame"); `foldOrderRenamesOf` no longer aliased
- `state/draftColumnOrder.ts` — `renamesOf` renamed `foldOrderRenamesOf` at its source
- Red: `.concertino/scratch/HEL-1777/red-run-2.txt` (1 failed, 11 passed), committed before the fix. draft.columnOrder is empty for a zero-row frame (verified in code), so the fallback is the saved schema.
- Gates green (jest features/pipelines 3201 tests); e2e hel1631-draft-mode 10 passed, hel1632-live-output 15 passed.

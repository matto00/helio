## Standing Constraints

- [C1] The e2e negative assertion matches the real panel batch save exactly: POST /api/panels/updateBatch
- [C2] The sign-out (clearAuth) reset test goes through the real root reducer in store/store.ts, never panelsReducer alone

## 1. Tests (red first)

- [x] 1.1 Add a failing `SaveStateIndicator.test.tsx` case: a layout-only `updateDashboardLayout.fulfilled` -> "Last saved just now"; run the full file and commit the red run (or record it as .txt evidence)
- [x] 1.2 Add failing/pinning reducer tests: repair leaves `lastSavedAt` null; `resetPanelSaveState` and `clearAuth` clear a layout-set timestamp; run them
- [x] 1.3 Add the e2e `e2e/hel1657-layout-save-last-saved.spec.ts` (drag-only save -> meta row "Last saved just now", no panel save request) and record it red against the unfixed code

## 2. Frontend

- [x] 2.1 Add `updateDashboardLayout.fulfilled` -> `state.lastSavedAt = Date.now()` in `panelsSlice.extraReducers`, with a comment on the field; verify 1.1-1.3 turn green
- [x] 2.2 Update `SaveStateIndicator.tsx`'s comment if it names `lastSavedAt` as panel-only; verify lint/typecheck pass

## 3. Verification

- [x] 3.1 Mutation: remove the new case and confirm 1.1 and 1.3 go red, then restore; record the run (run by the cycle-1 evaluator, not the executor: unit 4 failed/12 passed and the e2e red with the case removed; see evaluation-1.md and evidence eval-mutation-summary.txt)
- [x] 3.2 Run the full touched jest files, `npm run lint`, `npm run typecheck`, and the new e2e spec (2 Playwright workers) green

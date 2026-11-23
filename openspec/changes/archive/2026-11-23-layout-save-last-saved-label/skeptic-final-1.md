## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `5280c57636815051fac406c8886de5f4d9924d60` against the live-resolved base `e3eda3eda28683075c616a0ebd9935ad4c89b9f9` (`resolve-review-base.sh`, exit 0). The working tree also has the orchestrator's uncommitted tasks.md 3.1 annotation and the untracked evaluation-1.md. I left both as I found them.

### What I verified (with evidence)

- **The diff.** It is one reducer case in `panelsSlice.ts:367-370`: `updateDashboardLayout.fulfilled` sets `state.lastSavedAt = Date.now()`. It also adds a field comment, five tests in `SaveStateIndicator.test.tsx`, one e2e spec and the openspec artifacts. There is no backend, schema or CSS change.
- **The dispatch surface.** `grep "updateDashboardLayout("` finds one dispatch site, `useLayoutSave.ts:266`, which is the user layout save. `repairDashboardLayout` is a separate thunk and does not set the timestamp. A test pins that, and the test stayed green under mutation, which is correct.
- **AC1: red-first unit test.** This is met, and I reproduced the red myself.
  - Green: `SaveStateIndicator|panelsSlice` gave 5 suites and 76 tests passed, exit 0.
  - Mutation: I replaced the new case with a no-op. `SaveStateIndicator.test.tsx` then had 4 failed and 12 passed, exit 1. The failures included "shows 'Last saved just now' after a layout save with no panel save". Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1657/evidence/.concertino/scratch/HEL-1657/skeptic-unit-mutant.txt`.
  - I restored the file with `git checkout`. Red-first is shown by mutation, not by a red commit: the branch has one commit, and the pre-commit hook runs jest. The executor's `evidence/unit-red.txt` also exists.
- **AC2: e2e on the meta row after a drag-only save.** This is met.
  - Green: `e2e/hel1657-layout-save-last-saved.spec.ts --repeat-each=2` had 2 passed, exit 0, on the lane servers. Evidence: `.../skeptic-e2e-green.txt`.
  - Mutation red: with the case no-op'd, the test failed with `Expected "Last saved just now"`, `Received ""`. Evidence: `.../skeptic-e2e-mutant.txt`. I restored the file afterwards.
  - The negative assertion matches the real route, `POST /api/panels/updateBatch`.
  - **Is it the meta row?** A scratch probe at 1280px counted `.save-state-indicator` total=1 and `.dashboard-meta-row .save-state-indicator`=1. The spec's unscoped locator therefore resolves to the HEL-1576 meta row's indicator (`DashboardMetaRow.tsx:176` with `showSaveState`).
- **Reset points.** The `resetPanelSaveState` and `clearAuth` tests go through the real root store (`store/store.ts`). Both went red under mutation, because they first assert that the time is non-null. This shows they exercise the new path.
- **Gates.** `npm run typecheck` exit 0. `npm run lint` exit 0. Prettier `--check` on the 3 changed source files passed.
- **UI judgment.** I took screenshots in light and dark at 1280 after a real drag and Save now.
  - The meta row reads "Last saved just now" with the HEL-1584 check, in the same typography and position as after a panel save. Light and dark match.
  - No markup or CSS changed, so there are no token or component questions.
  - After leaving edit mode the label still reads "Last saved just now".
  - Screenshots:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1657/evidence/.concertino/scratch/HEL-1657/pw/shots/meta-saved-light.png`
    - `.../meta-saved-dark.png`
    - `.../meta-dirty-light.png`
    - `.../page-saved-dark.png`
- **Design soundness.**
  - D2: a HEL-1230 kept-local response still shows "Unsaved changes", because `hasPendingLayout` stays true.
  - D4: a flush of dashboard A that lands on B mirrors the existing panel-save and check-mark behavior.
  - Both are accepted trade-offs and are documented.

### Verdict: CONFIRM

### Non-blocking notes

- The e2e locator `.save-state-indicator__label` is unscoped. It is correct today because only the meta row renders an indicator at 1280. Scoping it to `.dashboard-meta-row` would make the AC's "meta row" explicit and stop a future second indicator from breaking it.
- `panelsSlice.ts` is about 576 lines, over the CONTRIBUTING threshold. This predates the change, and the PR description should propose a split, as the evaluator noted.
- **Environment note for the orchestrator.** On my first start, `start-servers.sh` was invoked without `DATABASE_URL` exported, and the backend came up on the shared `helio` DB, not `helio_hel1657`.
  - I found this when the teardown on `helio_hel1657` matched 0 of 2 users. `psql` showed the 2 users in `helio`.
  - I deleted exactly those 2 recorded users from `helio` through the repo's own `deleteRegistryRun`: deleted 2, and a recount gave 0.
  - I restarted the servers with the lane DB exported. Every run cited above is from the lane DB.
  - If other agents start servers the same way, they may also be writing to the shared DB.
- There is no gate defect: no evidence I relied on depends on mtime ordering.

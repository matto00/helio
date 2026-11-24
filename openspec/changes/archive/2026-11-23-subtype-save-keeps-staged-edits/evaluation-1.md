## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `bffb045bea4a10a0267edcc023c3f83f5f49096a` (commits b634c7707 red, bffb045be fix) against the
live-resolved base `71e2802bbc1acb3b59c60291c6f16431fb404165`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (red-first test, title held throughout, before and after the flush): met. The modal test
  `PanelDetailModal.subtypeSaveKeepsStaged.test.tsx` renders `PanelDetailModal` through a `LiveModal` wrapper that
  selects the panel from the live store by id, as DesktopPanelGrid does, and it also asserts store state. That
  satisfies C15. It checks the title after the controls response lands and again after the batch flush. Both the
  store and the dialog's accessible name ("New title settings") are checked.
- I re-ran the red myself. I checked out b634c7707 in a throwaway detached worktree under the lane scratch dir and
  ran the two new spec files: 10 failed, 10 passed. All 9 per-replacer slice tests and the modal test failed with
  `Expected: "New title" / Received: "Old title"`, which matches `red-output.txt`. The test files are byte-identical
  between b634c7707 and HEAD (`git diff --stat b634c7707 HEAD` touches only panelsSlice.ts and evidence/tasks), so
  the red was not weakened afterwards. The throwaway worktree was removed and `git worktree list` is clean.
- AC2 (nothing lost or double-sent): met.
  - Every slice test asserts that `pendingPanelUpdates` is unchanged by the reducer.
  - The modal test asserts the batch body is exactly `[{id:"p1", title:"New title"}]`, that there is one batch call,
    and that the controls request is `(panelId, controls)` only, with no title or appearance.
  - Live check: one `POST /api/panels/updateBatch` and one controls `PATCH`. The server's final title is
    "Eval Renamed" with the control persisted.
- Inventory: I confirmed it independently by grepping for every `state.items =` writer in panelsSlice.ts. The only
  other writers are list loads/restores (`fetchPanels`, `panelsRestored`, duplicate/import), which the design
  excludes on purpose, plus delete and filter. The legacy `updatePanelTitle`/`updatePanelAppearance` thunks have no
  non-test callers.
- Constraint C15: honored (see above).
- Tasks are all checked and match the diff. No scope creep. The spec delta matches the behavior.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (after `npm ci` at the root, where node_modules was absent):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; root 76/76 suites, 683 tests; frontend 931/931 suites, 10829 tests |
| `npm --prefix frontend run build` | exit 0 |

Mutations (mine, in the throwaway worktree, not in the executor's tree):
1. Reverting only `updatePanelOutputControls.fulfilled` to a whole-panel replace: exactly 2 tests went red, that
   replacer's slice test and the modal test. So the modal test really detects the defect it targets.
2. Removing the per-key appearance merge from `withPendingOverlay`: 12 went red. These were all 9 overlay tests plus
   3 existing HEL-1615 accumulate tests, which shows staging and re-application now share one merge.

The executor's `mutation-output.txt` (divider mutation, 1 red) is consistent with these results.

Regressions:
- `lastSavedAt` and `panelSaveSeq` (HEL-1657/1584) are still set in `updatePanelsBatch.fulfilled`.
- `resetPanelSaveState` and the sign-out reset (HEL-1634) are untouched. With nothing pending the overlay is a no-op,
  and the "nothing pending takes the server copy verbatim" cases cover that.
- The full suites, including the existing panelsSlice, usePanelUpdatesFlush, warm-listener and sign-out spec files,
  are green.

Code quality:
- One shared merge helper. No duplication. Small, well-named helpers.
- The `as Panel` cast is pre-existing code that was moved, not new.
- No dead code.

### Phase 3: UI Review — PASS
Servers were started with start-servers.sh on 7260/10167 against the lane DB and assert-phase printed `PASS servers`.
I used a fresh lane-DB account and a finance template dashboard.

Steps: opened the "Sample: Transactions" output panel modal, clicked Edit, renamed it to "Eval Renamed", added a Text
control, and clicked Save. Then I waited more than 30 s for the batch flush.

A MutationObserver recorded every change to the dialog's accessible name and the grid panel heading. Across the
controls PATCH and the updateBatch it recorded only two states, "Sample: Transactions" then "Eval Renamed". The title
never reverted, either in the modal or in the grid.

At 768 px there was no horizontal overflow (scrollWidth equals innerWidth). The dialog stayed open and labelled.

The only console error was a `502` on `GET /api/pipelines/:id/run-events`, the SSE stream through the Vite proxy. It
fired on page load, before any action in the tested flow, and it comes from a path this diff does not touch, so it
is environmental and not attributable to this change.

Cleanup: logged out and stopped the servers with stop-servers.sh (`STOPPED ports=7260,10167`).

This evidence is observational. The self-authenticating evidence is the jest red/green and the mutation runs above.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `panelsSlice.pendingOverlay.test.ts` uses `{} as never` for some thunk args (appearance/form config). A minimal
  typed fixture would avoid the escape hatch, but these are thunk-arg placeholders that the reducers never read.
- The modal test's batch mock echoes the sent title, so its after-flush assertion cannot tell whether the batch case
  overlays. The slice-level `updatePanelsBatch` case covers that, so this is fine as is.

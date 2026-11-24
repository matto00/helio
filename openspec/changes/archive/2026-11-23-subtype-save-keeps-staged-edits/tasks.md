## Standing Constraints

- [C15] The modal test must render PanelDetailModal with the panel read from the live store (a wrapper selecting it by id, as DesktopPanelGrid does) or assert on store state; a fixed panel prop cannot see the revert and is not a valid red.

## 1. Evidence

- [x] 1.1 Commit `replacer-inventory.txt` (grep command + output enumerating every whole-panel replacer); verify it lists all nine cases in design.md

### Frontend

## 2. Red tests (before any implementation)

- [x] 2.1 Add slice tests: per replacer (8 single-panel thunks + `updatePanelsBatch`), staged title + partial appearance survive `fulfilled`; nothing-pending takes server copy verbatim
- [x] 2.2 Add modal test: staged title + output-controls change shows new title after controls save and after batch flush; batch carries title exactly once, controls request carries none
- [x] 2.3 Run full spec files, commit the red output as `.txt` under the change dir before implementation

## 3. Implementation

- [x] 3.1 Add `withPendingOverlay` and make `accumulatePanelUpdate` use it; verify existing panelsSlice tests stay green
- [x] 3.2 Add `replacePanelFromServer` and route the eight single-panel `fulfilled` cases through it; verify 2.1 green
- [x] 3.3 Overlay pending in `updatePanelsBatch.fulfilled` keeping `lastSavedAt`/`panelSaveSeq`; verify 2.1 batch case green

### Tests

## 4. Verification

- [x] 4.1 Mutation: revert one replacer and confirm its test goes red; record output as `.txt`
- [x] 4.2 Run full panelsSlice*, PanelDetailModal*, usePanelUpdatesFlush, warm listener and sign-out reset spec files green; lint, typecheck, format

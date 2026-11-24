## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD bffb045bea4a10a0267edcc023c3f83f5f49096a against live base 71e2802bbc1acb3b59c60291c6f16431fb404165
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Diff scope.** `git diff 71e2802bb...HEAD --stat`: one production file (`frontend/src/features/panels/state/panelsSlice.ts`,
  +74/-35), two new test files, plus OpenSpec artifacts. Frontend only, no migration, no schema change. That matches the ticket.
- **Replacer inventory is complete, checked independently.** I grepped every `state.items` write in panelsSlice.ts myself.
  Writes that replace items are `fetchPanels.fulfilled`, `panelsRestored`, `duplicateDashboard.fulfilled` and
  `importDashboard.fulfilled`. All four are list loads and are excluded on purpose (design Non-Goals). The rest are the 8
  single-panel subtype/legacy `fulfilled` cases and `updatePanelsBatch.fulfilled`, and the fix routes all nine through
  `replacePanelFromServer`. `deletePanel` only filters items. `fetchPanelPage` touches `paginationState` only. No other
  slice writes panel items.
- **The merge is shared with staging.** `withPendingOverlay` is the exact merge `accumulatePanelUpdate` used before
  (shallow spread plus a key-by-key appearance merge), and `accumulatePanelUpdate` now calls it. Single source, as the
  ticket's "same merge" asks.
- **AC1, red first. I reproduced this myself, not taken from red-output.txt.** I swapped the slice back to its base
  content (`git show 71e2802bb:…/panelsSlice.ts`), ran the two new spec files and got `10 failed, 10 passed`. Both
  `panelsSlice.pendingOverlay.test.ts` and `PanelDetailModal.subtypeSaveKeepsStaged.test.tsx` failed. Then I restored
  the fixed file. `git diff --quiet HEAD` reported CLEAN, so the tracked tree is byte-identical to HEAD. The committed
  red-output.txt agrees (10 failed, "Expected New title / Received Old title").
- **C15 holds.** The modal test renders `PanelDetailModal` through `LiveModal`, which selects the panel from the live
  store by id. It also asserts store state and the dialog's accessible name ("New title settings") at two points: after
  the controls save resolves and after the flush. The reducers are synchronous, so there is no intermediate render in
  which the old title could appear.
- **AC2, nothing lost or sent twice.** The reducers never write `pendingPanelUpdates`, and each slice case asserts the
  pending map is unchanged. The modal test asserts:
  - the batch body is exactly `[{id:"p1", title:"New title"}]`, with one batch call;
  - the controls request is called with exactly `(panelId, controls)`, so no title or appearance goes with it;
  - pending is `{}` after `clearSent`.

  In the batch case, overlaying the still-held sent snapshot is idempotent, and `clearSentPendingPanelUpdates` still
  deletes the entry on an exact JSON match.
- **HEL-1657 and HEL-1634 do not regress.**
  - `lastSavedAt` and `panelSaveSeq` are still set in `updatePanelsBatch.fulfilled`.
  - The sign-out reset clears pending, which makes the overlay a no-op.
  - The full spec files passed: `signOutReset.*`, `sessionResetGuard`, `SaveStateIndicator`, `writeInvalidation`,
    `usePanelData*`, `PanelCard*` and `PanelGrid*` gave 65 suites and 466 tests, all passing.
- **Gates I re-ran myself** (jest 3 workers, nice 19):
  - `panelsSlice|PanelDetailModal|usePanelUpdatesFlush|warmListeners|signOut…` passed: 27 suites, 248 tests.
  - `npm run typecheck` passed.
  - eslint `--max-warnings=0` on the 3 changed source and test files: LINT_OK.
  - prettier `--check`: clean.
- **Mutation.** I did not run it separately. My own full revert, above, makes all 10 new tests red, and that covers it.
  The committed mutation-output.txt (Divider case only goes red) is consistent with this.
- **UI/design judgment (step 4): not applicable.** There are no component, style or token changes, only reducer state.
  The visible effect (the modal title) is covered by the live-store modal test. I did not start servers or use the
  browser, so there is no Playwright session or server left to clean up.

### Verdict: CONFIRM

### Non-blocking notes

- The modal test's `Flush` helper reimplements the flush order of `usePanelUpdatesFlush` (batch, then `clearSent`)
  instead of mounting the real hook. The order matches the hook (lines 91-97), so this is fine. The real hook would
  still be a slightly stronger seam.
- Pre-existing behaviour, not introduced here: if the same panel is re-edited during a batch round trip, the pending
  entry no longer matches the sent snapshot. `clearSent` then keeps the whole entry, and the next flush re-sends the
  already-sent fields too. Values stay correct, but strictly a field can be sent twice in that race (HEL-1575 design).
- To get my own red reproduction I temporarily swapped panelsSlice.ts to its base content in the worktree and then
  restored it (verified: `git diff --quiet HEAD` CLEAN). Disclosed because the role is read-only.

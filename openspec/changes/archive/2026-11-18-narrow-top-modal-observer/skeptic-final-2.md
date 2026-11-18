## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `9d50a7c80070d8b758bf01deccca6a94b4f73416` against the live base `361c22f223ee27409b045860aab6ab889bbbb687` (`resolve-review-base.sh`, exit 0). Raw e2e output: main checkout `.concertino/scratch/HEL-1736/skeptic2-e2e.txt`.

### What I verified (with evidence)

- **Round-1 CR1 (conditional-mount unmount test): addressed.** `Toast.modalWiring.test.tsx` has a new case, "returns the viewport to the body when a conditionally mounted open Modal unmounts". It renders `{show && <Modal open/>}` next to `ToastViewport`, checks the viewport is inside the dialog, unmounts while open, and asserts `isConnected` and `parentElement === document.body`.
  - Mutation M1: I deleted only the unmount-cleanup `unregisterOpenModal(dialog);` (the line after "Unconditional: the dialog may already have been closed", `Modal.tsx:168`). Over `src/shared/ui`, `src/shared/motion` and `src/features/ask`, the result was **1 failed / 595 passed**. The failing test is exactly the new case. In round 1 this same mutation passed all 595 tests. I restored the file with `git checkout`.
- **AC1 (the hook no longer observes the body subtree): met.** `useTopModalDialog.ts` is now `useSyncExternalStore(subscribeOpenModals, getTopOpenModal, () => null)`, and there is no MutationObserver in it.
  - Mutation R1: I wrote the base `useTopModalDialog.ts` back in. "ToastViewport observation › never observes document.body's subtree" failed (1 failed / 48 passed over `Toast*` and `modalDialog*`). Restored.
- **AC2 (toast above the modal is unchanged, full spec green): met.** I ran the full `e2e/hel1668-phone-sheet.spec.ts` myself on the lane-private DB `helio_hel1736`.
  - Setup: `createdb`, with `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1736?user=matt` set for both `start-servers.sh` and the Playwright process. `start-servers.sh` reported READY on 7168/10075 and `assert-phase servers` reported PASS. Playwright ran with `--workers=2`, under `nice -n 19`, in the dev project (StrictMode).
  - Result: **15 passed (2.0m), rc=0**, including item 2 (the toast above the sheet) at all three sizes and :184. The harness deleted its 15 throwaway users.
  - Teardown: `stop-servers.sh` reported `STOPPED ports=7168,10075` and `dropdb` succeeded. The DB is gone (it appears 0 times in `psql -l`).
- **Guard hardening (cycle 2).** At baseline, `modalDialogRegistry.guard.test.ts` passes. Each probe file below made it fail and name the file; I removed each one afterwards:
  - G1: a production `.ts` calling `d["showModal"]()`. In round 1 this bypassed the guard.
  - G2: a `.ts` calling `document.createElement("dialog")`.
  - G3: a `.js` calling `d.showModal()`.
  - G4: a `.jsx` containing `<dialog open>`.
  - Widening the scan to `.js`/`.jsx` produced no false positive on the existing tree (the baseline is green).
- **Cycle-2 changes cause no regression:**
  - `Modal.tsx` `handleClose` now uses a typed local `target` instead of the `dialog!` assertions. The behaviour is identical.
  - The `Toast.tsx` doc comment was re-wrapped. The diff touches only the comment.
  - Over `src/shared/ui`, `src/shared/motion` and `src/features/ask` (jest, 3 workers): **65 suites, 596 tests passed**.
  - `npm run typecheck`: clean. ESLint `--max-warnings=0` on the changed files: exit 0. Prettier `--check`: clean.
- **Semantics vs the old observer.** The old hook counted only `:modal` dialogs. The registry is written only after `showModal()` in `Modal`, the only allowed native-dialog site, so this is equivalent. The guard enforces that no other site exists.
- **Tree state:** after every mutation was restored, `git status` shows only the untracked `evaluation-1.md` and `skeptic-final-1.md`. HEAD did not change during the review.
- **UI/design:** there are no visual or CSS changes. Placement is covered by the e2e above, so no design-standard judgment applies.

### Verdict: CONFIRM

### Non-blocking notes
- Residual guard gaps that design.md accepts: an aliased method name (`const m = "show" + "Modal"`), and a directory named `test` (the existing ones contain only fixtures). Both are contrived.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1c3c4d2a03fa6c5f3272a8d721fbc64d62e5eea7` against the live base `361c22f223ee27409b045860aab6ab889bbbb687` (from `resolve-review-base.sh`, exit 0). Raw output is in the main checkout's `.concertino/scratch/HEL-1736/`: `skeptic-mutations.txt`, `skeptic-e2e.txt` and `skeptic-servers.txt`.

### What I verified (with evidence)

- **AC1 (the hook no longer observes the body subtree): met.** `useTopModalDialog.ts` is now just `useSyncExternalStore(subscribeOpenModals, getTopOpenModal, () => null)`, and no MutationObserver is left in it. R1 mutation: I restored the base `useTopModalDialog.ts` and `Toast.modalWiring.test.tsx` went to 1 failed / 4 passed. Then I restored the file.
- **AC2 (toast above modal is unchanged): met.** I ran the full `e2e/hel1668-phone-sheet.spec.ts` myself on the lane-private DB `helio_hel1736`. `DATABASE_URL` was set for both `start-servers.sh` and Playwright, DEV_PORT was 7168, BACKEND_PORT 10075, 2 workers, dev project (StrictMode). Result: **15 passed (1.8m), rc=0**, including item 2 at 375, 390 and 768. Afterwards I stopped the servers with `stop-servers.sh` (`STOPPED ports=7168,10075`) and dropped the DB (it no longer appears in `psql -l`).
- **Affected jest files.** I ran `shared/ui/Toast*`, `modalDialogRegistry*`, `Modal*`, `shared/motion/BottomSheet*` and `features/ask` with 3 workers: 17 suites and 161 tests passed.
- **Mutations I re-ran** (each restored; `git status` shows only the evaluator's untracked `evaluation-1.md`):
  - R2: remove `registerOpenModal(dialog)` from Modal. 3 failed.
  - R3: remove the `!dialog.open` check from the close listener. 1 failed.
  - Guard G1: add a new production `.tsx` with a raw `<dialog open>`. The guard fails and names the file.
- **Production paths that could leave a modal registered but closed, or open but unregistered:**
  - Enumeration: `showModal(` and JSX `<dialog` appear only in `Modal.tsx` (my own grep). BottomSheet and AskDrawer compose `Modal`, and so do CommandPalette, AddSourceModal and the others. No production code calls `.close()` on a dialog outside Modal, and there is no `createElement("dialog")`, `method="dialog"`, `showPopover` or `requestFullscreen`.
  - StrictMode: the order is register, then cleanup (unregister and close), then re-run (showModal and register). The queued `close` event is then ignored because the dialog is open again. R3 covers this, and the dev-mode e2e passed.
  - BottomSheet exit: `open` stays true during the exit animation, so the dialog stays registered and the toast stays inside the visible sheet until `onClosed`. That matches the old observer.
  - Live probe (dev StrictMode, Chromium, registry imported from the same Vite module URL):
    - Command palette: open makes `top="Command palette"` and moves the viewport into the dialog. Escape makes `top=null` and returns the viewport to the body.
    - Conditional-mount `AddSourceModal` (`SourcesPage.tsx:257`): open puts the viewport in the dialog. Cancel then unmount makes `top=null` and returns the viewport to the body. **Correct as shipped.**
- **The gap: the conditional-mount unmount path has no test.** I removed only the unmount-cleanup `unregisterOpenModal(dialog)` at `Modal.tsx:168`. All 595 tests in `src/shared/ui`, `src/shared/motion` and `src/features/ask` still passed. Every test that reads toast placement lives in `shared/ui` (I grepped for `modalDialogRegistry|getTopOpenModal|useTopModalDialog|toast-viewport` in test files).
  - I repeated the same mutation live through HMR (Vite served the mutated source; I confirmed it by fetching `Modal.tsx`). On `/sources`, I opened Add source and cancelled it. The registry still returned `top='Add data source'` with `isConnected=false`, and **`.toast-viewport` was no longer in the document at all**. React kept portalling it into the detached dialog, so every toast and both live regions vanished until some unrelated re-render.
  - So the conditional-mount unmount path (`{x && <XModal open/>}`; `SourcesPage`, `ConnectorsPage`) depends on one line that no test protects. The old body observer handled this path structurally through its childList records. Under the new design it is an explicit write, and it needs its own red test (C6).
- **Guard regex and comment stripping.** It catches raw JSX `<dialog` (including multi-line forms, per the evaluator's G3) and `.showModal(`. My bypass probe was a production `.ts` calling `d["showModal"]()`: the guard **passed** (not caught).
  - Other known misses: `document.createElement("dialog")` followed by `showModal` through bracket access, `.js`/`.jsx` files, and any directory named `test`. I checked the existing `src/test`, `features/home/test` and `features/sources/test`: all three contain only fixtures and harnesses.
  - The block-comment strip `/\*[\s\S]*?\*\//` could also swallow code if a string or regex literal contains `/*`.
  - All of these are contrived, and design.md accepts the residual risk. Non-blocking.
- **UI/design:** there are no visual or CSS changes, so no design-standard judgment applies. Placement behaviour was checked live above.

### Verdict: REFUTE

### Change Requests
1. **Add a red-first regression test for the conditional-mount unmount path** in `frontend/src/shared/ui/Toast.modalWiring.test.tsx`.
   - The test: render a real `Modal` with `open` inside a conditional (`{show && <Modal open …/>}`) next to `ToastViewport`, check that the viewport is inside the dialog, then rerender with `show=false` (unmount while open). Assert that `.toast-viewport` is connected and its `parentElement` is `document.body`.
   - Record the mutation: delete `unregisterOpenModal(dialog);` at `frontend/src/shared/ui/Modal.tsx:168` (the unmount cleanup) and show the test going red, then restore.
   - Today that mutation survives every test (595/595 green), while the live browser probe shows it detaches the toast viewport from the document.

### Non-blocking notes
- Guard: consider also matching `["showModal"]` and `createElement("dialog")`, and scanning `.js`/`.jsx`. Design.md accepts the risk, so this is optional.
- I am carrying over the evaluator's nits: the `Toast.tsx:187` doc-comment line is about 170 characters (wrap it at about 120), and the `dialog!` non-null assertions in `Modal.tsx`'s `handleClose` could be removed.

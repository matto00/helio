## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `1c3c4d2a03fa6c5f3272a8d721fbc64d62e5eea7` against live base `361c22f223ee27409b045860aab6ab889bbbb687` (resolve-review-base.sh). Every claim below comes from a fresh run by the evaluator. Raw output is in `.concertino/scratch/HEL-1736/eval-jest.txt`, `eval-mutations.txt` and `eval-e2e.txt` (main checkout).

### Phase 1: Spec Review — PASS
- AC1 "the hook no longer observes the whole body subtree": met. `useTopModalDialog.ts` is now `useSyncExternalStore(subscribeOpenModals, getTopOpenModal, () => null)`. `grep -rn MutationObserver frontend/src` (non-test) finds 0 hits, so no production observer of any kind remains.
- AC2 "toast-above-modal unchanged, e2e green": the full `e2e/hel1668-phone-sheet.spec.ts` passed 15/15 (dev project, which runs React StrictMode) on lane-private DB `helio_hel1736`. Item 2 passed at 375, 390 and 768.
- Driver note "re-enumerate raw dialogs": I re-ran the grep. Production `showModal(` calls: only `shared/ui/Modal.tsx:135`. JSX `<dialog`: only `Modal.tsx`. Every other `<dialog` hit is in a comment or CSS, and the two `.showModal =` hits are test-kit stubs. This matches design.md Context. BottomSheet and the Ask drawer compose Modal.
- Driver note "guard test": present. I confirmed with mutations that it fails (see Phase 2).
- Red first: R1, R2 and R3 are all present. I reproduced each one by mutation.
- tasks.md: every item is checked and matches the diff. No scope creep. `usePortalPopover` is untouched (C9). There is no backend, schema or migration change, and `skip_specs: true` is appropriate.
- CONSTRAINTS C1–C9: honored by the diff.

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH):
- `npm run lint`: clean, 0 warnings.
- `npm run typecheck`: clean.
- `npm run format:check`: all files pass.
- `npm test` (HELIO_JEST_MAX_WORKERS=3, nice 19): root suite 66/66 suites and 579 tests; frontend suite 824/824 suites and 9938 tests. All passed.
- `npm --prefix frontend run build`: rc 0.

Mutations. I ran each one and restored the tree afterwards; `git status` is clean.
- R1: restored the base `useTopModalDialog.ts` (body-subtree observer). Result: "never observes document.body's subtree" goes red (1 failed).
- R2: deleted `registerOpenModal(dialog)` in Modal. Result: 3 failed (portal into Modal, stacking, close-race).
- R3: dropped the `!dialog.open` check in the close listener. Result: the StrictMode-race test goes red (1 failed).
- G1: added a new production `.tsx` that renders a raw `<dialog open>`. Result: the guard goes red.
- G2: added a new production `.ts` that calls `d.showModal()`. Result: the guard goes red.
- G3: added a multi-line `<dialog\n className=...>`. Result: the guard goes red.

`Toast.modal.test.tsx` fixture: the diff touches only the `openDialog`/`closeDialog` harness (register/unregister alongside the attribute toggle) and adds a registry reset in `afterEach`. No `expect` line was added, removed or changed, and no test was removed. This fixture change is forced by the removal of the attribute observer, as design.md Decision 6 predicted. It is not a weakening, and the new `Toast.modalWiring.test.tsx` drives a real `Modal` end to end.

Modal wiring:
- Registration is idempotent and order-preserving.
- Every close path unregisters: the `[open]` else-branch, the unconditional unmount cleanup, and the native `close` event (only when `!dialog.open`).
- Under StrictMode the order is showModal/register, then cleanup (unregister and close), then re-run (showModal/register). The queued `close` event that follows is ignored because the dialog is open again.

The registry only notifies on a top change, and its snapshot is a stable reference. `ToastViewport` keeps its `isConnected` guard.

No CONTRIBUTING [mechanical] violations found: no inline FQNs, no dead code, no TODOs. No DESIGN [mechanical] scope applies: there are no CSS or visual changes.

Issues: none blocking.

### Phase 3: UI Review — PASS
- `start-servers.sh` reached READY on ports 7168/10075 with `DATABASE_URL=...helio_hel1736`. I checked that the DB was freshly migrated: 141 rows in `flyway_schema_history`.
- The full `e2e/hel1668-phone-sheet.spec.ts` run (2 workers) passed 15/15 in 1.8m, including the known-flaky line 184. It covers the user-visible behaviour this change touches: an error toast shows above the step sheet (a Modal-based BottomSheet), stays dismissable and is announced, at the 375, 390 and 768 breakpoints, under dev StrictMode.
- No visual or layout changes.
- Servers were stopped with `stop-servers.sh`, and `helio_hel1736` was dropped.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/shared/ui/Toast.tsx:187`: the edited doc-comment line is about 170 characters. The rest of the file wraps comments at about 120. Re-wrap it for consistency (Prettier does not reflow comments).
- `frontend/src/shared/ui/Modal.tsx:183`: `dialog!` non-null assertions inside `handleClose`. Defining the handler as a `const` arrow function after the `if (!dialog) return` narrowing would remove both `!`.
- `modalDialogRegistry.guard.test.ts`: the guard only scans `.ts`/`.tsx` and matches `.showModal(` literally. `dialog["showModal"]()` or a `.js` file would bypass it. Design.md accepts this residual risk; it is worth noting only.

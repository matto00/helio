## 1. Enumerate

- [x] 1.1 Re-enumerate production `showModal(` / `.show()` on dialogs / JSX `<dialog` sites (comments excluded), plus `role="dialog"` and `aria-modal` sites (noting which are native top-layer dialogs) and record the list in `.concertino/scratch/HEL-1736/enumeration.md`; verify it matches design.md Context or update design.md.

## 2. Red first

- [x] 2.1 Add R1 (no body-subtree observer) test; record it red on the unchanged hook.
- [x] 2.2 Add R2 (real `Modal` → toast inside dialog, stacking by open order) tests; record they pass on main, then go red under the mutation "remove the register call" once 3.x lands.

## 3. Implement

- [x] 3.1 Add `frontend/src/shared/ui/modalDialogRegistry.ts` with unit tests (order, idempotent re-register, unregister unknown no-op, subscribe/unsubscribe).
- [x] 3.2 Wire `Modal.tsx`: register after `showModal()`, unregister on every close path, unconditionally on unmount, and on the native `close` event only when `!dialog.open`; Modal tests still pass.
- [x] 3.2a Add R3 (close-event race) tests: `close` dispatched while open keeps the toast inside the dialog (record mutation: remove the `!dialog.open` check → red); `close` after `open` removed returns it to the body.
- [x] 3.3 Rewrite `useTopModalDialog` on `useSyncExternalStore`; no MutationObserver remains; R1 green.
- [x] 3.4 Move `Toast.modal.test.tsx`'s harness off attribute-toggled raw dialogs onto the registry/`Modal` path with every assertion unchanged; file green.
- [x] 3.4a Update the hook header comment and `Toast.tsx`'s ToastViewport doc comment to describe the registry.
- [x] 3.5 Add the guard test (design Decision 5); record its mutation red.

## 4. Verify

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, full jest suite (3 workers) green.
- [x] 4.2 `e2e/hel1668-phone-sheet.spec.ts` in full on a lane-private DB, green (line 184 is a known flake; any other failure is real).

## Standing Constraints

- [C1] Never read/print any .env file or dump the environment (scripts/concertino/.concertino.env may be read by scripts, never printed).
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; DB residue deleted only by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long Bash calls; sbt testFull never bare sbt test.
- [C6] Red first with recorded mutations; evaluator and skeptic run full affected spec files.
- [C7] Scratch in .concertino/scratch/HEL-1736/.
- [C8] e2e on a lane-private DB helio_hel1736 (DATABASE_URL for start-servers.sh and Playwright); clean any residue by exact id.
- [C9] Do not touch usePortalPopover (HEL-1762 concurrent lane).

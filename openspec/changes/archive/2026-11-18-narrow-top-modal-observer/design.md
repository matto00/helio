## Context

See proposal.md - Why. Enumeration of `<dialog>` users on main 361c22f22 (re-derived, not from the ticket's "12 files"):

- `showModal(` production call sites: **only** `frontend/src/shared/ui/Modal.tsx` (line ~134). `.show()` call sites on a dialog: none.
- JSX `<dialog` production elements: **only** `Modal.tsx` (line ~240). The other 11 files the ticket counted (App, QuickLauncherOverlay, shareDialogContext, ProvenancePopover, useProvenancePopoverHost, PanelFullscreenOverlay, OutputSchemaDisclosure, ActionsMenu, MobileNavSheet, Select, Toast) contain the string `<dialog` only in comments; they render a `Modal` or portal into an enclosing dialog via `closest("dialog")`.
- `BottomSheet` (`shared/motion/BottomSheet.tsx`) composes `Modal`, and so does everything built on it (the HEL-1746 Ask drawer `features/ask/ui/AskDrawer.tsx`, `MobileStepSheet`, the Output editor sheet). `CommandPalette` and `HelpOverlay` also compose `Modal`.
- **Not native dialogs (out of scope, four sites):** `shared/chrome/MobileNavSheet.tsx` (a portalled `role="dialog"` div, ~line 325, with its own focus trap) and `features/dashboards/ui/RefinementChatDrawer.tsx` (~line 230, a `role="dialog" aria-modal` div). `features/panels/provenance/ProvenancePopover.tsx` (~line 146) and `features/pipelines/ui/OutputSchemaDisclosure.tsx` (~line 73) are non-modal portalled `role="dialog"` popovers. None of these four is in the browser's top layer, so neither makes outside content inert or hides the toast viewport; today's hook (which queries `dialog` elements only) already ignores both, so leaving them out of the registry preserves current behaviour exactly.
- The executor re-runs this enumeration (native `showModal(`/`.show()`/JSX `<dialog`, plus `role="dialog"` and `aria-modal` sites) and records it in the evidence before coding.

`ToastViewport` is the only consumer of `useTopModalDialog`.

## Goals / Non-Goals

**Goals:** the hook observes nothing on `document.body`; the "most recently OPENED modal" semantics, the `isConnected` guard and every Toast live-region/race behaviour are unchanged; a new raw dialog cannot bypass the registry unnoticed.

**Non-Goals:** changing `Select`/`ActionsMenu`/`ProvenancePopover`/`OutputSchemaDisclosure`'s `closest("dialog")` portal logic; `shortcuts.ts`'s `dialog[open]` guard; `usePortalPopover` (concurrent lane HEL-1762); any CSS.

## Decisions

1. **Registry module, not a context.** `modalDialogRegistry.ts` exports `registerOpenModal(dialog)`, `unregisterOpenModal(dialog)`, `subscribe(listener)`, `getTopOpenModal()` (and a test-only reset). Module-level because `Modal`s mount anywhere (portals, sheets, outside providers); a context would need a provider above every one. Open order = registration order; re-registering an already-open dialog keeps its place (preserves today's "kept dialogs keep their place" stack rule, which matters under StrictMode's double effect).
   - Alternative: observe each open dialog's `open` attribute only — still needs to know the dialogs, i.e. still a registry. Alternative: listen for `toggle` on document — `<dialog>` `toggle` events do not bubble and support is uneven. Rejected.
2. **Modal is the only writer.** Register whenever the `[open]` effect's open branch ends with `dialog.open` true (outside the inner `if (!dialog.open)` block, so an already-open dialog reached by any path is still registered; registration is idempotent), unregister at every `close()` site in Modal (the `[open]` effect's else-branch and the unmount cleanup), plus a `close` event listener on the dialog so a close that bypasses React (a `<form method="dialog">`, a browser-initiated close) still unregisters. **The `close` listener unregisters only when `!dialog.open`** (skeptic design-1 item 1): browsers fire `close` from a queued task, not synchronously inside `close()`, and the app runs under `React.StrictMode` (`main.tsx`), so in dev Modal does `showModal()` → `close()` (simulated unmount) → `showModal()` and the queued `close` event then arrives while the dialog is open again; the same race exists in production for a close+reopen within one task. Unregistering then would drop an open modal and render toasts behind it. The unmount cleanup unregisters **unconditionally** (not only when the dialog is still open). Unregistering an unknown dialog is a no-op.
3. **Hook via `useSyncExternalStore`.** `useTopModalDialog` returns `useSyncExternalStore(subscribe, getTopOpenModal, () => null)`. Snapshot is a stable element reference so no tearing/extra renders. `ToastViewport`'s existing `isConnected` check stays.
4. **`:modal` / jsdom.** Today's hook filtered by `matches(":modal")` with a jsdom fallback. Registration happens only after `showModal()`, so every registered dialog is modal by construction; the `:modal` check is dropped. The registry still checks `dialog.open` before registering.
5. **Guard test** (`frontend/src/shared/ui/modalDialogRegistry.guard.test.ts`): walks `frontend/src/**/*.{ts,tsx}` excluding `*.test.*`, test kits and `src/test/**`; strips comments; asserts the set of files containing `showModal(` or a JSX `<dialog` opening tag equals an explicit allow-list (`shared/ui/Modal.tsx`), and that each allow-listed file imports `modalDialogRegistry`. Adding a raw dialog anywhere fails it with a message pointing at the registry. Mutation to record: add a `<dialog>` to a scratch production file (or remove the import from Modal) → red.
6. **Test fixture move.** `Toast.modal.test.tsx` currently opens raw `<dialog>`s via `setAttribute("open")` — the mechanism being removed. Its harness changes to open dialogs through the registry (register + set `open`), and one new test drives a real `Modal` `open` prop so the Modal→registry→Toast wiring is covered end to end in jest. This is a fixture change forced by the mechanism change, not a weakening: every assertion in the file stays as-is. Registry calls in the harness are wrapped in `act()`.

## Red-first plan

- R1 (fails on main): a test that spies `MutationObserver.prototype.observe` while `ToastViewport`/`useTopModalDialog` mounts and asserts no call targets `document.body` with `subtree: true`. Red on main, green after.
- R2 (behaviour guard, mutation-failable): open a real `Modal`, push a toast, assert the toast viewport is inside the dialog; close, assert back on body. Mutation: delete the `registerOpenModal` call in Modal → red. Also stacking test: two Modals opened sequentially (separate commits), most recently opened wins. Two Modals opening in the same commit register in effect order rather than document order; not observable in any current flow, accepted.
- R3 (close-event race, mutation-failable): with a Modal open and registered, dispatch a native `close` event while `dialog.open` is still true and assert the toast viewport stays inside the dialog (mutation: drop the `!dialog.open` check → red); and the opposite case: remove `open` then dispatch `close` and assert the viewport returns to the body. jest stubs never fire `close` and the e2e runs a production build (no StrictMode), so only this unit test covers the race.
- E2E: `e2e/hel1668-phone-sheet.spec.ts` run in full, unmodified, on a lane-private DB.

## Risks / Trade-offs

- [A dialog closed by DOM removal while open, without Modal's cleanup] → Modal's unmount cleanup unregisters; `ToastViewport` also keeps its `isConnected` guard.
- [A future raw `<dialog>` bypasses the registry] → guard test (Decision 5).
- [StrictMode double effects register twice] → registration is idempotent and order-preserving.
- [Guard's "allow-listed file imports the registry" check is weak (an unused import passes)] → accepted; R2's mutation is what protects the Modal→registry wiring, the guard only stops a new raw dialog appearing.
- [Stale comments] → the hook header and `Toast.tsx`'s ToastViewport doc comment (~line 187) are updated to describe the registry, not an observer.
- [Tests elsewhere that relied on raw `setAttribute("open")` dialogs to move toasts] → executor greps for such tests; only `Toast.modal.test.tsx` is known.

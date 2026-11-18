## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (branch task/narrow-top-modal-observer/HEL-1736; planning artifacts are uncommitted files in the change dir).

### What I verified (with evidence)

- **Native dialog enumeration (design.md Context): correct.** `grep -rn "showModal\|<dialog\|\.show()\|createElement(\"dialog" frontend/src --include=*.ts{,x}` excluding `*.test.*` gives exactly one `showModal()` call (`shared/ui/Modal.tsx:134`) and one JSX `<dialog` element (`Modal.tsx:240`). Every other hit is a comment, a type annotation (`BottomSheet.tsx:43`, `Toast.tsx:62`, `expandFrom.ts:22`) or a jest stub (`pipelineMobileTestKit.tsx:67`, `src/test/conditionalFormatsEditorHarness.tsx:22`). No `.show()` on a dialog.
- **Composition:** `BottomSheet.tsx:3` imports `Modal`. `AskDrawer.tsx:3` (HEL-1746) and `MobileStepSheet.tsx:8` import `BottomSheet`. `CommandPalette.tsx:5/247` and `HelpOverlay.tsx:5/51` render `Modal`. So these all go through Modal, as claimed.
- **MobileNavSheet: claim is FALSE.** proposal.md lists MobileNavSheet among the components that "compose" Modal, and design.md groups it with files that "render a Modal or portal into an enclosing dialog". In fact `MobileNavSheet.tsx:55-57` says "this sheet isn't built on the native `<dialog>` `Modal` primitive (it's a portalled div…)", and line 325 is `role="dialog"` on a div. `RefinementChatDrawer.tsx:230-231` is another `role="dialog" aria-modal="true"` div that the enumeration leaves out. Neither is in the top layer, and today's hook (`querySelectorAll("dialog")`) already ignores both, so behaviour does not change. But the enumeration the driver asked for ("none may be missed") misstates them and does not say why they are out of scope.
- **Current hook:** `useTopModalDialog.ts:47` is `observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ["open"]})`. So R1, a spy on `MutationObserver.prototype.observe` that asserts no body+subtree call, will be red on main. Sound.
- **Only consumer:** `Toast.tsx:192`, and the `isConnected` guard stays at `Toast.tsx:193`. Confirmed.
- **jsdom:** `node -e` with jsdom gives `typeof showModal === "undefined"`. 95 test files stub `HTMLDialogElement.prototype.showModal`/`close` (the stubs toggle the `open` attribute and fire no `close` event). Consequence: a real `Modal` in jest registers through the stubbed `showModal` (so R2 is feasible and passes on main through the observer). The native `close` event path, however, is **never exercised** by the stubs.
- **StrictMode:** `src/main.tsx:113` wraps the app in `React.StrictMode`. Under dev double-effects, Modal goes `showModal()` → (simulated unmount cleanup, `Modal.tsx:164-170`) `close()` → `showModal()`, all synchronously.
- **e2e target:** `playwright.config` line 176: "Setup project: fails unless baseURL serves a production build". So `hel1668-phone-sheet.spec.ts` item 2 runs without StrictMode and cannot catch a dev-only double-effect defect.
- **Fixture move (Decision 6):** `Toast.modal.test.tsx:16-37` drives raw `<dialog>`s by `setAttribute("open")`, and that is exactly the observer signal being removed. Production has no such dialogs (verified above), and the new guard forbids them. Re-pointing the harness to register-and-open while keeping every assertion, plus a real-`Modal` end-to-end test, is a forced fixture change, not a weakening. **Justified.**
- **Guard test (Decision 5):** comment-stripped scan for `showModal(` or a JSX `<dialog` tag against an allow-list. That catches any new top-layer dialog: `createElement("dialog")` still needs `showModal(` to enter the top layer, and a non-modal `.show()` is not top-layer. The mutation is recorded. Sound.
- **Scope:** the plan does not touch `usePortalPopover` (C9). Frontend only. `.openspec.yaml` has `skip_specs: true`, which is consistent with no requirement change. Both ACs are covered (R1 → AC1; R2 + full e2e → AC2).

### Verdict: REFUTE

### Change Requests

1. **Decision 2: the native `close` listener must not unregister a dialog that is open again.** The HTML spec fires a dialog's `close` event from a *queued task*, after `close()` returns. With StrictMode on (`main.tsx:113`), Modal runs `showModal()` → register, then the simulated-unmount cleanup runs `close()` → unregister (and queues a `close` event), then the `[open]` effect runs `showModal()` → register. After that the queued `close` event fires, and as designed the listener unregisters a dialog that is open. The registry then reports no top modal (or the wrong one), and in dev every toast renders behind the modal, inert. The same happens in production whenever a Modal closes and reopens inside one task. Revise Decision 2 so the listener unregisters only when `!dialog.open` (or unregisters only by re-checking `dialog.open`), and state the reason.
   - Add a jest test that is mutation-failable: open a real `Modal`, then dispatch `new Event("close")` on its dialog while `dialog.open` is still true, and assert the toast viewport stays inside the dialog. Record the mutation "drop the `open` check": it must turn red.
   - Add the converse: with `open` false, a `close` event unregisters.
   - Neither jest (the stubs never fire `close`) nor the e2e (production build, no StrictMode) would otherwise catch this.
2. **Correct the enumeration in proposal.md (What Changes) and design.md (Context).**
   - Remove MobileNavSheet from the list of Modal composers. It is a portalled `role="dialog"` div (`MobileNavSheet.tsx:55-57, 325`).
   - Add a short "non-native dialogs" line naming `MobileNavSheet.tsx` and `RefinementChatDrawer.tsx:230` (`role="dialog" aria-modal` divs, not in the top layer, ignored by today's `querySelectorAll("dialog")`, so out of scope and unchanged).
   - Have task 1.1's enumeration also record `role="dialog"`/`aria-modal` sites, so the "none missed" claim is checkable.

### Non-blocking notes

- Decision 5's "each allow-listed file imports `modalDialogRegistry`" check is weak, because an import is not a call. R2's mutation (remove the register call) is what actually guards the wiring. Keep both, but don't present the import check as the protection.
- Unregister unconditionally in Modal's unmount cleanup, not only inside the existing `if (!dialog || !dialog.open) return` early-return path (`Modal.tsx:166`). Otherwise a stubbed or otherwise-closed dialog could stay registered. It is idempotent anyway.
- Calls to `registerOpenModal` in the Toast.modal harness need `act()` so the `useSyncExternalStore` update flushes.
- Update the comments that describe the observer (`Toast.tsx:187`, the hook header) when the mechanism changes.

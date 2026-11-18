## Why

`useTopModalDialog` (the hook `ToastViewport` uses to portal toasts into the topmost open modal, HEL-1668 D2) watches `document.body` with a `subtree: true` MutationObserver, so every DOM mutation anywhere in the app (chart redraws, virtualised table rows, typing) queues a record the hook must filter. The set of open modals is already known at exactly one place, the code that calls `showModal()`/`close()`, so the observer is unnecessary work on a hot path.

## What Changes

- Add a small open-modal-dialog registry (`frontend/src/shared/ui/modalDialogRegistry.ts`): an ordered list of open modal `<dialog>`s with subscribe/snapshot, in open order.
- `Modal` (the only production `showModal()` call site, which `BottomSheet`, the Ask drawer, the step sheet, CommandPalette, HelpOverlay, QuickLauncher, etc. all compose; `MobileNavSheet` and `RefinementChatDrawer` are `role="dialog"` divs, not native top-layer dialogs, already ignored by today's hook and out of scope) registers its dialog right after `showModal()` and unregisters on `close()`, unmount, and the dialog's native `close` event (only when the dialog is no longer open, so a queued `close` from a StrictMode close+reopen cannot drop an open modal).
- `useTopModalDialog` reads the registry (`useSyncExternalStore`) instead of observing the body. No MutationObserver on `document.body` remains.
- A guard test fails if any production file other than the registered ones calls `showModal(` or renders a JSX `<dialog`, so a future raw dialog cannot silently bypass the registry.
- No user-visible behaviour change: toasts still render above (and inside) the most recently opened modal.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — `toast-surface-behavior`'s "Toasts stay visible above an open modal dialog" requirement is unchanged; this is an implementation change, so `.openspec.yaml` sets `skip_specs: true`.)

## Impact

- `frontend/src/shared/ui/useTopModalDialog.ts`, `frontend/src/shared/ui/Modal.tsx`, new `frontend/src/shared/ui/modalDialogRegistry.ts`, `frontend/src/shared/ui/Toast.modal.test.tsx` (fixture moves from raw attribute-toggled `<dialog>`s to the registry/`Modal` path), new unit + guard tests.
- e2e: `e2e/hel1668-phone-sheet.spec.ts` (item 2) must stay green unmodified.
- No backend, schema or migration change.

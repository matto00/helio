## Context

`PanelDetailModal.tsx` already manages a `modalMode` state (`"view" | "edit"`) introduced in HEL-174.
The modal uses a `<dialog>` element and already listens for the native `cancel` event (Esc) via
`dialog.addEventListener("cancel", handleCancel)`. The `attemptClose()` helper already fast-paths
out of close in view mode (no dirty check). The only missing behavior is the `E` key shortcut.

## Goals / Non-Goals

**Goals:**
- Add `keydown` listener that transitions from view to edit mode when `E` (or `e`) is pressed
- Confirm existing Esc behavior already satisfies the ticket's other two acceptance criteria

**Non-Goals:**
- Any other keyboard shortcuts
- Changes to the backend

## Decisions

**Decision: Use a `keydown` listener on `document` scoped to the dialog**

The `<dialog>` element captures Esc natively via the `cancel` event (already handled). For the `E`
key, attaching a `keydown` listener to the dialog element itself is the cleanest approach — it
fires while the dialog has focus, which it does when shown as a modal. The listener is added in a
`useEffect` and removed on cleanup.

Guard against firing while the user is typing in an input/textarea/select by checking
`e.target instanceof HTMLInputElement || HTMLTextAreaElement || HTMLSelectElement`.

Alternative considered: attaching to `document` — rejected because it could fire even when the
modal is not the foreground context; the dialog element is cleaner.

**Decision: No new state needed**

The existing `modalMode` / `setModalMode` is sufficient. Pressing `E` simply calls
`setModalMode("edit")`.

## Risks / Trade-offs

- [Risk] `E` key fires while a text input inside the modal is focused in edit mode →
  Mitigation: guard on `e.target` element type; also the listener only fires when `modalMode` is
  `"view"` (ref used to avoid stale closure)

## Planner Notes

Self-approved: pure frontend-only change, no architectural impact, no new dependencies, no API
changes. The Esc behaviors described in the ticket already exist in the codebase from HEL-174 work.

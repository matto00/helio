## Context

`PanelCreationModal.tsx` already uses the native `<dialog>` element via `dialogRef.current?.showModal()`. The native dialog:
- Fires a `cancel` event on Escape (supported in all modern browsers)
- In Chromium provides a native focus trap; Firefox and Safari do not reliably trap focus
- Does NOT fire events for click-outside by default

The modal has three steps: type-select → template-select → name-entry. "Dirty state" means: a type has been selected, OR a template has been selected, OR the title field is non-empty.

## Goals / Non-Goals

**Goals:**
- Escape key dismisses the modal (leveraging the native `cancel` event)
- Click outside the inner content box dismisses the modal
- Discard confirmation shown before closing when dirty
- Consistent focus trap across all browsers via React-managed logic

**Non-Goals:**
- Applying focus trapping to other overlays (popovers, menus) — out of scope
- Animated discard confirmation — a `window.confirm()` call is sufficient and avoids adding a nested dialog

## Decisions

**Escape via `onCancel`**: The native `<dialog>` fires `cancel` before `close` when Escape is pressed.
We intercept with `onCancel={handleCancel}`, call `event.preventDefault()` to suppress the automatic
close, then conditionally prompt or close. Alternative of attaching a `keydown` listener was rejected
as redundant — the native event is more reliable.

**Click-outside via backdrop click**: Detect clicks where `event.target === dialogRef.current` (i.e.,
the `<dialog>` backdrop area, not the inner div). Call `onClick={handleBackdropClick}` on the `<dialog>`
element. Alternative of a separate backdrop overlay was rejected as unnecessary complexity.

**Discard confirmation via `window.confirm()`**: Sufficient for a first pass. Avoids a nested `<dialog>`
management problem. Can be upgraded to a custom inline confirmation later.

**Focus trap via `focustrap-react` or manual Tab key handling**: The codebase currently has no
focus-trap library. We'll use the `inert` attribute approach: set `inert` on everything outside the
dialog (document body siblings), then unset on close. This is native, zero-dependency, and correct.
Simpler alternative: rely on native dialog focus trap in Chromium and add a `keydown` Tab-intercept for
Firefox/Safari only.

**Decision**: Use the `keydown` Tab-intercept approach (query all focusable elements inside the dialog,
wrap around at boundaries). This is self-contained, no new library needed, and avoids `inert` attribute
browser compatibility concerns.

## Risks / Trade-offs

- [Risk] `window.confirm()` is blocked by some browsers in certain iframe contexts → Mitigation: acceptable for the Helio dev environment; can be replaced later
- [Risk] Focusable element query (`button, input, [href], select, textarea, [tabindex]`) may miss custom
  components → Mitigation: all current modal focusable elements are native `<button>` and `<input>`

## Planner Notes

Self-approved: change is frontend-only, no API or schema impact. Existing `onClose` handler and dialog
reset logic remain unchanged. Tests in `PanelCreationModal.test.tsx` will need new cases for Escape,
backdrop click, dirty-state guard, and focus trap.

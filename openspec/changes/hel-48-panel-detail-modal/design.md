## Context

`PanelAppearanceEditor` is currently rendered inside each grid card in `PanelGrid` when `customizePanelId === panel.id`. It uses `isOpenExternal={true}` (controlled mode) and renders its popover panel as a sibling of the card content — meaning it inherits the card's overflow and z-index constraints. The `OverlayProvider` handles Escape globally but the popover has no backdrop click handler.

## Goals / Non-Goals

**Goals:**
- Full-screen modal rendered as a portal outside the grid, immune to z-index constraints
- Tab bar (Appearance / Data) with active tab state
- Appearance tab hosts the migrated controls (background, text color, transparency)
- Data tab shows a placeholder message
- Dismiss: Escape, backdrop click, Cancel button
- Dirty-check: if form values differ from the panel's persisted values, show an inline "Unsaved changes — discard?" prompt before closing
- Remove `PanelAppearanceEditor` entirely

**Non-Goals:**
- Wiring the Data tab (HEL-49)
- Animating modal enter/exit
- Nested focus-trap implementation (native `<dialog>` element handles this)

## Decisions

**Use `<dialog>` element with `showModal()` / `close()`**
The native `<dialog>` element provides focus trapping, `::backdrop` for the overlay, and fires a `cancel` event on Escape — all for free. It avoids a custom portal + focus-trap implementation and is well-supported across modern browsers. We call `dialogRef.current.showModal()` on open and `dialogRef.current.close()` on dismiss.

Wrapping the `<dialog>` in a React portal to `document.body` is not needed because `showModal()` already renders the backdrop above everything via the top-layer. We keep the component tree simple.

**Tab state as local `useState`**
Tab selection is ephemeral UI state. No need for Redux.

**Dirty check via value comparison**
On each render, compare current `background / color / transparency` state against `panel.appearance`. If any differ, the form is "dirty". On a dismiss attempt while dirty, flip a `showDiscardWarning` boolean to show the inline prompt instead of closing immediately.

**`PanelAppearanceEditor` deleted, not refactored**
The new modal inlines the appearance form logic directly — the popover-specific structure (trigger button, popover panel, scrim) is all gone. The logic is simple enough (3 fields, 1 submit) that a shared hook is premature.

## Risks / Trade-offs

- [`<dialog>` cancel event] The browser fires `cancel` on Escape before we can intercept it to show the discard warning. Mitigation: call `event.preventDefault()` in the `cancel` event handler to suppress the default close, then handle the dirty-check logic ourselves.
- [PanelGrid cleanup] `customizePanelId` state and the inline `PanelAppearanceEditor` render in `PanelGrid` need to be replaced. The modal open state can be kept the same way (`detailPanelId: string | null`) — just the rendered component changes.

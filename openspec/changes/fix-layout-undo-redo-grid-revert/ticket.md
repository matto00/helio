# HEL-1028: Layout undo/redo updates store and history but the grid does not visually revert

## Description

Layout undo (Cmd/Ctrl+Z) and redo (Cmd/Ctrl+Shift+Z) on a dashboard fire correctly and mutate state, but the panel grid does not visually revert. The user drags a panel, presses undo, and nothing appears to happen. Reproduces identically via the header undo/redo buttons in app/CommandBar.tsx, so it is pre-existing and not a keyboard-binding problem. Suspicion (unverified): the reverted layout reaches the store but PanelGrid does not re-render from it (RGL internal layout state, or a missing prop/key sync).

## Acceptance criteria

- Dragging a panel and pressing Cmd/Ctrl+Z visibly returns the panel to its previous position.
- Cmd/Ctrl+Shift+Z visibly reapplies it.
- The same holds via the CommandBar header undo/redo buttons.
- A real-browser (Playwright) test proves the visual revert (rendered position), not merely that the store changed.

## Out of scope

The keyboard bindings themselves.

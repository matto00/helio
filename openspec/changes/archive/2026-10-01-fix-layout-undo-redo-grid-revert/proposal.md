## Why

Layout undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and the CommandBar buttons) mutates history and the store but the grid
does not visually revert. Probe-confirmed root cause (real browser, react-grid-layout 2.2.4): a drag only writes the
grid's `latestLayoutRef`; the store layout is not updated until the 30s autosave. RGL's `Responsive` resyncs its
internal layout only when the `layouts` PROP changes against the previous PROP. Undo therefore writes a pre-drag
snapshot that is deep-equal to the layout the prop already held, so RGL sees "no change" and keeps the dragged
position. The same gap makes redo wrong: `undoLayout` pushes the store layout (pre-drag) onto the redo stack, not
the layout the user actually saw.

## What Changes

- At drag/resize stop, commit the grid's live layout into the store (`setDashboardLayoutLocally`), so the store is
  the layout the user sees and the `layouts` prop moves with every interaction.
- `useLayoutSave`: a store layout change that merely echoes the grid's own live layout no longer counts as
  "persisted", so a committed drag is still auto-saved; persisted state is advanced on a successful PATCH.
- Add a real-browser Playwright spec proving the rendered position reverts/reapplies via keyboard and CommandBar
  buttons, red on main and green with the fix.

## Capabilities

### Modified Capabilities

- `layout-undo-redo`: undo/redo must visibly move the rendered panel, and redo must reapply the undone layout.

## Impact

`DesktopPanelGrid.tsx`, `useLayoutSave.ts`, tests, one new `e2e/` spec. No backend, no schema, no new dependency.

## Non-goals

- Persisting an undo/redo to the server (pre-existing, separate defect; filed as a follow-up).
- Per-breakpoint layout derivation (HEL-1023 rewrites that; this change stays in the store-to-grid sync).
- Keyboard bindings. The mobile stack (below 768px container width), where no RGL grid mounts and the `xs`
  breakpoint is therefore unreachable.

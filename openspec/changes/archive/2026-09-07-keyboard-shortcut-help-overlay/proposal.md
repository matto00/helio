## Why

The app's global keyboard bindings are declared as data (`shared/chrome/shortcuts.ts`, HEL-496) but are
invisible to users: there is no way to discover that `Cmd/Ctrl+K` opens the palette or that layout undo/redo
exists. The declaration also does not yet carry the grouping or description needed to render such a list, and
`useLayoutUndoRedo` still tests key properties inline — an existing violation of the
`keyboard-shortcut-declarations` spec's "no global binding outside the declaration" rule.

## What Changes

- Extend `ShortcutDeclaration` with `description`, `group`, and a `combo` shape able to express
  modifier-free combinations and a tri-state Shift (required / forbidden / don't-care), so the table can be
  both dispatched from and rendered. `?` is declared on the `?` character with Shift left don't-care, which
  keeps it correct on layouts where `?` is not Shift+`/`.
- Add a `?` binding that opens a keyboard-shortcuts help overlay, and a "Keyboard shortcuts" command-palette
  action that opens the same overlay.
- Add a modal-open guard to global dispatch, so `?` does not fire while any modal is open (Esc still closes).
- Migrate the layout undo/redo binding onto the declaration, replacing its private `isEditableFocused`
  duplicate with the shared `isTypingTarget` guard. No behavior change intended.
- Render combos with platform-correct symbols (⌘/⇧ on macOS, Ctrl/Shift elsewhere) as mono keycaps.

## Capabilities

### New Capabilities

- `keyboard-shortcut-help-overlay`: a discoverable overlay listing every declared global binding, grouped by
  area, with platform-correct combo rendering; opened by `?` or a palette action, dismissed by `Esc`.

### Modified Capabilities

- `keyboard-shortcut-declarations`: declarations gain a description and group; the combo shape covers
  non-modifier and Shift-bearing keys; a shared modal-open guard joins the typing guard; layout undo/redo
  becomes a declared binding rather than an inline handler.

## Impact

- `frontend/src/shared/chrome/shortcuts.ts` (+ test) — declaration shape, guards, platform formatting.
- `frontend/src/features/commandPalette/GlobalCommandShortcuts.tsx` — dispatch `?`; modal guard.
- `frontend/src/features/commandPalette/model/builtInActions.ts` — "Keyboard shortcuts" action.
- `frontend/src/features/layout/hooks/useLayoutUndoRedo.ts` (+ test) — migrate onto the declaration.
- New help-overlay component, CSS, and tests; a Playwright check for real-browser key/focus behavior.
- No backend, wire, or schema impact. Downstream: HEL-516/519/503 build on this registry shape.

## Non-goals

- User-customizable or rebindable shortcuts.
- Per-feature shortcut behavior beyond registration and discovery.
- Declaring HEL-347 panel copy/paste/nudge combos — none have shipped; the registry only makes them listable.

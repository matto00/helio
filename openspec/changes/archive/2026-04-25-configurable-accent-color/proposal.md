## Why

The HEL-62 redesign introduced a single `--app-accent` CSS token that drives every accent surface (dot-grid, nav active state, panel hover borders, chart bar gradients, buttons, badges). Because all accent surfaces derive from one token, letting the user choose their own color is nearly free — no per-component work required. It turns a system-design constraint into a personalization feature.

## What Changes

- Add a curated palette of preset accent colors (6-8 swatches) accessible from the workspace settings entry in the sidebar or UserMenu popover
- On color selection, update `--app-accent` plus its derived rgba variants (`--app-accent-dim`, `--app-accent-mid`) on `:root` at runtime
- Persist the chosen color to `localStorage` so it survives page reloads
- Default to `#f97316` (orange) when no preference is stored

## Capabilities

### New Capabilities

- `workspace-accent-color`: User-selectable accent color with preset palette, runtime CSS token injection, and localStorage persistence

### Modified Capabilities

- `frontend-theme-system`: Theme token application now includes dynamic user-selected accent color applied on top of the static CSS token definitions

## Impact

- Frontend only — no API, schema, or backend changes required
- `ThemeProvider` (or a new `AccentProvider`) gains logic to read/write localStorage and set `:root` CSS variables at runtime
- The sidebar footer or UserMenu popover gains a color-picker/swatch UI entry point
- Existing `--app-accent` CSS declarations in `theme.css` become the fallback; the runtime override takes precedence

## Non-goals

- Per-dashboard accent colors (handled separately by dashboard appearance editor)
- Free-form hex/RGB text input — preset swatches only
- Backend persistence of the preference

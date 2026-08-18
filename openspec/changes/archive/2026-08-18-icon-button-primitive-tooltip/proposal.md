## Why

Icon-only buttons (kebab menus, close buttons, theme toggle, sidebar collapse, etc.) are hand-rolled
independently across ~30 files with inconsistent sizing, hover states, and — critically — inconsistent
tooltip/accessible-name coverage. This is a spinoff of the beta UI/UX polish sweep (PR #382).

## What Changes

- Add an `IconButton` primitive to `frontend/src/shared/ui/` — accessible name (`aria-label`) is required
  at the TypeScript prop level (no optional/`undefined` escape hatch), sized/styled per DESIGN.md §5's
  existing button recipes (ghost/secondary/danger variants, `--control-sm/md`, `--app-radius-sm`).
- Document the `IconButton` recipe in DESIGN.md §5 (Buttons) and register it in §6 (Shared components).
- Document the tooltip pattern icon-only controls use (visible on hover/focus vs. accessible-name-only)
  in DESIGN.md.
- Audit icon-only interactive elements app-wide; migrate the ones lacking a visible or accessible
  tooltip/label onto `IconButton`, and add the missing label to any left un-migrated for a stated reason.

## Capabilities

### New Capabilities

- `icon-button`: the shared `IconButton` primitive (mandatory accessible name) plus the guarantee that
  every icon-only interactive element in the app carries a visible or accessible tooltip/label.

### Modified Capabilities

(none — no existing capability's requirements change)

## Impact

- New: `frontend/src/shared/ui/IconButton.tsx` (+ `.css`, tests), `openspec/specs/icon-button/spec.md`.
- Modified: `DESIGN.md` §5/§6.
- Modified: existing icon-only button call sites app-wide, migrated onto `IconButton` or given accessible
  labels where migration isn't warranted.

## Non-goals

- No new design tokens — reuses existing color/spacing/radius/control-height tokens from DESIGN.md §3.
- Not a general-purpose floating `Tooltip` overlay — the visible-tooltip pattern uses the native `title`
  attribute; no new floating-UI/positioning infrastructure.
- Not building the shared `Button` primitive DESIGN.md §5 notes as not yet existing — labeled (non-icon)
  buttons are out of scope.

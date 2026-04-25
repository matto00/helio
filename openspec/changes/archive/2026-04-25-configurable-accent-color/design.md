## Context

The HEL-62 redesign introduced `--app-accent` and four derived rgba tokens (`--app-accent-strong`,
`--app-accent-surface`, `--app-accent-dim`, `--app-accent-mid`) in `frontend/src/theme/theme.css`.
These are static CSS declarations. The theme system already uses a `ThemeProvider` (React Context) with
localStorage persistence (`helio-theme`) for dark/light switching, making it the natural model to extend.

The existing `appearance.ts` utility has `parseHexColor` and related helpers that can compute rgba
variants from a hex string. UserMenu already receives theme state and toggle via props from the parent;
the same pattern works for accent color.

## Goals / Non-Goals

**Goals:**
- Runtime override of `--app-accent` and its rgba derivatives on `:root` when the user picks a color
- Persist the choice to localStorage with `#f97316` as default
- Surface a swatch picker in the UserMenu popover (alongside the existing theme toggle)
- Keep the change entirely frontend, no backend work

**Non-Goals:**
- Free-form color input (no `<input type="color">` or hex text field)
- Per-dashboard accent override
- Backend/API persistence

## Decisions

### 1. Extend ThemeProvider to manage accent color state

The `ThemeProvider` already owns localStorage reads/writes for theme. Adding accent color state here
keeps all workspace-level preferences in one place. Alternative considered: a separate `AccentProvider`.
Rejected — introduces another context layer and forces consumers to wrap with two providers.

The provider will expose `accentColor` and `setAccentColor` via `ThemeContext`.

### 2. Compute rgba variants in JavaScript, not CSS

The static CSS in `theme.css` uses hardcoded rgba values derived from `#f97316`. At runtime, when a
user picks a different color, we need matching rgba variants. `appearance.ts` already has `parseHexColor`
— we will add `buildAccentTokens(hex: string)` that returns the five CSS variable values, then set them
all on `document.documentElement.style`.

Formula mirrors the existing static values:
- `--app-accent`: the hex value directly
- `--app-accent-strong`: lightened variant (mix with white at 15%)
- `--app-accent-surface`: rgba at 0.12 opacity
- `--app-accent-dim`: rgba at 0.12 opacity  
- `--app-accent-mid`: rgba at 0.25 opacity
- `--app-bg-accent`: rgba at 0.06 opacity

### 3. Preset swatches only — 8 colors

Ticket explicitly excludes free-form input. 8 presets gives enough variety without UI clutter.
Preset list: orange (#f97316 — default), red (#ef4444), pink (#ec4899), purple (#a855f7),
blue (#3b82f6), cyan (#06b6d4), green (#22c55e), yellow (#eab308).

### 4. Swatch UI in UserMenu popover

UserMenu already has the theme toggle. Adding a swatch row below it is consistent with the existing
pattern. The `UserMenu` component receives props from the parent (the Topbar or wherever it's mounted)
— it will receive `accentColor` and `setAccentColor` the same way it receives `theme` and `toggleTheme`.

### 5. localStorage key: `helio-accent`

Follows the existing `helio-theme` naming convention in `theme.ts`.

## Risks / Trade-offs

- [Inline style on :root overrides CSS variables] → Runtime `style.setProperty` on `documentElement`
  takes precedence over `:root {}` declarations in stylesheets. This is intentional and is the standard
  pattern for dynamic CSS variables. Switching back to default requires explicitly removing the property.
- [8 presets may not satisfy all users] → Acceptable per ticket scope; free-form is explicitly out of scope.
- [No migration needed] → localStorage key is new; missing key = default orange. Zero risk of breakage.

## Planner Notes

Self-approved — pure frontend addition, no API or schema changes, follows existing ThemeProvider pattern,
no new external dependencies required.

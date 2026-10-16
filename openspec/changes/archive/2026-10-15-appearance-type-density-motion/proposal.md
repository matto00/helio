## Why

The v0.9 re-design makes sans + mono the default and adds a motion system, so users need to choose a type style, a
density and a motion level, and those choices must follow them across devices without a flash on load. These settings
are also the groundwork for future user themes. HEL-1573 (motion foundation) is blocked on the `data-motion` attribute.

## What Changes

- Settings → Appearance is rebuilt to the approved board: Accent (existing 8 presets, unchanged behaviour), Type style
  (Sans + mono / Mono / Serif headings, preview cards), Density (Comfortable / Compact), Motion (Full / Subtle / Off,
  "Defaults to your system's reduce-motion setting"), and a non-interactive Theme row marked "Later". The light/dark
  toggle stays.
- Three new per-user preferences — `typeStyle`, `density`, `motion` — stored in the existing `users.preferences` JSON
  and accepted by `PATCH /api/users/me/preferences`; returned on every user-returning auth response.
- Root attributes on `<html>`: `data-type-style`, `data-density`, `data-motion` (absent = no saved motion choice).
  Tokens switch on them: font tokens (`--font-heading`; `--font-sans` for the whole-UI Mono style), a documented Comfortable/Compact density token set (panel-grid gutter, list
  row spacing), and the motion tokens.
- The global `prefers-reduced-motion` rule, and the component-level ones, apply only when no motion choice is saved;
  `data-motion="off"` applies them explicitly; an explicit Full beats the OS.
- An inline pre-paint script in `app.html` applies cached appearance attributes before first paint.
- DESIGN.md §3 and §10 updated from "target" to the implemented contract.

## Capabilities

### New Capabilities
- `appearance-preferences`: type style, density and motion settings — their UI, how each is applied app-wide, the
  reduced-motion precedence, and no-flash application on load.

### Modified Capabilities
- `user-ui-preferences`: the partial-update endpoint and auth responses carry `typeStyle`, `density`, `motion`.

## Non-goals

- Building themes (the row is a "Later" placeholder only).
- Motion primitives (staggered entrance, layout slide, value tween, …) — HEL-1573.
- Changing accent presets or their behaviour; changing `DataGrid`'s own `density` prop.
- A new table or migration.

## Impact

Backend: `AuthProtocol.UserPreferences`, `UserPreferenceRepository`, `UserPreferencesRoutes` (+ specs/tests).
Contracts: `schemas/auth/user-preferences.schema.json`, `schemas/auth/update-user-preferences-request.schema.json`.
Frontend: `app.html`, `theme/theme.css`, `ThemeProvider`/`theme.ts`, `SettingsPage`, panel grid config, list/shell row
CSS, reduced-motion consumers (`prefersReducedMotion.ts`, Skeleton/toast/drawer/streaming CSS). DESIGN.md.

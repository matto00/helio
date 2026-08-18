## Why

Theme and accent controls are currently split, undocumented, and out of sync with their own specs.
The theme toggle already lives as a standalone command-bar icon (added by the beta UI sweep's F-082),
but `frontend-theme-system`/`user-menu-popover` still document the toggle as living *inside* the
UserMenu popover — a real spec/code contradiction. The accent color picker still lives inside the
UserMenu popover even though it is a persisted, infrequently-changed preference, not a quick toggle.
HEL-728 resolves both: pick one documented home per control and make code match spec.

## What Changes

- Keep the theme toggle as the single, standalone command-bar icon (already implemented) — update
  `frontend-theme-system` and `user-menu-popover` specs to match reality instead of contradicting it.
- Move the accent color picker out of the UserMenu popover into a new "Appearance" section on the
  `/settings` page, alongside the existing "Preferences" section — grouping it with other persisted,
  infrequently-changed preferences rather than a quick top-bar affordance.
- Remove the now-redundant "Accent color" block (and its now-dead CSS) from `UserMenu`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `frontend-theme-system`: theme toggle control location changes from "inside the UserMenu popover"
  to "standalone command-bar icon" (documents the already-shipped F-082 behavior).
- `user-menu-popover`: no longer consolidates the theme toggle or accent color picker; scoped to
  session/identity controls (display name, Settings link, sign-out).
- `workspace-accent-color`: accent picker entry point moves from the UserMenu popover to the
  `/settings` page's new "Appearance" section.
- `settings-preferences-ui`: adds an "Appearance" section hosting the accent color picker, immediate-
  apply (no explicit Save), distinct from the existing explicit-Save "Preferences" section.

## Impact

- Frontend only: `UserMenu.tsx`/`.css`, `SettingsPage.tsx`, their tests, and the four specs above.
- No API/schema changes — accent color already persists via `updateUserPreferences`; only its UI
  entry point moves.

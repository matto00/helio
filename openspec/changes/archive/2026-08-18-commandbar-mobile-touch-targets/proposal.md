## Why

Live mobile testing (390×844) right after today's HEL-711/739/719/740/728/716/718 batch found two
regressions in `CommandBar.tsx`'s mobile layout: (1) the theme toggle was explicitly instructed to
move to Settings by the user, and HEL-728 shipped without doing so; (2) HEL-718's IconButton
migration applied the standard 44px mobile tap-target floor to the command bar's icon buttons, but
the 48px-tall command bar was never widened to frame them, so they now nearly fill the bar edge to
edge. Urgent hotfix, filed same-day.

## What Changes

- Remove the theme (light/dark) toggle icon from `CommandBar.tsx` entirely (desktop and mobile —
  one canonical control, not a mobile-only move) and add it to the Settings "Appearance" section
  (`SettingsPage.tsx`), next to the accent picker HEL-728 already put there. Same `toggleTheme`
  behavior, immediate-apply, no Save button — only the location changes.
- Update the stale F-082 "single canonical top-bar toggle" comment blocks in
  `UserMenu.tsx` (~lines 59-64, 150-159) to reflect that the toggle now lives in Settings.
- Increase `.app-command-bar`'s mobile (`<=768px`) height from the unconditional 48px to 64px
  (`var(--space-10)`, an existing token) so the 44px tap-target floor (`IconButton.css`) has real
  clearance instead of nearly filling the bar. Desktop is untouched (media-query-scoped).
- Re-measure crowding after the toggle removal (ticket's own instruction): with the toggle gone,
  mobile `__right` drops from up to 3 icon buttons to at most 2 ("Refine with AI", "Open assistant")
  plus the UserMenu trigger — the height bump alone is sufficient; no further layout restructuring.

## Capabilities

### New Capabilities

- `command-bar-touch-target-framing`: the command bar's own mobile height frames its 44px icon
  tap-targets with real clearance, instead of relying on the icon buttons' own floor alone (matches
  the narrow, single-purpose precedent of `modal-emptystate-touch-targets`/`shared-popover-touch-targets`).

### Modified Capabilities

- `frontend-theme-system`: the theme toggle's documented location changes from "a standalone icon
  button in the command bar" to "the Settings page's Appearance section."
- `user-menu-popover`: the "documented exception" language referencing the theme toggle's location
  ("command bar") updates to reflect its new home in Settings; it remains outside the popover
  either way — this is a location and cross-reference edit, not the removal of the exception.

## Impact

- `frontend/src/app/CommandBar.tsx` — remove theme `IconButton`, unused `faSun`/`faMoon`/`theme`/
  `toggleTheme` imports and usages.
- `frontend/src/app/App.css` — `.app-command-bar` mobile height.
- `frontend/src/features/settings/ui/SettingsPage.tsx` / `SettingsPage.css` — new theme-toggle
  control in the Appearance section.
- `frontend/src/features/auth/ui/UserMenu.tsx` — stale comment update only, no behavior change.
- `frontend/src/app/App.test.tsx` — the top-bar theme-toggle integration test moves to
  `SettingsPage.test.tsx`, where the control now lives (mirrors the accent-picker test pattern
  already there).
- No backend/API impact.

# Proposal: fix-legacy-divider-fallback

## Why

Legacy divider panels with no explicit `dividerColor` render an invisible line: the fallback in
`frontend/src/features/panels/ui/DividerPanel.tsx` is `var(--color-border)`, a CSS custom property that no longer
exists in the current theme system (`frontend/src/theme/theme.css`). The divider type was removed from creation in
HEL-249 but legacy panels remain renderable/editable, so any pre-existing dashboard with a colorless divider shows
nothing where a separator should be (HEL-298).

## What Changes

- Change the `DividerPanel` color fallback from the dead `var(--color-border)` to the live DESIGN.md border token
  `var(--app-border-subtle)` (the documented "default hairline" role, matching the shipping static-separator
  precedent `.app-command-bar__sep`), so colorless dividers render a visible neutral line in both themes.
- Update `DividerPanel.test.tsx`, which currently asserts the dead fallback value.
- Update the `divider-panel-type` spec, which codifies `--color-border` as the default color (requirement-level change).
- Repro-widening (session directive): a full sweep of `var(--*)` usage across `frontend/src` against defined theme
  tokens found **no other** dead theme-variable references — the remaining undefined-at-theme-level vars
  (`--dashboard-background-override`, `--panel-surface-override`, `--panel-text-override`,
  `--dashboard-grid-background-override`, `--mobile-panel-height`, `--toast-intent-color`) are all assigned at
  runtime by components. No additional fixes or spinoffs required; evidence recorded in design.md.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `divider-panel-type`: the default rule color when `dividerColor` is absent changes from the removed token
  `--color-border` to the live token `--app-border-subtle` (visible in both themes). All other divider behavior is
  unchanged.

## Non-goals

- No changes to divider PATCH/response contracts, backend, or schemas (`dividerColor` handling is untouched).
- No reintroduction of divider creation (HEL-249 stands).
- No theme-token additions or renames.

## Impact

- `frontend/src/features/panels/ui/DividerPanel.tsx` (one-line fallback change)
- `frontend/src/features/panels/ui/DividerPanel.test.tsx` (assertion update)
- `openspec/specs/divider-panel-type/spec.md` via delta (default-color requirement text)
- No API, backend, or dependency impact.

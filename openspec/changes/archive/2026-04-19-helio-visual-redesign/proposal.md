## Why

Helio's current UI is functional but indistinct — Inter everywhere, muted indigo/blue tokens, and a layout that reads as generic SaaS.
A visual redesign gives Helio a memorable identity that signals quality on first impression and differentiates it from commodity dashboard tools.

## What Changes

- **Design direction selection**: At least 3 directions prototyped (via the frontend-design skill), one winner chosen and documented
- **CSS design-token overhaul**: Replace current color, typography, spacing, and radius tokens in `theme.css` with the winning direction's system
- **Font upgrade**: Swap Inter for a distinctive pairing (display + body fonts) loaded via Google Fonts or Fontsource
- **App shell restyling**: Topbar, sidebar, nav links, and layout chrome updated to match the new aesthetic
- **Component restyling**: Buttons, inputs, cards (panels, dashboard list), modals, status elements
- **Dark + light themes**: Both themes updated consistently with new token values
- **Spec update**: `frontend-theme-system` spec updated to document the new token contract

## Capabilities

### New Capabilities

- `helio-visual-identity`: Defines the chosen visual direction — design tokens (color, typography, spacing), documented palette, font choices,
  and component aesthetic guidelines that constitute Helio's brand system

### Modified Capabilities

- `frontend-theme-system`: Token names may be extended/renamed; both theme variants updated with new values

## Impact

- `frontend/src/theme/theme.css` — primary token changes
- All component `.css` files that reference `--app-*` tokens — may need per-component aesthetic updates
- `frontend/src/app/App.css` — app shell layout and chrome
- `frontend/index.html` — font `<link>` additions
- No backend changes; no API contract changes; no schema changes

## Non-goals

- Navigation restructuring (sidebar redesign may follow as a dependent ticket per the ticket scope note)
- New feature development
- Responsive breakpoint changes
- Accessibility regression — existing a11y posture must be preserved

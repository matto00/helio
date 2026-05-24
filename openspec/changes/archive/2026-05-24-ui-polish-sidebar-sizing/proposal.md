## Why

After the design system rollout several small inconsistencies remain in the sidebar and list views: search inputs vary in height and font size, icon buttons differ across components, nav/eyebrow text uses raw values instead of design tokens, a dead CSS class adds noise, and panel action buttons have not been audited. Addressing these now keeps the UI coherent before v1.3.1 ships.

## What Changes

- Normalize all search/filter inputs to 28 px height and 0.75 rem font size (using `--text-xs` token)
- Audit and unify icon-button sizes across PanelList, DashboardList, and TypeRegistry to a consistent value
- Verify nav-link and eyebrow text sizing uses `--eyebrow-size` / correct token values; fix any raw values found
- Remove the dead `dashboard-list__collapse` CSS class (collapse button was moved to `App.tsx`)
- Review panel action button (three-dot menu) sizing and align to the established icon-button size

## Capabilities

### New Capabilities
<!-- None — this change is entirely CSS/style normalization within existing components -->

### Modified Capabilities
<!-- No spec-level requirement changes; all changes are implementation-level corrections to existing behaviour
     already covered by helio-design-tokens and frontend-dashboard-polish specs -->

## Impact

- Frontend CSS/SCSS files for: `DashboardList`, `PanelList`, `TypeRegistry`, sidebar nav, panel card action buttons
- No backend, API, or schema changes
- No new dependencies

## Non-goals

- No layout restructuring or new features
- No changes to the token definitions themselves in `theme.css`
- Not addressing any HEL-258, HEL-129, or HEL-259 scope items

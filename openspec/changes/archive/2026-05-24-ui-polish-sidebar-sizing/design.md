## Context

Post-design-system-rollout audit of sidebar and list UI. The existing CSS files use a mix of hardcoded pixel values (height, font-size) and design token vars. The `dashboard-list__collapse` block (DashboardList.css lines 30–58) is dead — the collapse button was moved to `App.tsx` / `App.css` where it lives as `.app-sidebar-collapse`. Icon button sizes across DashboardList, PanelList, and TypeRegistry are not verified to share a single agreed size. Filter inputs are sized with ad hoc values rather than the `--text-xs` token.

## Goals / Non-Goals

**Goals:**
- Audit and normalize filter/search input height to 28 px and font-size to `var(--text-xs)` (0.75 rem) in DashboardList.css, PanelList.css (if a filter input exists), and TypeRegistryBrowser.css
- Confirm icon-button sizes across DashboardList header actions, PanelList card action buttons, and TypeRegistry action buttons are consistent
- Verify `.app-sidebar__nav-link` and `.dashboard-list__eyebrow` font-size values reference tokens
- Remove the `dashboard-list__collapse` dead block from DashboardList.css
- Review panel card three-dot menu button sizing for consistency

**Non-Goals:**
- No layout restructuring
- No token value changes in theme.css
- No TypeScript / component logic changes

## Decisions

**Decision: Edit CSS only, no component changes**
All items on the checklist are presentational. Modifying `.css` files directly avoids unrelated React diffs and keeps the PR reviewable.

**Decision: Use `var(--text-xs)` for search input font-size**
`--text-xs` resolves to 0.75 rem per `theme.css`, matching the target. Hard-coding `0.75rem` would create drift risk.

**Decision: Icon button target size = 24 px**
`DashboardList` header action buttons and the `app-sidebar-collapse` button are both `24 × 24 px`. Align PanelList and TypeRegistry action buttons to the same value.

**Decision: Remove entire `dashboard-list__collapse` block**
Grep confirms no JSX references the class — safe to delete. Keeping it would require future maintainers to verify it is unused.

## Risks / Trade-offs

- [Removing dead CSS] → Zero risk; class is not rendered anywhere after the App.tsx collapse button migration.
- [Changing input height] → Slight visual change to filter inputs. Verified the 28 px target is already used in the App.css collapse button; 28 px feels intentional for the sidebar density.

## Planner Notes

Self-approved: all changes are CSS-only polish with no API/schema/behavioral impact. No escalation warranted.

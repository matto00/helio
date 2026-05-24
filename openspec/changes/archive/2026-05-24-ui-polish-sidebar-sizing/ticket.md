# HEL-128 — UI polish — sidebar sizing, icon consistency, and layout refinements

## Title
UI polish — sidebar sizing, icon consistency, and layout refinements

## Description
Several small UI inconsistencies remain after the design system rollout:

- Search/filter inputs across the app may still have inconsistent sizing — audit and normalize to 28px height, 0.75rem font
- Icon button sizes should be reviewed across PanelList, DashboardList, and TypeRegistry for consistency
- Nav link and eyebrow text sizing should be verified against the design token scale
- The `dashboard-list__collapse` CSS class can be cleaned up now that the collapse button moved to `App.tsx`
- Panel action buttons (three-dot menus in panel cards) sizing may need review

## Priority
Medium

## Project
Helio v1.3.1 — Polish & Hardening

## Acceptance Criteria
- All search/filter inputs are normalized to 28px height, 0.75rem font size
- Icon buttons are consistent in size across PanelList, DashboardList, and TypeRegistry
- Nav link and eyebrow text sizing uses correct design token values
- The dead `dashboard-list__collapse` CSS class is removed
- Panel action button (three-dot menu) sizing is reviewed and consistent

## URL
https://linear.app/helioapp/issue/HEL-128/ui-polish-sidebar-sizing-icon-consistency-and-layout-refinements

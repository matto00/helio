# mobile-viewer-stack — Delta (fix-mobile-silent-edit-drop / HEL-304)

## ADDED Requirements

### Requirement: Panel-field edits staged below the sm boundary persist without any layout write
Panel title/appearance edits staged while the mobile stack is rendered MUST persist via the panel batch endpoint
(`updatePanelsBatch`) exactly as at desktop width (container width below 768px,
`panelGridConfig.breakpoints.sm`). The stack's structural layout guarantee is unchanged: no code path reachable while the stack is
mounted may dispatch `updateDashboardLayout` or `setLayoutPending`, and browsing on mobile MUST never issue a
dashboard-layout PATCH (the stored `xs` layout stays byte-identical, per HEL-301).

#### Scenario: Modal appearance save at phone width persists
- **GIVEN** a dashboard rendered as the mobile stack (container width below 768px)
- **WHEN** the user saves an appearance edit in the panel detail modal and the auto-save flush fires
- **THEN** a panel batch update request is issued containing the staged appearance
- **AND** no `PATCH /api/dashboards/:id` request is issued

#### Scenario: Mobile browsing issues zero layout PATCHes
- **WHEN** the user scrolls the stack, opens/closes panel detail modals, switches dashboards, or the container
  width changes while below 768px
- **THEN** no `PATCH /api/dashboards/:id` (layout) request is issued at any point
- **AND** the dashboard's stored `xs` layout remains byte-identical

#### Scenario: Pure resize across the 768px boundary never PATCHes layout
- **GIVEN** the user has made no layout edit
- **WHEN** the container width crosses the 768px boundary in either direction (shell swap)
- **THEN** no `PATCH /api/dashboards/:id` (layout) request is issued

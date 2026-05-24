## ADDED Requirements

### Requirement: Sidebar search inputs use token-based sizing
Sidebar filter/search inputs (DashboardList, PanelList, TypeRegistry) SHALL have a height of 28 px and font-size of `var(--text-xs)` (0.75 rem).

#### Scenario: Filter input height and font-size are normalized
- **WHEN** the sidebar renders a search or filter input
- **THEN** the input SHALL have a computed height of 28 px and font-size of 0.75 rem

### Requirement: Icon buttons are consistently sized across sidebar list components
Icon-action buttons in DashboardList header actions, PanelList card action buttons, and TypeRegistry action buttons SHALL be consistently sized (24 × 24 px).

#### Scenario: DashboardList header action buttons are 24x24
- **WHEN** the DashboardList header renders action buttons (add, etc.)
- **THEN** each icon button SHALL be 24 px wide and 24 px tall

#### Scenario: PanelList card action buttons are 24x24
- **WHEN** a panel card renders its action (three-dot menu) button
- **THEN** that button SHALL be 24 px wide and 24 px tall

### Requirement: Dead dashboard-list__collapse class is removed
The `dashboard-list__collapse` CSS class SHALL NOT exist in DashboardList.css, as the collapse button was moved to App.tsx.

#### Scenario: Collapse class is absent from DashboardList stylesheet
- **WHEN** DashboardList.css is loaded
- **THEN** no CSS rule for `.dashboard-list__collapse` SHALL be present

### Requirement: Nav-link and eyebrow text use design token values
The `.app-sidebar__nav-link` and any eyebrow labels in the sidebar SHALL use design token values for font-size rather than hardcoded pixel or rem values.

#### Scenario: Nav-link font-size references a token
- **WHEN** the sidebar renders navigation links
- **THEN** the nav-link font-size SHALL be expressed as a CSS custom property reference (e.g., `var(--text-xs)` or `var(--eyebrow-size)`)

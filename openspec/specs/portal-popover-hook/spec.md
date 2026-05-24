# portal-popover-hook Specification

## Purpose
TBD - created by archiving change portal-popover-hook. Update Purpose after archive.
## Requirements
### Requirement: usePortalPopover hook encapsulates trigger ref and position state
The `usePortalPopover` hook SHALL export a trigger ref, open/close state, panel position, and
an open handler so that popover components can share the portal/positioning pattern without
duplicating inline logic.

#### Scenario: Hook provides trigger ref and position on open
- **WHEN** a component calls `usePortalPopover` and the returned `handleOpen` is invoked
- **THEN** `isOpen` becomes true and `panelPos` is populated from the trigger element's
  `getBoundingClientRect()`

#### Scenario: Hook close resets state
- **WHEN** the returned `close` function is called
- **THEN** `isOpen` becomes false

### Requirement: All popover components use usePortalPopover
All popover components (`ActionsMenu`, `DashboardAppearanceEditor`, `UserMenu`, `Select`) SHALL
use `usePortalPopover` and MUST NOT duplicate trigger-ref and position-state logic inline.

#### Scenario: ActionsMenu uses hook
- **WHEN** ActionsMenu renders its popover
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: DashboardAppearanceEditor uses hook
- **WHEN** DashboardAppearanceEditor renders its popover
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: Select uses hook
- **WHEN** Select renders its dropdown panel
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: UserMenu uses hook
- **WHEN** UserMenu renders its menu popover
- **THEN** it uses the shared hook for open/close and position state


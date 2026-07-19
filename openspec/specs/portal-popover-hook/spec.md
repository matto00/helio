# portal-popover-hook Specification

## Purpose
TBD - created by archiving change portal-popover-hook. Update Purpose after archive.
## Requirements
### Requirement: usePortalPopover hook encapsulates trigger ref and position state
The `usePortalPopover` hook SHALL export a trigger ref, open/close state, panel position, and
an open handler so that popover components can share the portal/positioning pattern without
duplicating inline logic. A popover portalled into a modal `<dialog>` SHALL align to its trigger:
modal dialogs that host portalled popovers MUST NOT leave a lingering `transform` (or other
containing-block-establishing property) after their entrance animation, so that the popover's
`position: fixed` coordinates resolve against the viewport rather than being displaced by the
dialog's origin.

#### Scenario: Hook provides trigger ref and position on open
- **WHEN** a component calls `usePortalPopover` and the returned `handleOpen` is invoked
- **THEN** `isOpen` becomes true and `panelPos` is populated from the trigger element's
  `getBoundingClientRect()`

#### Scenario: Hook close resets state
- **WHEN** the returned `close` function is called
- **THEN** `isOpen` becomes false

#### Scenario: Popover portalled into a modal dialog aligns to its trigger
- **WHEN** a `Select` popover is opened inside an animated modal `<dialog>` (e.g. the panel-creation
  modal) and is portalled into that dialog
- **THEN** the panel aligns to its trigger — its top edge sits just below the trigger's bottom edge
  and its left edge matches the trigger's left edge — because the dialog's entrance animation leaves
  no lingering containing-block `transform` at rest

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


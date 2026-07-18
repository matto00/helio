## ADDED Requirements

### Requirement: Staged layout changes survive desktop grid unmount

A layout change staged on desktop (drag or resize completed, PATCH not yet flushed) MUST be persisted
when the desktop grid unmounts — including when the viewport shrinks below the `sm` (768px) boundary
within the auto-save window, when the user switches dashboards, and when the user navigates away. The
unmount flush MUST NOT introduce any layout-write path reachable from the mobile stack: a boundary
crossing with no staged desktop change MUST dispatch no layout PATCH, and the HEL-301 guarantee that
mobile browsing never PATCHes dashboard layout MUST continue to hold.

#### Scenario: Shrink below 768px mid-edit flushes the staged layout

- **GIVEN** a dashboard rendered on desktop with a layout change staged within the auto-save window
- **WHEN** the container width crosses below the `sm` boundary and the desktop grid unmounts
- **THEN** exactly one layout PATCH is dispatched carrying the staged layout
- **AND** a later reload (or restore to desktop) shows the staged arrangement

#### Scenario: Browse-only boundary crossing dispatches nothing

- **GIVEN** a dashboard rendered on desktop with no staged layout change
- **WHEN** the container width crosses below the `sm` boundary
- **THEN** no layout PATCH is dispatched by the unmount path

#### Scenario: Rapid repeated boundary crossings do not duplicate the flush

- **GIVEN** a layout change staged on desktop
- **WHEN** the container width rapidly crosses the `sm` boundary multiple times (down, up, down)
- **THEN** the staged layout is persisted exactly once
- **AND** no layout PATCH originates while the mobile stack is mounted

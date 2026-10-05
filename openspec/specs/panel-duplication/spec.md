## Purpose
Defines panel duplication: the backend duplicate endpoint, the frontend duplicate action on panel cards, and placement of the duplicated panel using the default layout resolution logic.

## Requirements

### Requirement: Duplicate panel endpoint
The system SHALL expose `POST /api/panels/:id/duplicate` that creates a new panel copying the source panel's `dashboardId`, `title`, and `appearance`. The new panel SHALL receive a new UUID and a fresh `createdAt`/`lastUpdated` timestamp. The endpoint SHALL return `201 Created` with the new panel body.

#### Scenario: Successful duplication
- **WHEN** a `POST /api/panels/:id/duplicate` request is made for an existing panel
- **THEN** the system creates a new panel with the same `dashboardId`, `title`, and `appearance` as the source
- **AND** returns `201 Created` with the new panel's full representation including its new `id`

#### Scenario: Source panel not found
- **WHEN** a `POST /api/panels/:id/duplicate` request is made for a non-existent panel ID
- **THEN** the system returns `404 Not Found`

### Requirement: Duplicate action on panel card
The system SHALL provide a duplicate button on each panel card in the grid. Activating it SHALL trigger the duplicate endpoint and append the result to the panel list immediately upon success. The button SHALL be guarded against re-entry: while a duplicate request for a given panel is in flight, further activations of that panel's duplicate button SHALL be ignored, and the guard SHALL clear when the request settles (success or failure), re-enabling the button.

#### Scenario: Duplicate button triggers server-side copy
- **WHEN** the user clicks the duplicate button on a panel card
- **THEN** the system calls `POST /api/panels/:id/duplicate`
- **AND** the duplicated panel appears in the dashboard grid without a full page reload

#### Scenario: Original panel is unchanged after duplication
- **WHEN** duplication succeeds
- **THEN** the source panel's title, appearance, and position in the grid are unchanged

#### Scenario: Double-activation while a duplicate request is in flight produces exactly one clone
- **WHEN** the user clicks a panel card's duplicate button twice in rapid succession (including two synchronous activations in the same event-loop tick) before the first request settles
- **THEN** the system calls `POST /api/panels/:id/duplicate` exactly once
- **AND** exactly one new panel is created

#### Scenario: Duplicate button re-enables after the request settles
- **WHEN** a duplicate request for a panel completes, whether successfully or with an error
- **THEN** the duplicate button for that panel is enabled again and a subsequent click issues a new request

### Requirement: Duplicated panel layout placement
The system SHALL store a layout item for the duplicated panel at every breakpoint when it is duplicated. Each item SHALL
use the create-time placement rule: `x = 0`, below the breakpoint's existing items.

The item's size at each breakpoint SHALL be the first of these that applies:
1. The source panel's stored item size at that breakpoint, with the width clamped to the breakpoint's column count.
2. The source's `lg` item scaled to that breakpoint: width `clamp(round(lgW * cols / 12), 1, cols)`, same height.
3. The create-time default size for the source's kind at that breakpoint. This applies when the source has no stored
   item in any breakpoint.

The duplicate response SHALL carry `layouts` with the stored item per breakpoint, and the web client SHALL adopt them
without marking the layout as unsaved.

#### Scenario: Duplicate placed at next available position
- **WHEN** a panel is duplicated
- **THEN** the stored layout holds an item for the new panel in every breakpoint, below the existing items, overlapping
  no existing item

#### Scenario: Duplicate keeps the source size
- **WHEN** a panel stored at `w = 6, h = 4` in `lg` is duplicated
- **THEN** the duplicate's stored `lg` item has `w = 6, h = 4`

#### Scenario: Source missing an item at one breakpoint
- **WHEN** a panel stored at `w = 6, h = 4` in `lg` but with no item in `sm` is duplicated
- **THEN** the duplicate's stored `sm` item has `w = 3, h = 4`

#### Scenario: Source orphaned at every breakpoint
- **WHEN** a `text` panel with no stored item in any breakpoint is duplicated
- **THEN** the duplicate's stored items are `w 4 h 5` at `lg`, `w 4 h 5` at `md`, `w 3 h 5` at `sm` and `w 2 h 5` at
  `xs`

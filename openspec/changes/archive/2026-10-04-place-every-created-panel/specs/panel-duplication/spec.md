## MODIFIED Requirements

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

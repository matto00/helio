## ADDED Requirements

### Requirement: Auto-layout stores no item for a panel that is not on the dashboard
Auto-layout SHALL restrict the stored layout it keeps and writes back to the dashboard's current panels, in every
breakpoint, before packing, so it never stores a layout item for a panel that is no longer on the dashboard.

#### Scenario: A stored ghost does not survive auto-layout
- **WHEN** a dashboard's stored layout holds an item for a deleted panel and auto-layout runs on it
- **THEN** the stored layout afterwards has no item for that panel in any breakpoint, and the ghost did not offset
  the packed items

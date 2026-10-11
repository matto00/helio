## ADDED Requirements

### Requirement: Dashboard-update preview drops ghost layout items like apply
Previewing a dashboard `update` edit SHALL restrict both the stored layout and every supplied layout breakpoint to the
dashboard's current panels before resolving and validating the layout, exactly as applying the same edit does, so the
preview's `after` never shows a layout item that apply would drop.

#### Scenario: A stored ghost is absent from the preview
- **WHEN** a dashboard's stored layout holds an item for a panel no longer on the dashboard and an appearance-only
  update of that dashboard is previewed
- **THEN** the preview's `after.layout` contains no item for that panel, matching apply's `resultingState`

#### Scenario: A supplied ghost item is dropped, not validated
- **WHEN** a previewed dashboard update supplies a breakpoint containing an item for a panel not on the dashboard,
  overlapping a live item
- **THEN** the preview succeeds and its `after.layout` omits that item, as apply would

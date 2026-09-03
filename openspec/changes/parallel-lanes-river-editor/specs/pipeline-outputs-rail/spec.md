## ADDED Requirements

### Requirement: The Output "off <step>" subtitle names the lane
Where an Output is described by the step it hangs off — the Outputs gallery tab and per-Output thumbnails —
the description SHALL include the lane the step belongs to when that step is not in the primary lane, as a
`›`-separated path (for example `off filter › lane 2 › aggregate`).

#### Scenario: An Output on a non-primary lane
- **WHEN** an Output hangs off an `aggregate` step in the second lane below a `filter` step
- **THEN** its subtitle reads `off filter › lane 2 › aggregate`

#### Scenario: An Output on the primary lane
- **WHEN** an Output hangs off a step in the primary lane
- **THEN** its subtitle names the step without a lane segment

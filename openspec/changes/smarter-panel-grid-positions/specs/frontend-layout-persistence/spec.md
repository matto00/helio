## MODIFIED Requirements

### Requirement: Layout persistence remains robust as panels change
The frontend MUST safely reconcile saved layouts with the currently loaded panel collection. Panels missing from the saved layout MUST receive smart-computed positions (left-to-right, row-wrapping) rather than naive sequential-index positions.

#### Scenario: Saved layout is incomplete or stale
- **GIVEN** a dashboard layout is missing entries for some panels or includes removed panel ids
- **WHEN** the dashboard panels are rendered
- **THEN** stale panel ids are ignored
- **AND** missing panel entries receive smart-computed fallback positions that fill available horizontal space before starting a new row
- **AND** the resulting layout remains renderable across supported breakpoints

#### Scenario: New panel added to a dashboard with existing panels
- **GIVEN** a dashboard has at least one panel with a saved layout position
- **WHEN** a new panel is created and the panel list is refreshed
- **THEN** the new panel receives a fallback position in the first available horizontal slot adjacent to existing panels
- **AND** it does not stack at x=0, y=0 on top of or below an existing panel at that position

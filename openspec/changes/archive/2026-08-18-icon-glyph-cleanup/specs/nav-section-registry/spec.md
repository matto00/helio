## ADDED Requirements

### Requirement: Registry icons are visually distinct at collapsed-rail size
Adjacent primary-nav registry entries SHALL use icons that are visually distinguishable from one
another when rendered at the collapsed icon-rail size (16px). The Assistant entry's icon SHALL NOT
be a near-identical glyph to the Data Types entry's icon, and the Metrics entry's icon SHALL read
clearly as a metrics/chart glyph rather than a clock/history glyph.

#### Scenario: Assistant and Data Types icons are distinguishable in the collapsed rail
- **WHEN** the sidebar nav rail renders in its collapsed (icon-only) state
- **THEN** the Assistant entry's icon and the Data Types entry's icon are visually distinct glyphs,
  not near-identical rounded-rectangle variants

#### Scenario: Metrics icon reads as a metrics/chart glyph
- **WHEN** the sidebar nav rail or `BottomNav` renders the Metrics entry
- **THEN** its icon is a chart/column-style glyph rather than a gauge/clock-style glyph

# timeline-panel-type Specification

## Purpose
Defines the `timeline` panel kind: its config shape (`dataTypeId`, `fieldMapping`, `timelineOptions.sort`), persistence contract (existing binding columns plus a `timeline_options` JSONB column), tolerant defaults, PATCH absent-vs-null semantics, duplication/export parity, and inclusion in every panel-`type` contract surface (JSON Schema, MCP tools).

## Requirements

### Requirement: Timeline appears in every panel-type contract surface

Every contract surface that enumerates panel `type` values SHALL include `timeline`, matching the
backend `PanelType` canonical set. This covers the JSON Schema (`schemas/panels/panel.schema.json` panel
`type` enum plus a `TimelineConfig` `$def`) and the helio-mcp `create_panel` / `bind_panel` tool
type enums, so agent-driven dashboards can create and bind timeline panels.

#### Scenario: JSON Schema enumerates timeline

- **WHEN** `schemas/panels/panel.schema.json` is inspected
- **THEN** the panel `type` enum includes `"timeline"` and a `TimelineConfig` definition describes
  its config shape

#### Scenario: MCP tools accept timeline

- **WHEN** the helio-mcp `create_panel` and `bind_panel` tool type enums are inspected
- **THEN** both include `"timeline"` so a timeline panel can be created and bound via MCP

## Why

Helio can chart a value *over time* but cannot render a **chronological sequence of discrete events** —
an "X at T₁, then Y at T₂" narrative. The helio-news aggregator reconstructs story chronologies from
article text and today can only fake them as prose or a bar chart. A first-class `timeline` panel gives
event-driven dashboards a real, ordered event view.

## What Changes

- Add `timeline` as a new panel kind end-to-end (backend ADT, wire codec, persistence, JSON Schema,
  frontend types, renderer, config editor, creation picker), following the v1.5 Panel System v2 pattern
  and the `collection` (HEL-247) precedent.
- The panel binds to a multi-row DataType via the existing `dataTypeId` / `fieldMapping` surface, with
  two field slots: a `time` (time/order) field and an `event` (text) field. Timeline-specific options
  (chronological `sort` direction) persist in a new nullable `timeline_options` JSONB column.
- Render a vertical, chronological timeline (marker + connector + time + description per entry) that
  scales proportionally with panel size and degrades gracefully for empty / single-row / long-text data.
- Add `timeline` to the panel-creation type picker (icon + one-line description) and to the helio-mcp
  `create_panel` / `bind_panel` tool enums (stretch AC).

## Capabilities

### New Capabilities
- `timeline-panel-type`: the `timeline` panel kind — config shape (`dataTypeId`, `fieldMapping`,
  `timelineOptions.sort`), persistence contract (existing binding columns + new `timeline_options`
  JSONB), tolerant defaults, PATCH absent-vs-null semantics, duplication/export parity, and inclusion
  in every panel-`type` contract surface (JSON Schema enum, MCP tool enums).
- `timeline-panel-rendering`: the vertical chronological timeline rendering (marker/connector/time/
  description per entry), the configurable `time` + `event` field mapping in the panel config editor,
  size-proportional scaling, and graceful degradation for empty / single-row / long-description data.

### Modified Capabilities
- `panel-type-picker-cards`: add the `timeline` type card (icon + one-line description) to the creatable
  panel-type set.

## Impact

- Backend: new `domain/panels/TimelinePanel.scala`; `Panel` registry, `PanelConfigCodec`,
  `PanelProtocol`, `PanelRowMapper`, the parallel `PanelType` sealed trait (`domain/model.scala`), the
  two `PanelServiceHelpers` `CreateConfig` match sites (`buildNewPanel`, `dataTypeIdFromCreateConfig` —
  the V41 binding guard), and a new Flyway migration (`timeline_options` JSONB column).
- Frontend: `types/panel.ts`, `panelNarrowing`, `panelPayloads`, `panelSlots`, `PanelContent`,
  `PanelDetailModal`, `PanelCreationPreview`, `mobilePanelHeights`, `TypeSelectStep`; new
  `renderers/TimelineRenderer` and `editors/TimelineEditor`.
- Contract: `schemas/panel.schema.json` (enum + `TimelineConfig` def); helio-mcp `create_panel` /
  `bind_panel` tool enums.

## Non-goals

- No new aggregation/pipeline op — the timeline binds to whatever `(time, event)` rows a pipeline
  already produces; producing that shape is the pipeline's concern.
- No per-event styling, grouping, icons, or interactivity beyond marker/connector/time/description.
- No new authenticated data-fetch endpoint — reuses the existing panel row-snapshot binding path.

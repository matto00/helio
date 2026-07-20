## Context

Panel kinds are a sealed ADT: each subtype has a `domain/panels/<Kind>Panel.scala` (config +
panel + companion with a `Kind` string and wire codec), registered in `Panel.Registry` and dispatched
through `PanelConfigCodec` (encode / `decodeCreateConfig` / `applyConfigPatch`). Persistence flows
through `PanelRowMapper`; binding reuses the shared `type_id` / `field_mapping` columns, and
subtype-specific options live in dedicated nullable JSONB columns (`chart_options` V56,
`collection_options` V57). Two additional backend surfaces gate a new kind before the codec runs: a
*second*, independent `PanelType` sealed trait in `domain/model.scala` (checked by
`PanelServiceHelpers.validatePanelType` at the top of `PanelService.create`, and by
`DashboardServiceValidation.validatePanelEntries` on import), and two `CreateConfig` match sites in
`PanelServiceHelpers` (`buildNewPanel`, `dataTypeIdFromCreateConfig`). The frontend mirrors this in `types/panel.ts` (discriminated union +
`emptyConfigForKind`), with per-kind renderers (`renderers/*Renderer.tsx`), editors
(`editors/*Editor.tsx`), binding slots (`panelSlots.ts`), narrowing helpers (`panelNarrowing.ts`),
and the creation picker (`creationSteps/TypeSelectStep.tsx`). The `collection` panel (HEL-247) is the
closest precedent: bound to a multi-row DataType, one row per rendered unit, options in a JSONB column.

## Goals / Non-Goals

**Goals:**
- Add `timeline` as a full panel kind following the `collection` precedent exactly, so every contract
  surface (schema enum, MCP tool enums, picker) enumerates it.
- Bind to a multi-row DataType via `dataTypeId` + `fieldMapping` with two slots (`time`, `event`) and a
  single timeline option (`sort`), rendering a vertical chronological event list that scales with size.

**Non-Goals:**
- No new pipeline op or aggregation; no per-event styling/icons/interactivity; no new fetch endpoint.

## Decisions

- **Binding shape mirrors `collection`.** Reuse `dataTypeId` + `fieldMapping` for the binding; store the
  timeline-only `sort` under a new nullable `timeline_options` JSONB column (Flyway `V58`), decoded
  tolerantly (default `sort: "asc"`) with a strict create-path that rejects an invalid `sort` enum via
  `deserializationError`. Rationale: matches `CollectionPanelConfig`/V57 precedent one-for-one, so the
  mapper, codec, patch (absent-vs-null), duplication, and export paths all extend by analogy rather than
  invention. Alternative (store `sort` inside `fieldMapping`) rejected — `fieldMapping` is reserved for
  data-column bindings, not display options.
- **Register the kind on every backend gate, not just the codec/registry.** A new bound kind must be
  added to the parallel `PanelType` sealed trait (`domain/model.scala`) — else `POST /api/panels` 400s
  at `validatePanelType` before the codec runs, and dashboard import (`DashboardServiceValidation`)
  rejects it — and to both `PanelServiceHelpers.buildNewPanel` (else `MatchError`) and
  `dataTypeIdFromCreateConfig`. The latter is a **binding-safety requirement, not wiring**: it feeds
  `rejectCompanionBinding`, the V41 pipeline-only-binding guard. Omitting timeline there silently lets a
  source-companion DataType bind to a timeline panel — the exact bug class HEL-316 closed for
  Text/Markdown. All three are covered by grepping the `collection` literal across `backend/src`.
- **Two field slots `time` + `event`.** `PANEL_SLOTS.timeline = [time, event]`, both bound columns
  (unlike `collection`, which derives slots from its base type). The renderer reads
  `fieldMapping.time` / `fieldMapping.event` per row. Rationale: the ticket's `(when, event)` shape maps
  cleanly to two named slots the existing `FieldMappingSlots` editor already supports.
- **Rendering: dedicated `TimelineRenderer` + CSS, container-query scaled.** Follow
  `CollectionRenderer` (own `.tsx` + `.css`, size-proportional via the panel container-query pattern).
  Sort rows client-side by the `time` column per `sort`; render marker + connector + time + description
  per entry; suppress the trailing connector on the last entry (single-row degrades cleanly); wrap/clamp
  long descriptions in CSS. Empty snapshot → the shared panel empty-state.
- **MCP + schema parity (stretch AC).** Widen `schemas/panel.schema.json` `type` enum + add
  `TimelineConfig`; add `"timeline"` to the helio-mcp `create_panel` / `bind_panel` zod enums and their
  fieldMapping help text (`time`/`event` slots). Cheap enum edits — included rather than deferred.

## Risks / Trade-offs

- **`time` column may be a string, number, or ISO timestamp.** → Sort comparator handles both numeric
  and lexical/ISO ordering (ISO-8601 sorts correctly lexically); document that non-ISO free-text times
  sort lexically. No parsing/normalization is attempted — consistent with "the pipeline produces the
  shape".
- **New JSONB column touches every panel read/write mapper path.** → Mirror the V57 `collection_options`
  wiring exactly (nullable, NULL = defaults, tolerant decode) so no existing panel row is affected;
  covered by the malformed/legacy decode scenario.
- **Contract-surface drift** (a `type` enum missed somewhere → 400s). → The spec's "every contract
  surface" requirement enumerates them (schema, MCP); grep for the `collection` literal as the checklist
  of touch points.

## Planner Notes

- Self-approved (no ESCALATION): net-new panel kind within the v1.5 Panel System v2 project, no new
  external dependency, no breaking API change — additive enum widening only. Follows an established,
  recently-exercised pattern (HEL-247).
- Stretch MCP AC included in scope because it is a low-cost enum/description edit given schema parity.
- Migration is additive and reversible (drop the nullable `timeline_options` column); no data backfill.

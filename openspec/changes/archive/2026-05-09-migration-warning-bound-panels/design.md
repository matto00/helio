## Context

After HEL-210, panels fetch data exclusively through `GET /api/panels/:id/query`. The query endpoint
resolves `typeId → DataType → DataSource` server-side. However, DataTypes that were created from a
DataSource directly (pre-v1.3) still have a non-null `sourceId`. Panels bound to these "legacy"
DataTypes need a visible migration prompt so users know to re-attach via a pipeline.

The frontend already holds DataType state in `dataTypesSlice.items` (loaded before the dashboard
renders). `Panel.typeId` combined with the DataTypes slice is sufficient to identify legacy bindings
purely client-side — no new API endpoint or backend change is needed.

## Goals / Non-Goals

**Goals:**
- Surface an inline warning banner on any panel card whose bound DataType has `sourceId != null`.
- Keep the panel body rendering its existing data unchanged.
- Zero backend changes.

**Non-Goals:**
- Automatic migration of legacy panels.
- Persisting dismissed state.
- Blocking panel interactions or data fetch.

## Decisions

**Decision: Pure frontend detection via `dataTypesSlice`.**
The `dataTypesSlice.items` array is populated at dashboard load by `fetchDataTypes`. Every DataType
has `sourceId: string | null`. Cross-referencing `panel.typeId` → `dataType.sourceId != null`
gives an exact "legacy-bound" signal without any backend change. Alternative: add a `legacyBound`
flag to the panels API response — rejected because it couples backend to a UI concern and requires
schema/migration changes.

**Decision: Render the warning inside `PanelCardBody` (not `PanelGrid`).**
`PanelCardBody` already receives `panel` and is the composition boundary for panel-level
rendering. Adding a conditional banner there isolates the change to one small component without
touching the layout-managing `PanelGrid` loop. The banner renders above `PanelContent`.

**Decision: `useLegacyBoundPanels` selector hook (not inline logic).**
Centralising the "is legacy bound?" check in a named hook (`useLegacyBoundPanel`) keeps
`PanelCardBody` presentational and makes the logic testable in isolation. The hook reads
`state.dataTypes.items` and receives the panel as a parameter.

**Decision: Warning is informational, not dismissible.**
No persistence layer exists for per-panel UI state. Dismissal would require either Redux state
(lost on refresh) or a new backend field. Informational-only satisfies the acceptance criteria
without this complexity.

## Risks / Trade-offs

[Risk] `dataTypesSlice` not yet loaded when panels render → stale selector returns `false`,
warning never appears. Mitigation: `dataTypesSlice` is fetched in the dashboard view before panels
are shown; this is the existing pattern for the DataType picker in the panel creation modal.

[Risk] A DataType can have `sourceId` set even when used through a pipeline (if the pipeline
was created from that source). Mitigation: The intent is to flag DataTypes not backed by any
pipeline output. Per ticket scope, `sourceId != null` is the agreed legacy signal for this sprint;
a pipeline-aware check is a follow-up if needed.

## Planner Notes

Self-approved: frontend-only change, no API contract modification, no schema changes required.
The warning banner will reuse the existing `InlineError` CSS token system for consistent styling,
but will use a distinct warning colour (amber/yellow) rather than the error red.

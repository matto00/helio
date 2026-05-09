## Why

Helio v1.3 replaced direct DataSource→Panel binding with the Pipeline-first model. Panels created
before this migration still reference DataTypes that have a non-null `sourceId` (created from a
DataSource, not a Pipeline output). These "legacy-bound" panels silently continue to query via the
old path with no prompt to migrate — users need an inline signal so they know to re-attach via a
pipeline.

## What Changes

- **New**: `useLegacyBoundPanels` hook (or inline selector) — detects panels whose `typeId` resolves
  to a DataType with a non-null `sourceId`, marking them as "legacy-bound".
- **New**: Inline migration warning banner rendered inside each legacy-bound panel card in
  `PanelGrid`, overlaying the panel body above the content area.
- **Non-breaking**: Legacy panels continue to fetch and display their last known data normally; the
  warning is additive.

## Capabilities

### New Capabilities

- `panel-legacy-binding-warning`: Inline warning banner shown on panels whose bound DataType was
  seeded directly from a DataSource (pre-v1.3). Prompts user to attach a pipeline. Panel data
  continues to render underneath.

### Modified Capabilities

- `panel-bound-data-fetch`: Add a note that legacy-bound panels (typeId → DataType with sourceId)
  display a migration warning; data fetch behavior is unchanged.

## Impact

- Frontend only — no backend changes required. Detection is purely client-side: `panel.typeId` →
  look up DataType in `dataTypesSlice` → check `sourceId != null`.
- `dataTypesSlice` must be loaded before PanelGrid renders (already guaranteed by the dashboard
  view).
- No schema changes needed.
- No new endpoints.

## Non-goals

- Automatic migration of legacy panels (out of scope for this ticket).
- Blocking panel usage when the warning is shown.
- Persisting "dismissed" state across sessions (banner is informational only).

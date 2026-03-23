## Context

HEL-46 added `typeId`, `fieldMapping`, and `refreshInterval` to the backend panel model and PATCH endpoint. HEL-42/43/44 built the TypeRegistry and schema inference. The frontend has no knowledge of DataTypes and the panel modal Data tab is a placeholder. This change wires them together.

## Goals / Non-Goals

**Goals:**
- DataType list fetched from `GET /api/datatypes` and cached in Redux
- Panel Data tab: searchable DataType selector, per-type field mapping slots, refresh interval selector
- `PATCH /api/panels/:id` called on Save with `typeId`, `fieldMapping`, `refreshInterval`
- Dirty-state tracking unified across both tabs (Appearance + Data)

**Non-Goals:**
- Actual data polling/refresh execution (interval stored only)
- Query/filter builder (deferred)
- DataType create/manage UI (belongs in HEL-47 data sources page)
- Backend changes (already complete from HEL-46)

## Decisions

### DataType fetch strategy: lazy, cached in Redux
Fetch DataTypes when the Data tab is first opened, cache in `dataTypesSlice`. Re-fetching only if status is `idle`. This avoids blocking the modal open and avoids redundant requests across panel opens.

Alternative: fetch on app load. Rejected — DataTypes are only needed in the Data tab and the list could be long.

### Field slot definitions: static config per PanelType
A `panelSlots.ts` module exports a `Record<PanelType, Array<{key, label}>>` constant. The modal reads this to render mapping dropdowns. This keeps slot definitions co-located, easy to extend, and avoids backend round-trips.

Slots:
- `metric`: `value` (Value), `label` (Label), `unit` (Unit)
- `chart`: `xAxis` (X Axis), `yAxis` (Y Axis), `series` (Series)
- `table`: `columns` (Columns)
- `text`: `content` (Content)

### Searchable dropdown: controlled input + filtered list
A plain `<input>` + filtered `<ul>` of DataType options. No external library. This keeps the bundle clean and matches the project's minimal-dependency pattern.

### Dirty state: unified across tabs
The modal tracks `dataDirty` (typeId/fieldMapping/refreshInterval) alongside the existing `isDirty` (appearance). Either being dirty triggers the discard warning on close.

### refreshInterval storage: seconds as number | null
`null` = manual (no polling). Options rendered as a `<select>`: Manual, 30s, 1m, 5m, 15m, 1h.

## Risks / Trade-offs

- [Stale DataType list] If a DataType is created in another tab while the modal is open, the dropdown won't show it → Mitigation: a "Refresh" affordance can be added later; acceptable for now.
- [Panel model drift] If the backend adds new binding fields, the frontend type will lag → Mitigation: TypeScript types are co-located and easy to update.

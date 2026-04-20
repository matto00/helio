## Context

`PanelAppearance` is a Scala case class (`background`, `color`, `transparency`) serialized to JSON and stored in a string column (`appearance`) in the `panels` table. The frontend `PanelAppearance` interface mirrors this. `ChartPanel.tsx` renders an ECharts instance with a static default option and no connection to the panel appearance object. `PanelDetailModal.tsx` has an Appearance tab with background/color/transparency controls.

## Goals / Non-Goals

**Goals:**
- Extend `PanelAppearance` (both backend case class and frontend interface) with an optional `chart` sub-object holding series colors, legend config, tooltip config, and axis label config
- Backend serializes/deserializes the new fields transparently (JSON blob column — no migration)
- `ChartPanel` receives `appearance` as a prop and translates `appearance.chart` into ECharts options for live preview
- `PanelDetailModal` Appearance tab gains a Chart section (only shown for `panel.type === "chart"`) with the new controls
- `panel-appearance.schema.json` is extended with the optional `chart` property

**Non-Goals:**
- Per-series individual color assignment
- Tooltip format/template string
- Any new backend routes or DB migrations

## Decisions

**1. Optional `chart` field, not a required sub-object.**
Existing panels have no `chart` key in their stored JSON. Adding it as optional (`chart?: ChartAppearance`) means the backend reads it with `getOrElse` defaults and the frontend applies defaults when absent. No breaking change and no data migration.

**2. Live preview by passing `appearance` as a prop to `ChartPanel`.**
`ChartPanel` is currently a zero-prop component. The modal manages local draft state for appearance fields. The simplest live-preview approach: pass the draft `appearance` object (including chart sub-fields) as a prop so ECharts re-renders on every state change. `PanelContent.tsx` and `PanelGrid` pass the saved `panel.appearance` normally; the modal passes the draft.

**3. Extend `updatePanelAppearance` thunk payload to include `chart`.**
The existing thunk already sends `background`, `color`, `transparency`. Merging `chart` into the same payload keeps one PATCH call and one `handleAppearanceSubmit` path.

**4. Schema: `additionalProperties: false` must be relaxed to allow `chart`.**
`panel-appearance.schema.json` currently has `additionalProperties: false`. Add `chart` as an optional property with its own nested schema object.

**5. Color palette: array of hex strings, max 8 entries.**
Simple and matches ECharts' `color` top-level option. The UI renders 8 swatches with a `<input type="color">` for each.

## Risks / Trade-offs

- [Risk] `ChartPanel` rendered in the grid also receives `panel.appearance` (from Redux store); adding a prop changes its signature. → Mitigation: make `appearance` an optional prop with a fallback to `PanelAppearance.Default`-equivalent defaults so grid-rendered charts continue to work without change.
- [Risk] Schema `additionalProperties: false` is strict — existing snapshot/import payloads may omit `chart`. → Mitigation: `chart` is optional in the schema and the backend uses `getOrElse` defaults.

## Planner Notes

Self-approved: this is a contained extension of an existing pattern (appearance JSON blob). No new external dependencies. No breaking API changes. No auth or security concerns.

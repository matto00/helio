## Why

The Divider panel type is low-value, clutters the panel-type picker (7 cards for a
dashboard builder whose narrative is data-bound panels), and doesn't fit the
data-bound-panel direction of v1.5 Panel System v2. HEL-249 removes it from the
creation surface while preserving existing dashboards that already contain one.

## What Changes

- Remove `divider` from the panel-type picker (`TypeSelectStep`) and from the
  step-3 type-specific config fields (`NameEntryStep` / `DividerCreatorFields`,
  which becomes dead code and is deleted).
- Remove the `divider` key from `PANEL_TEMPLATES`; `PANEL_TEMPLATES` becomes a
  partial map since not every `PanelType` is creatable anymore.
- Remove `DividerTypeConfig` (the creation-time type-config variant) from
  `types/panel.ts` and its member from the `TypeConfig` union.
- **Preserve, unchanged:** `DividerPanel`/`DividerPanelConfig` (the persisted
  wire type), `DividerRenderer`/`DividerPanel.tsx` (grid rendering),
  `DividerEditor` (detail-modal editing of orientation/weight/color), and all
  backend divider support (`DividerPanel.scala`, `dividerOrientation` /
  `dividerWeight` / `dividerColor` DB columns, `PATCH /api/panels/:id`,
  `POST /api/dashboards/apply-proposal` divider-orientation support). Existing
  divider panels keep rendering and remain editable; no migration is run.
- Backend and the AI dashboard-proposal path are **not** given new validation to
  reject `type: "divider"` — that would risk breaking dashboard
  duplication/export-import of dashboards that already contain a divider panel,
  which route through the same create path. The backend is documented (not
  code-changed) as legacy-only for divider: no human UI surfaces it, but the
  wire contract still accepts it for compatibility.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-type-picker-cards`: type picker enumerates six creatable types
  (metric, chart, text, table, markdown, image) instead of seven; divider is
  dropped from the "all types have descriptions" scenario.
- `panel-type-selector`: "all available type options" no longer includes
  divider.
- `panel-creation-modal`: the "no type SHALL be hidden" requirement is
  narrowed to "all creatable panel types" (six), and divider is dropped from
  the non-data-bound-types illustrative lists.
- `panel-creation-type-config`: the "Divider panel shows orientation selector"
  and "Divider orientation submitted with creation" scenarios are removed
  (step 3 no longer offers divider config since divider isn't selectable in
  step 1).
- `divider-panel-type`: add a requirement documenting that divider is
  legacy-only — not offered in the interactive panel-type picker, but still a
  valid persisted/PATCH-able/proposal-creatable type for back-compat.

## Impact

- Frontend: `TypeSelectStep.tsx`, `NameEntryStep.tsx`, `PanelCreationModal.tsx`,
  `panelTemplates.ts`, `types/panel.ts`; deletes `DividerCreatorFields.tsx`.
  Associated tests updated/removed for the deleted creation-time path.
- Backend: no code changes. `DividerPanel.scala`, `PanelRowMapper.scala`,
  `RequestValidation.scala`, `DashboardProposalService.scala` continue to
  support `divider` as documented legacy behavior.
- Specs: five capability deltas (four modified UI specs + one addition to
  `divider-panel-type`), no schema/API contract changes.

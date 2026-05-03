## Why

Dashboards need visual structure beyond data panels. A divider panel provides a horizontal or
vertical rule that separates logical sections, making complex dashboards easier to scan. It is
purely cosmetic — no data binding, no content, no queries.

## What Changes

- Add `"divider"` as a valid panel type in the backend enum, Flyway migration, and API validation.
- Add `dividerOrientation` (`"horizontal" | "vertical"`) and `dividerWeight` (integer, pixels),
  and `dividerColor` (string, CSS color) fields to the panel resource.
- `PATCH /api/panels/:id` accepts and persists `dividerOrientation`, `dividerWeight`,
  and `dividerColor`.
- Frontend renders a divider panel as a styled `<hr>` or `<div>` rule inside the panel body.
- Frontend panel-type selector exposes "Divider" as a choice.
- Frontend panel settings sidebar shows orientation, weight, and color controls when type is divider.

## Capabilities

### New Capabilities
- `divider-panel-type`: Rendering, configuration, and persistence for the divider panel type.

### Modified Capabilities
- `panel-type-field`: Add `"divider"` to the valid panel type enum and panel response fields.

## Impact

- Backend: `PanelRepository`, `ApiRoutes`, `JsonProtocols`, new Flyway migration for divider columns.
- Frontend: `panelsSlice`, `PanelRenderer`, `PanelTypeSelector`, panel settings sidebar component.
- Schemas: `panel.json` updated with `dividerOrientation`, `dividerWeight`, `dividerColor` fields.

## Non-goals

- No data binding or content rendering for the divider — purely visual.
- No animation or interactive behavior.
- No per-breakpoint orientation switching.

## Why

Panels currently have no type field, making them indistinguishable in the data model and UI. This is the foundational prerequisite for the panel type system (HEL-22–24): without a persisted `type`, downstream tickets cannot route rendering, selectors, or data bindings per panel type.

## What Changes

- New `type` enum column on the `panels` table (`metric | chart | text | table`, default `metric`) via Flyway migration
- `Panel` domain model gains a `panelType: PanelType` field
- `POST /api/panels` accepts optional `type` (defaults to `metric`)
- `PATCH /api/panels/:id` accepts optional `type` for updating
- All panel API responses include `type`
- `panel.schema.json` and `create-panel-request.schema.json` updated with `type` field
- Frontend `Panel` interface, `panelService`, and `panelsSlice` updated to carry `type`
- Demo seed data assigned sensible default types

## Capabilities

### New Capabilities

- `panel-type-field`: Panel resources carry a `type` field (`metric | chart | text | table`) that is persisted, readable, and writable via the API.

### Modified Capabilities

- `frontend-panel-creation`: Panel creation flow now accepts an optional `type` parameter (defaults to `metric`).

## Impact

- **Backend**: `model.scala`, `PanelRepository.scala`, `JsonProtocols.scala`, `ApiRoutes.scala`, `DemoData.scala`, new Flyway migration `V3__panel_type.sql`
- **Frontend**: `types/models.ts`, `services/panelService.ts`, `features/panels/panelsSlice.ts`
- **Schemas**: `schemas/panel.schema.json`, `schemas/create-panel-request.schema.json`
- **No breaking changes**: `type` defaults to `metric` for all existing panels; existing requests without `type` remain valid

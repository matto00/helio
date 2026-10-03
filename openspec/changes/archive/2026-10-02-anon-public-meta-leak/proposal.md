## Why

HEL-1197 removed `ownerId` from anonymous responses on `GET /api/dashboards/:id/panels`, but the same response still carries `meta.createdBy`, which `PanelService` sets to the creating user's id (the owner). An anonymous or share-link caller can therefore still learn the owner's internal user id. The owner ruling for public provenance is: names are allowed, but never ids, config, errorLog or ownerId.

## What Changes

- `ResourceMetaResponse.createdBy` becomes optional on the wire (omitted, not null, when absent) and `PanelResponse.fromDomain` only fills it for a caller who is the panel's owner.
- The panel-list route in `PublicDashboardRoutes` derives one "caller is the panel owner" decision per panel from `userOpt` and applies it to both `ownerId` and `meta.createdBy` (replacing the HEL-1197 `userOpt.isDefined` test, which still exposed the owner id to an authenticated NON-owner holding a share link).
- Audit of every route mounted under `optionalAuthenticate` (`PublicDashboardRoutes`: panel list, rows, filter-capabilities, distinct-values, output-meta, provenance; `PublicUploadRoutes`; `ConnectorCompletionRoutes`) plus `/health`, for any value equal to an owner id; any further leak found is removed in this change.
- Contracts: `schemas/shared/resource-meta.schema.json` (`createdBy` no longer required), `resource-metadata` spec delta, `frontend/src/types/models.ts` and `helio-mcp/src/types.ts` `createdBy` types optional (nothing reads it in the frontend).
- Tests: per-route field-by-field absence on serialized JSON, and a generic guard that walks each public response for the owner's id.

## Capabilities

### Modified Capabilities
- `resource-metadata`: `meta.createdBy` is omitted for non-owner callers of the public panel list.
- `public-dashboards`: public panel-list responses never carry an owner-id-equivalent field for a non-owner caller.

## Impact

Backend: `ResourceProtocol.scala`, `PanelProtocol.scala`, `PublicDashboardRoutes.scala`, tests. Frontend: `types/models.ts` (type only). Authenticated non-public routes (dashboards, outputs, panels CRUD) are unchanged. No migration.

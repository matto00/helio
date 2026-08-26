## Why

The audit store (HEL-471/477/483) is fully populated but has no read surface — the only way to inspect audit rows today is a raw DB query. HEL-435's chain is worthless as a security/compliance feature until a user can actually see what happened on their own account.

## What Changes

- New authenticated `GET /api/audit-events` route: paginated (`Page`/`PagedResult` convention), owner-scoped (RLS via `withUserContext`, caller's own id — never a client-supplied filter), with optional `resourceType`, `resourceId`, `action`, `source`, `from`/`to` (time range) filters.
- New `AuditEventRepository` query method (paginated, filtered, RLS-scoped) alongside the existing `findByActor`/`findByResource`.
- `JsonProtocols` response formatter + `schemas/` JSON Schema + `openspec/` spec for the audit event response shape, per the API-contract convention.
- Minimal read-only frontend: Redux slice + `createAsyncThunk`, presentational table (DESIGN.md tokens), reachable from the settings/account area. No mutation controls. Human-readable action/resource/actor/source/timestamp — `source=mcp` is never rendered as distinguishable from `pat` (HEL-483: MCP calls are recorded as `pat`, since no reliable signal distinguishes them).

## Capabilities

### New Capabilities
- `audit-query-api`: authenticated, owner-scoped, paginated/filtered read endpoint over `audit_events`.
- `audit-events-ui`: minimal read-only frontend surface for a user's own audit history.

### Modified Capabilities
(none — `audit-event-persistence` already documents the append-only store and its RLS posture; this change adds a read surface on top without changing that capability's own requirements)

## Non-goals

- Cross-user/admin audit views (no admin role exists).
- Export of audit data (separate Data Retention ticket).
- Alerting on audit events.
- Fixing known unaudited gaps (`WorkspaceTeardownService.teardown`, `DataSourceService`/`SourceService.refresh`, OAuth first-time signup) — explicitly deferred, not this ticket's scope.

## Impact

- Backend: `ApiRoutes` (new route), `AuditEventRepository` (new query method), `JsonProtocols`, new `schemas/audit-event*.json`.
- Frontend: new Redux slice, service method, table component, route/nav entry under settings/account.
- No migration — reads only, existing V91 schema and RLS policy are sufficient.

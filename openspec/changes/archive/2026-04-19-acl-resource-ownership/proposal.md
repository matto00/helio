## Why

Dashboards and panels currently have no owner — any authenticated user can read or modify any resource. Adding ownership enforces data isolation between users, which is a prerequisite for multi-tenant use.

## What Changes

- Add `owner_id` (FK → `users.id`) column to `dashboards` and `panels` tables via Flyway migration
- `POST /api/dashboards` and `POST /api/panels` set `owner_id` from the authenticated user extracted from the session token
- `GET /api/dashboards` filters to only return the calling user's dashboards
- `GET /api/dashboards/:id/panels` verifies the dashboard belongs to the caller
- All `PATCH`, `DELETE`, and duplication routes verify ownership and return `403 Forbidden` on mismatch
- Demo/seed data assigns all existing resources to the seeded system user

## Capabilities

### New Capabilities

- `resource-ownership`: DB schema additions (`owner_id` on dashboards + panels), ownership enforcement middleware/logic, and 403 responses for cross-user access

### Modified Capabilities

- `backend-persistence`: `dashboards` and `panels` tables gain a new non-nullable `owner_id` column; seed data must set it
- `request-authentication`: The authenticated user identity (resolved from token) must be threaded through to repository calls so ownership can be assigned and checked

## Impact

- `DashboardRepository` and `PanelRepository` — queries gain `owner_id` filter/insert
- `ApiRoutes.scala` — ownership check before mutating or returning any resource
- Flyway migration — new `V6__add_owner_id.sql` (or next available version)
- `DemoData` — seed dashboards and panels reference the system user's ID
- No frontend changes required (403s are surfaced as existing error handling)

## Non-goals

- Sharing resources with other users (separate ticket)
- Admin bypass or role-based access beyond basic ownership
- Panel-level ownership independent from dashboard ownership

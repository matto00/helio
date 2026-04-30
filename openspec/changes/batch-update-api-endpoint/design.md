## Context

The previous HEL-155 implementation used a `POST /api/dashboards/:id/batch` envelope with a typed-ops
array (`{ op, payload }[]`). This was replaced at the request of the product owner with three
resource-oriented endpoints:

- `PATCH /api/dashboards/:id/update` — partial dashboard field update
- `POST /api/panels/updateBatch` — multi-panel update (any fields)
- `PATCH /api/users/me/update` — user preference update (noop for now, returns 204)

The branch already has the old batch implementation committed. All old batch code must be removed.

## Goals / Non-Goals

**Goals:**
- Clean resource-oriented API that does not couple panel mutations to a dashboard id path parameter
- `panels/updateBatch` unifies panel layout and panel appearance into one endpoint (no op-type split)
- Scaffold `users/update` so the frontend can call it without backend work blocking frontend development
- Remove all old batch code from backend, frontend, and schemas

**Non-Goals:**
- Cross-endpoint transactions (each call is independent)
- Persisting user preferences to a DB table (no `user_preferences` table yet)
- Eliminating the panel refetch after create/duplicate (separate ticket)

## Decisions

### D1: `PATCH /api/dashboards/:id/update` path segment

The extra `/update` segment disambiguates from the existing `PATCH /api/dashboards/:id` which already
handles layout + appearance. Rather than repurpose the existing route, a new sub-path is added to
keep the old route intact for any in-flight callers and avoid a breaking change in the PR.

The old `PATCH /api/dashboards/:id` route continues to exist unchanged. The new `/update` variant is
the target for the redesigned flush paths.

### D2: `POST /api/panels/updateBatch` (not PATCH /api/panels)

`PATCH /api/panels` (collection patch) is unconventional REST. `POST /api/panels/updateBatch` is an
action resource, which is idiomatic for batch mutations and clearly signals "not a create". It also
avoids colliding with `POST /api/panels` (single panel creation).

### D3: `fields` envelope on all three endpoints

Each request carries a `fields` array that names exactly which fields to touch. This prevents
accidental overwrites when only one field was intended to change and is consistent with the existing
`PATCH /api/panels/:id` semantics (which accept any subset of panel fields). It also leaves a clear
extension path for future versioning.

### D4: `users/me/update` returns 204 No Content

No `user_preferences` table exists. The route is scaffolded to accept the payload, validate its
shape, and return `204 No Content`. The authenticated user identity is derived from the session
token — no `:id` path parameter needed. This unblocks frontend development without database work.

### D5: Schema approach — per-endpoint schemas replacing batch schemas

`schemas/batch-request.schema.json` and `schemas/batch-response.schema.json` are replaced with three
new per-endpoint schemas:
- `schemas/update-dashboard-request.schema.json`
- `schemas/update-panels-batch-request.schema.json`
- `schemas/update-panels-batch-response.schema.json`

This mirrors the rest of the schemas directory (one schema per endpoint shape) and is cleaner than
keeping a now-inaccurate "batch" name.

## Risks / Trade-offs

- **Two round-trips for mixed mutations** → Accepted trade-off; the product owner explicitly approved
  calling 2 endpoints when dashboard fields and panel fields change simultaneously (which is uncommon).
- **Old batch route left in place on branch** → The old `PATCH /api/dashboards/:id` route is
  unchanged; the new `/update` sub-routes are additive. Old code calling the original PATCH still works.

## Migration Plan

1. Remove old batch route + JSON codecs + repository method from backend
2. Remove old batch thunk + service from frontend
3. Add three new backend routes + codecs
4. Add new frontend thunks + services
5. Update `PanelGrid.tsx` layout flush to call `PATCH /api/dashboards/:id/update` (layout is a dashboard-level attribute)
6. Replace batch schemas with per-endpoint schemas
7. All in one commit

## Planner Notes

- Redesign is a drop-in on the existing branch; all prior batch commits are already present.
  Executor must remove the old code first, then layer in the new endpoints.
- `users/update` noop means no DB migration needed.

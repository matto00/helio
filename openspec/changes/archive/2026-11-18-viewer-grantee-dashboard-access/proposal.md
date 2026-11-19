## Why

HEL-1773 stage 1 proved (commit 206a72d00, `e2e/hel1773-viewer-grantee-dashboard.spec.ts`) that a dashboard grantee gets "Dashboard not found" in the signed-in app: `GET /api/dashboards` is owner-only, and `DashboardRoute` treats any id outside that list as not found. The same holds for editor grantees. The owner ruled (ticket.md, "Owner rulings"): grantees open shared dashboards in the shell, listed with a "Shared" marker, read-only for viewers, editors in scope, delivered as child tickets. This change is child 1.

## What Changes

- `GET /api/dashboards?include=shared` (opt-in; the web app passes it) lists owned + named-grant dashboards with a new `accessRole` field (`owner` | `editor` | `viewer`). Without the parameter the route is unchanged, so helio-mcp, PAT callers and the assistant/search stay owner-only. Public-only grants are never listed. In the app, default landing and onboarding use owned dashboards only. `DashboardRepository.findAllVisible` (dead, unpaged) is replaced by a paged equivalent used by the list route only. The workspace assistant/search callers of `DashboardService.findAll` stay owner-only (a separate product question, drafted as a child).
- `schemas/dashboards/dashboard.schema.json` gains optional `accessRole`; the list always sets it.
- Client: `Dashboard` carries `accessRole`; list/sidebar items for non-owned dashboards show a "Shared" marker; `DashboardRoute` opens any listed dashboard (no change needed beyond the list).
- Client: a single `canEditDashboard`/`isDashboardOwner` selector derived from `accessRole` gates the shell's editing affordances for viewers and owner-only actions for editors.
- Client: for a non-owned dashboard, panel rows (and the Output meta needed to render them) are read through the per-panel routes (`/api/dashboards/:id/panels/:p/rows`, `/output-meta`), never `/api/outputs/*` or `/api/pipelines/*` (which RLS refuses to dashboard-only grantees in prod). Every other Output/pipeline-route consumer (freshness line, run-refresh SSE, data-invalid badge, filter/sort, cross-filter, history, insight, provenance, Output links, warm cache) is hidden for non-owners; form submit and the Ask entry are hidden for non-owners.
- The stage-1 e2e turns green and is extended (viewer, editor, owner, stranger; Output-panel data; zero `/api/outputs/*` requests for non-owners).

## Capabilities

### New Capabilities

- `dashboard-grantee-access`: how a named dashboard grantee (editor/viewer) lists, opens, and views/edits a shared dashboard in the signed-in app.

### Modified Capabilities

## Impact

- Backend: `DashboardRepository`, `DashboardService`, `DashboardRoutes`, `DashboardProtocol` (+ specs).
- helio-mcp: `DashboardResponse` type gains optional `accessRole`; behaviour unchanged (it does not pass `include=shared`).
- Contract: `schemas/dashboards/dashboard.schema.json`.
- Frontend: `features/dashboards` (types, slice, sidebar/list item, selectors), `app/` chrome (`DashboardMetaRow`, `CommandBar`, `App.tsx` gating), `features/panels` (data thunks/hooks, card header/menus, layout editing).
- e2e: `e2e/hel1773-viewer-grantee-dashboard.spec.ts`. No migration expected (if one becomes necessary it is V147).

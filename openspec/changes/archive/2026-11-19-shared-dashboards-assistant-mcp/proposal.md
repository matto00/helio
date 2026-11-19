## Why

The owner ruled (HEL-1785) that the in-app assistant, its workspace search, and helio-mcp include dashboards shared
with the user, with the user's role, read-only for viewers. HEL-1773 made the web app's lists grant-aware via the opt-in
`GET /api/dashboards?include=shared`; every other surface still reads owned dashboards only.

## What Changes

- `WorkspaceContextService.assemble` and `WorkspaceSearchService.find` list owned dashboards plus dashboards held through
  a named `editor`/`viewer` grant, each entry carrying `accessRole`. `getResource(dashboard)` reads a dashboard the caller
  owns or holds a named grant on (public-only stays not found) and returns its role.
- `GET /api/workspace/context` dashboard entries gain `accessRole` (schema updated).
- The assistant's system prompt states the role rules; the server refuses any patch-set edit a viewer attempts on a
  shared dashboard, and an editor's dashboard delete, with a named, role-specific message (no proposal is captured).
- helio-mcp `list_dashboards` and `get_workspace_context` pass `include=shared`; `get_dashboard` serves a viewer's
  dashboard through the grant-aware `GET /api/dashboards/:id/panels` (the export route refuses viewers). Write tools on
  a viewer's dashboard surface the server's refusal as a clean tool error.
- The assistant's search, context and dashboard detail expose a shared dashboard's panels' ids, titles, kinds and
  bound Output ids only; no Output rows, columns or pipeline ids. helio-mcp `get_dashboard` returns what the app's panel
  list returns to the same grantee (the dashboard grant's own surface). `/api/outputs/*` reads of a shared dashboard's
  Output stay refused for a dashboard-only grantee in prod (RLS), proven as the NOBYPASSRLS app role.

## Non-goals

- New assistant/MCP tools that read Output rows of a shared dashboard (the existing Ask endpoint covers questions).
- Share, duplicate, folder move through the assistant or MCP (no such tool exists today).
- Editing `PublicDashboardRoutes` or per-panel resolvers (sibling HEL-1780); deploying helio-mcp (owner step).

## Capabilities

### New Capabilities

### Modified Capabilities
- `dashboard-grantee-access`: adds requirements for the assistant, workspace search, workspace context and helio-mcp.

## Impact

Backend `services/workspace`, `services/dashboards`, `services/patchsets` resolvers, `services/assistant`
system prompt, `schemas/workspace/workspace-context.schema.json`, helio-mcp `helioApi.ts`, `context.ts`, `tools/read.ts`,
`types.ts`. No migration. helio-mcp reaches the hosted connector only via `deploy-mcp.sh` (owner step).

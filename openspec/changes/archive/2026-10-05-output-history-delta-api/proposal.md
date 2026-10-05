## Why

L1 (HEL-1271) records a summary of every real run per Output, but nothing reads it. The metric delta, sparkline, MCP
history tool (L4) and dashboard UI (L5) all need one read API that resolves an Output's chosen comparison exactly per
owner ruling D6, and a validated `config.compare` (D2) to resolve against.

## What Changes

- `GET /api/outputs/:id/history?limit=&since=`: the Output's recent history points (newest first), plus the
  comparison resolution `{current, baseline, delta, pct, availableFrom, sparkline[]}` for the Output's
  `config.compare`. Sharing-aware: owner and grantees read it, while a non-grantee and an unknown id both get the same 404.
- `GET /api/dashboards/:dashboardId/panels/:panelId/history?limit=&since=&token=`: the public, allow-listed variant,
  gated like the other public panel routes. It returns the summary only, with no run ids, trigger sources or
  internal ids.
- `config.compare` validation on every Output config write path: `previous_run | 1d | 7d | 30d | custom:<ISO-8601
  duration>`, or absent/null. Anything else is rejected with 400.
- New response schemas in `schemas/outputs/`, plus `compare` documented on the create/update request schemas.

## Capabilities

### New Capabilities
- `output-history-api`: the authenticated and public history read endpoints, and the D6 compare resolution.

### Modified Capabilities
- `output-routes-api`: adds a requirement that Output config writes validate `config.compare`.

## Non-goals

- No UI (L5), MCP tool (L4), retention scheduling (L2) or alert baselines (L8).
- No migration and no new history queries. L1's `listRecent`/`nearestAtOrBefore`/`earliest` are reused as-is.
- No full-row payloads (L6). Public responses never carry them either way.
- No per-request `compare` override. The comparison is the Output's stored `config.compare` (D2).

## Impact

- Backend: `OutputRoutes`, `OutputService` (validation), a new `OutputHistoryService`, a new pure `OutputCompare`
  parser, a new protocol file, `PublicDashboardRoutes`, small wiring hunks in `ApiRoutes`/`JsonProtocols`, and
  one validation call in `PipelineService`'s single-call create plus the patch-set preview projection.
- Schemas: `schemas/outputs/` (two new response schemas, two request-schema descriptions).
- No frontend change. No DB change.

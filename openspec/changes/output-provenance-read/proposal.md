## Why

"Click any number and see where it came from" (HEL-916 leaf 1) needs one read that joins
`panel -> output -> node -> pipeline -> source(s)` plus last-run freshness and check counts. The
pieces exist but are scattered (`GET /api/outputs/:id`, `/assertion-status`, `runs/latest`,
pipeline summary, the public `resolveDataAsOf`). The popover UI (HEL-1207) is blocked on this read.
The same change cleans the public wire: the anonymous panel list and `output-meta` emit the
internal `ownerId` (HEL-1197), and the `panel-data-freshness` spec describes a UI that no longer
ships (HEL-1177).

## What Changes

- New `GET /api/outputs/:id/provenance` (authenticated, sharing-aware ACL): source name+kind for
  every root feeding the output, pipeline id+name, node path (step kinds root to node), last
  non-dry run (status, completedAt, row count of the output's own node snapshot), and an
  extended assertion summary (passed/failed/warn counts plus explicit `defined` / `rootBound`
  flags).
- New `GET /api/dashboards/:dashboardId/panels/:panelId/provenance` (public/optional-auth), same
  `authorizeResourceWithSharing` + `resolvePanelOutput` gate as `output-meta`. Explicit allowlist:
  source and pipeline NAMES, source kind, node path step kinds, lastRunAt/status, row count, check
  counts. NO ids, source config/credentials, `errorLog`, assertion `observed` values, `ownerId`,
  or pipeline link.
- Fold in HEL-1197: stop emitting `ownerId` to anonymous callers on the public panel list
  (`PanelResponse.ownerId` becomes optional/omitted) and remove `ownerId` from
  `PublicOutputMetaResponse`. **BREAKING** for the public wire only; the frontend already
  reconstructs `ownerId: null`.
- HEL-1177: retire the stale frontend "Data as of" requirements of `panel-data-freshness`; keep a
  truthful requirement for the backend `dataAsOf` wire field. Correct the `PanelResponse.dataAsOf`
  doc comment.
- MCP: new `get_output_provenance` tool in helio-mcp (authenticated route), copy stating the
  backend's actual status codes, probed live.
- JSON schemas under `schemas/` updated in the same change. No migration.

## Capabilities

### New Capabilities
- `output-provenance`: authenticated and public provenance reads for an Output.

### Modified Capabilities
- `public-dashboards`: Output-metadata requirement drops `ownerId`; anonymous panel list omits
  `ownerId`; new public provenance requirement.
- `panel-data-freshness`: retire frontend indicator requirements; document wire-only `dataAsOf`.
- `mcp-output-tools`: add `get_output_provenance`.

## Impact

Backend: new `ProvenanceService`, routes in `OutputRoutes`/`PublicDashboardRoutes`, protocols in
`OutputProtocol`, `PanelProtocol`. Frontend: `PublicOutputMeta` wire type and panel type only.
helio-mcp: one tool + types. Schemas and docs.

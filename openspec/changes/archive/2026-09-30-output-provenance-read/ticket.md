# HEL-1206: Provenance read: GET /api/outputs/:id/provenance + public-dashboard variant (allow-listed)

## Description
Leaf 1 of HEL-916. One read that joins panel -> output -> node -> pipeline -> source(s), last run and check counts. Authenticated `GET /api/outputs/:id/provenance`; public `GET /api/dashboards/:dashboardId/panels/:panelId/provenance` behind the same gate as `output-meta`. Owner ruling: public provenance includes source and pipeline NAMES, freshness and check counts as an explicit allowlist: no ids, source config/credentials, errorLog, assertion observed values, ownerId, pipeline link. Fold in HEL-1197 (no ownerId to anonymous callers on public panel list and output-meta); resolve HEL-1177 (panel-data-freshness spec); schemas and openspec in same change; expose to MCP (decide tool vs field). State in design which row count and the query bound.

## Acceptance criteria
- One call returns the full chain for an output with (a) one root, (b) two roots via join, (c) a root-bound output. Tests for each.
- Public variant is red-first: returns none of the excluded fields, asserted field by field, including ownerId on the existing public routes (HEL-1197). Dashboard-membership and token checks match output-meta, with attack cases: another dashboard's panel, a missing or invalid token.
- No N+1: bounded number of queries, stated in design.

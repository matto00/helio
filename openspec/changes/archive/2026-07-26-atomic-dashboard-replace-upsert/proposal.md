## Why

`helio-news` rebuilds the same dashboards every morning via linear-scan-by-name
create/delete calls with no transactional boundary, so a mid-rebuild failure
leaves a half-empty board live, and repeated runs risk duplicate dashboards.
Helio has no server-side "replace this dashboard's panels atomically" or
"get-or-create by name" primitive, so every agentic rebuild client reinvents a
fragile version of both.

## What Changes

- New `PUT /api/dashboards/:id/contents` endpoint: replaces ALL of an existing
  dashboard's panels (+ optional per-panel layout) in one DB transaction.
  Validates every incoming panel (structure + V41 pipeline-only binding,
  RLS-owner-scoped) BEFORE any write, so a bad payload deletes/creates nothing
  and returns 400 naming the offending panel. Reuses `ProposalPanel`'s wire
  shape and construction logic (shared with apply-proposal) and the
  `DashboardSnapshotRepository.importSnapshot` transactional pattern.
- Extend `POST /api/dashboards` with an opt-in `ifExists: "return"` field:
  when set, an owner-scoped, case-insensitive name match returns the existing
  dashboard (200) instead of creating a duplicate; absent behaves exactly as
  today (backward compatible, no new failure mode). App-level check-then-
  insert — no schema change, no new DB constraint (see design.md D3 for why a
  hard uniqueness constraint was rejected: it would regress the already-
  shipped `duplicate`/rename paths, which allow same-owner name collisions by
  design).
- New MCP tool `replace_dashboard_contents` (+ `create_dashboard`'s `ifExists`
  passthrough) in `helio-mcp`, so `helio-news` can drop `ensure_dashboard`'s
  list-scan and `clear_dashboard_panels`'s per-panel delete loop.
- `schemas/` + `openspec/` contract updates for both endpoints.

## Capabilities

### New Capabilities

- `dashboard-contents-replace`: atomic, all-or-nothing replace of a dashboard's
  panel set (and per-panel layout) in a single transaction.
- `dashboard-get-or-create`: idempotent owner-scoped get-or-create-by-name for
  `POST /api/dashboards`, app-level check-then-insert (no schema change).

### Modified Capabilities

(none — both are additive surfaces; no existing spec's requirements change)

## Non-goals

- Replacing/deleting data sources, pipelines, or DataTypes (HEL-366).
- Diff/patch-merge of panels preserving old ids (HEL-368) — full replace only.
- Scheduling rebuilds (HEL-340).
- Optimistic concurrency / versioned writes for overlapping replace-contents
  calls — last-committing writer wins; documented, not engineered around.

## Impact

Backend: new route file, new repository transaction method, no migration
needed, one small `DashboardProposalService`/`PanelService` refactor to share
panel construction without inserting. Frontend: none (agent-only surface).
MCP: `helio-mcp/src/{helioApi.ts,tools/write.ts}`. Contracts: `schemas/`,
`openspec/`.

# HEL-363: Add idempotent dashboard rebuild: atomic replace-contents / named-resource upsert

## Context

`helio-news` rebuilds the same boards every morning. Because Helio has no upsert or atomic "replace dashboard contents" primitive, `news/run.py` + `news/helio_client.py` implement a fragile create-fresh/delete-old dance by name:

* `HelioClient.ensure_dashboard(name)` lists all dashboards and linear-scans for a matching `name` before falling back to `create_dashboard` — there is no "get or create by name."
* `HelioClient.clear_dashboard_panels()` fetches the dashboard, iterates every panel, and issues one `delete_panel` per panel to empty a board before rebuild.
* `apply_plan()` clears every board, deletes shared sources/types, then rebuilds — a multi-second, many-call, non-atomic window in which the live dashboard is half-empty. Any failure mid-rebuild leaves a broken board visible.

This is the create-fresh/delete-old-by-name-prefix pattern the epic calls out. We want a single server-side transaction that swaps a dashboard's panels (and optionally its layout/appearance) atomically, plus a get-or-create-by-name affordance so agents stop linear-scanning.

## Scope

* **Atomic replace-contents endpoint** — e.g. `PUT /api/dashboards/:id/contents` (or `POST /api/dashboards/:id/replace-panels`) that, in one DB transaction, deletes the dashboard's existing panels and creates the supplied new panel set + layout, returning the rebuilt dashboard. Model it on the existing apply-proposal write path:
  * `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` and `backend/src/main/scala/com/helio/services/DashboardService.scala` (atomic multi-panel create already exists for import/apply-proposal — reuse the transactional creation used by `importSnapshot`).
  * New route in `backend/src/main/scala/com/helio/api/routes/` (mirror `DashboardProposalRoutes.scala`); wire into `ApiRoutes.scala`.
  * Reuse `DashboardSnapshotRepository`'s transactional panel-write logic where possible (it already creates a full panel set atomically on import).
* **Named-resource upsert / get-or-create** — an idempotent create-or-return path so a rebuild targets a stable dashboard without a client-side list scan. Either a `POST /api/dashboards` option (`{ name, ifExists: "return" }`) or a dedicated lookup `GET /api/dashboards?name=` the MCP can use. Prefer a server-side affordance over the client scan in `ensure_dashboard`.
* **MCP surface** — add a `replace_dashboard_contents` tool (and/or extend `create_dashboard`) in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts`, so the client can swap a board's panels in one call.
* Update `schemas/` (dashboard/snapshot shapes) and `openspec/` for any new endpoint contract.

## Acceptance criteria

- [ ] A single call replaces all panels on an existing dashboard with a supplied set, atomically: on any validation failure **no** panels are deleted or created (all-or-nothing), returning 400 with the offending panel identified.
- [ ] On success the endpoint returns the rebuilt dashboard + panels (same response shape as apply-proposal/import).
- [ ] The replace path enforces the same rules as create (V41 pipeline-only binding, RLS ownership) for every new panel.
- [ ] A get-or-create-by-name affordance returns the existing dashboard's id when one of that name exists for the owner, and creates otherwise — no duplicate dashboards created on repeated calls.
- [ ] The live dashboard is never observably empty mid-rebuild (old panels visible until the transaction commits the new set).
- [ ] ScalaTest coverage: atomic replace success, atomic rollback on one bad panel, get-or-create idempotency.
- [ ] MCP tool added and documented; `helio-news` could replace `ensure_dashboard` + `clear_dashboard_panels` + per-board rebuild with one call per board.

## Out of scope

* Deleting/replacing the underlying **data sources / pipelines / DataTypes** — that teardown is the resource-namespacing/bulk-teardown ticket (HEL-366). This ticket is dashboard/panel contents only.
* Diff/patch-merge of panels (matching old vs new by identity to preserve ids) — a full replace is acceptable for v1; smart reconciliation is a follow-on (HEL-368).
* Scheduling the rebuild (see HEL-340, the scheduled/auto-refresh epic).

## Dependencies

* Relates to the resource tagging / bulk-teardown ticket HEL-366 (they compose into a full idempotent rebuild).
* Relates to snapshot-id-consistency ticket (both touch the snapshot/import write path).
* No hard blockers; benefits from HEL-362 (partial appearance PATCH, already shipped — PR #297) but does not require it.

## Backward compatibility

Purely additive — new endpoint(s) and an opt-in create flag. Existing `create_dashboard` / import / apply-proposal paths are unchanged, so helio-news' current create-fresh flow keeps working until it migrates.

## Sibling scope discipline (from orchestrator brief)

Sibling tickets HEL-370 (batch panel-create), HEL-364 (compound bound-panel op), HEL-366 (resource tagging + bulk teardown) and HEL-368 (panel id key reconciliation) are separately queued and delivered after this ticket. Do NOT absorb them — if the design naturally wants one, note the dependency and keep scope to this ticket.

## Design gate must settle (from orchestrator brief)

1. **Identity semantics** — Upsert-by-name requires deciding whether dashboard names are unique, and per what scope (per-owner? globally?). They are almost certainly NOT unique today. Either introduce a uniqueness constraint (migration + plan for existing duplicates) or key the upsert on something else (client-supplied stable key / external id). Central decision — justify explicitly.
2. **Atomicity boundary** — "Atomic replace-contents" implies a transaction spanning multiple panel deletes/creates. Be concrete about where that transaction lives (repository layer? service?) and what happens on partial failure.
3. **Multi-tenancy** — RLS + strict owner scoping. Any lookup-by-name MUST be owner-scoped — cross-tenant name collision leaking/clobbering another user's dashboard would be a security bug (precedent: cross-tenant ACL gap caught at design gate during HEL-384). Treat as first-class review item; test cross-user behavior explicitly.
4. **Concurrency** — Two overlapping rebuilds of the same dashboard: at minimum, name the behavior.

Also note: the strict `source → pipeline → type → panel` binding rule still holds; a replaced panel set must respect it.

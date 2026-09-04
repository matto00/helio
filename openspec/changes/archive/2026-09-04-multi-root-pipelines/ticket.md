# HEL-913: P2.3 — Multi-root pipelines: several source roots per pipeline, inline source per root

## Description

Row **P2.3** of HEL-903 (Epic — Pipelines and Outputs remodel). Spec *Concept model* ("multi-root arrives with Phase 2") and *Delivery order → Phase 2*, decisions 3, 4.

Today `pipelines.source_data_source_id` is a single FK, and `join`/`union`/`lookup` reach a second source only through their step config. With lanes (P2.1, shipped as HEL-911 / `a45e9881`) a pipeline can naturally begin from several sources, each its own lane.

**Scope was restated by an owner-approved ticket-drift escalation before any code was written.** This ticket is backend / engine / `schemas/` / MCP-facing only. `frontend/**` is OFF LIMITS: HEL-912 (P2.2) owns it in a parallel run, and HEL-912's own Out of scope disclaims multi-root editor work verbatim ("Multi-root roots in the editor (P2.3 adds them); MCP (P2.4)"). The editor bullet and the original AC5 were filed verbatim as **HEL-968 (P2.3b)**, blocked by both this ticket and HEL-912. That is deferred work, not dropped work — the editor half cannot be built until HEL-912's lane layout exists, and the backend root model is what actually gates HEL-914.

## Scope

* **Model:** replace `pipelines.source_data_source_id` with a `pipeline_roots` table (`pipeline_id, data_source_id, position`) — or an equivalent that keeps a single root as the common case cheap; migrate every existing pipeline to one root. Steps with `parent_step_id = NULL` gain a `root_id` (or `root_position`) so the engine knows which root frame they start from. Flyway (**V98**), `schemas/`, OpenSpec in the same change.
* **Engine:** the walk starts one lane per root; rejoin steps may consume lanes from different roots. Scheduling and freshness stay per pipeline (one run refreshes all roots and all Outputs atomically).
* **API + MCP:** `POST /api/pipelines` and `create_pipeline` accept `roots[]` (each `sourceId` or an inline source spec); `add_root` / `remove_root` routes and tools; `get_workspace_context` lists roots per pipeline. Removing a root deletes its lane and Outputs with the same placement-count warning as step deletion.
* **Contract (named deliverable):** state the multi-root model explicitly in `design.md` — root identity, whether root order is meaningful or incidental, what happens to a node path when a root is removed, and the multi-root node-path format. This **supersedes engine-contract item 11** in HEL-911's archived `design.md` (which pins the single-root literal `root` prefix, `root > s1 > s4`); the superseded item must carry a forward pointer so no reader follows the stale format. HEL-914 is planned directly from this statement and must not have to re-derive anything.
* **ACL:** every root's source must be readable by the caller (the HEL-384 union cross-tenant rule generalizes to roots); the picker never defaults to an unset id (the HEL-620 defect class must not recur, and HEL-950's empty-seed-id guard stays in force).
* **No deprecation.** The single-source read path goes away rather than surviving as a fallback. This is the standing product rule under which Types and Metrics were deleted wholesale and V97 cut `secondaryInput` over with no legacy read path. A fallback that never fires is untested code that changes behaviour silently the day it does. Any surface needing an exception is an escalation, not a local decision.

## Acceptance criteria

- [ ] Migration test: every existing pipeline has exactly one root after migration; row-for-row snapshot equality holds.
- [ ] Engine test: two roots joined by a lane-`join` produce the expected rows; removing a root removes its lane's Outputs and reports placements.
- [ ] ACL test: a root the caller cannot read is a 404 at write time; run never reads a source the owner cannot read.
- [ ] Route/MCP specs for `roots[]`, `add_root`, `remove_root`; `check:schemas` / `check:openspec` green.
- [ ] `design.md` states the multi-root contract (root identity, root ordering, node-path format, root removal) explicitly enough for HEL-914 to be planned from without re-deriving it; HEL-911's engine-contract item 11 is superseded with a forward pointer.

## Migration constraints (hard requirements, not preferences)

1. **RLS posture.** Flyway migrates as bare `helio`, which is **not** superuser and has **no** BYPASSRLS. Local dev, CI, and prod-dump replay all connect as **superuser** and mask the failure completely — this broke three consecutive production deploys (v0.7.8/9/10). If V98 touches an RLS-forced table, bracket it with `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY;` … `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` exactly as V94/V96/V97 do, restoring the FORCE posture immediately after. V96 and V97 both deployed cleanly with that pattern; copy it.
2. **Coverage by the right gate.** `FlywayNonSuperuserMigrationSpec` is the only test that exercises the non-superuser role. V98 must be covered by it, not only by superuser-connected tests. **A green local run proves nothing here.**
3. **Data rewrite proof.** Changing `sourceDataSourceId` from a single FK to a root set rewrites existing rows. Prove: every affected row is rewritten (count before, count after, zero remaining); idempotency (re-running is a no-op); and that a row the migration should not touch is **byte-identical** after. Verify against **real dump-shaped data**, not only hand-built fixtures — hand-built fixtures have repeatedly missed defects real ones caught.

## Out of scope

Connector-specific root kinds (v0.9 connectors plug into the same root model). The editor surface and the Playwright multi-root flow — HEL-968 (P2.3b). MCP proposals/grounding for branching — HEL-914 (P2.4), which this ticket gates.

## Dependencies

Blocked by P2.1 (HEL-911, merged as `a45e9881`). Blocks P2.4 (HEL-914).

## Skeptic Report - final gate (round 1, skeptic-final-1.md)
Reviewed HEAD e944bc20fd096718cc5e44b5ba5cbafe89674dbc

### What I verified (with evidence)
- Servers confirmed to serve this worktree (readlink /proc/<pid>/cwd for 6639 and 9546 -> HEL-1207/frontend, HEL-1207/backend).
- Desktop dark, authenticated chart panel: popover renders source, pipeline, step label ("Group & aggregate"), last run, rows, checks, Open pipeline. Visually cohesive with tokens (screenshot .playwright-mcp/sk1207-desk-chart-a.png).
- Read the full diff for provenanceCache.ts, useProvenance.ts, useDataInvalid.ts, ProvenanceTrigger.tsx, ProvenanceContent.tsx, PanelCard.tsx, PublicDashboardViewerPage.tsx.
- Staleness reproduced live (below). Did not re-walk phone/public/light paths: evaluator's claims there are unrefuted but the REFUTE below is independent of them.

### Verdict: REFUTE

### Change Requests
1. Provenance cache is never invalidated, so the popover shows wrong freshness after a run (the core "trust" claim). Live repro: opened the chart popover ("Last run 18 hours ago, 5 rows"), then POST /api/pipelines/fc63432d-.../run (run af20a4db-9d08-494f-9fa8-f0890f8075e9); GET /api/outputs/cef8ba67-.../provenance then returned completedAt 2026-09-30T21:10:27Z. Closing and reopening the popover in the same page (0 new requests) still said "Last run 18 hours ago". design.md Decision 4 explicitly allowed "a new run event if one exists" as the invalidation trigger; one exists (features/panels/services/pipelineRunFanout.ts subscribeToPipelineSucceeded, consumed by hooks/usePanelRunRefresh.ts) and was not used. Required: on a pipeline `succeeded` event (and ideally on failed/dry terminal), evict/refresh the affected provenance cache entries (key output:<id>) so the next open refetches; keep the "second open with no run in between = one request" behaviour. Add a test that a run event after a first open causes a refetch on the next open, and that without one there is exactly one request.
2. Badge regression vs main, same root cause. useDataInvalid.ts: `return cachedFailed ?? fromStatus`. Once the popover has been opened once, the badge follows the stale provenance cache forever (page lifetime), overriding the fresh assertion-status read that main performs on every PanelCard mount. After a run that flips assertions, the "Invalid data" badge will be wrong (shown when fixed, hidden when broken) until a full reload. Fix via the invalidation in (1), and make the fresh status read win over a cache entry older than it (or drop the cache-derived path; the badge can open the popover without deriving from it).
3. Focus return when the badge unmounts while open (evaluator's note, valid): handleClose focuses openerRef.current which may be a detached badge node; fall back to triggerRef when !openerRef.current.isConnected. Small, fix in the same pass with a test.

### Judgment on the requested items
- (a) "Last run produced no rows" when rowCount is null: acceptable, non-blocking. Verified the evaluator's case: output hel904-output-e84a2024... (metric) has GET /rows -> {items:[],materialized:false,total:0} while its sibling table output on the same pipeline has 5 rows. So that panel genuinely has nothing materialized and the popover is consistent with what the panel shows; the ambiguity is backend-side (ProvenanceService.scala countRows -> None when 0). Suggest, non-blocking, wording "No rows recorded for this output" to stay true for both empty and absent snapshots.
- (b) cache staleness: REFUTE item 1/2 above.
- (c) detached-badge focus return: item 3.

### Non-blocking notes
- Dev-DB residue from this review: no entities created. One pipeline run executed on existing pipeline fc63432d-70ab-427e-8b23-5d9bd95db7c1 (run id af20a4db-9d08-494f-9fa8-f0890f8075e9, refreshed node snapshots for the existing HEL-1189 Skeptic outputs). Nothing to delete by id beyond that run record (left; runs have no delete route used here).
- Screenshot is in .playwright-mcp/, not repo root.

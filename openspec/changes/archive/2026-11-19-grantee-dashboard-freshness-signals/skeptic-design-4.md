## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD b2603ab7998f3e9b4bdca5089a18f89da16fdc8b. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/shared-dashboard-freshness-refresh-invalid/HEL-1786`.

- **Round-3 CR1 is resolved.** The spec requirement "Grantees see the dashboard freshness line" now reads: "the same refresh fact (relative time and success/failure intent) the owner sees, and the source names from the dashboard panel-status route (the sources the per-panel provenance shows ..., which can be fewer than the owner's list)".
  - This matches D1's `sources` bullet, the first requirement's "source names the per-panel provenance would show", and the D5 two-root test / m9.
  - The proposal's "What Changes" now carries the subset sentence.
  - No remaining text says the grantee's source list equals the owner's.

- **Round-3 non-blocking notes are folded in.**
  - D4 now calls both hooks unconditionally with null inputs and selects afterwards (`ownerInvalid` / `status` / `isDataInvalid`).
  - D1 says the history-latest read goes through `withSystemContext` after the ACL, NOT `withUserContext`. I confirmed that `DashboardChangesRepository.scala:42` runs `dataQuery` under `ctx.withUserContext`, so the warning is accurate. The LATERAL `LIMIT 1` shape it reuses is at `:30-38`.
  - The D5 RLS transcript now requires the route's 200 to carry a non-null `dataUpdatedAt` and `lastRunAt` and non-empty `sources`, while the grantee's direct selects return 0 rows.

- **Fresh code checks of the design's premises:**
  - **`Page.MaxLimit = 500`** (`domain/model/pagination.scala:12`), and `findAllByDashboardId(dashboardId, callerOpt, page, accessAlreadyGranted)` exists (`PanelRepository.scala:57`). The D1 panel-read bound is implementable as written.
  - **`OutputService.assertionStatus`** matches the D1 rule: `listByPipelineInternal` + `find(_.status != "dry_run")` + an error-severity failed assertion on the Output's own `stepId`. The `pipelineRunRepo == null` / `stepId.isEmpty` short-circuits are part of what task 2.1 must preserve when factoring it out.
  - **`PipelineRunSucceededWrites.scala:258-264`**: `updateMeta` (`writeLastRun`) chains off `updateRun` and is independent of the snapshot/history transaction. This confirms the CR1 race that makes `dataUpdatedAt`, not `lastRunAt`, the correct trigger.
  - **`PanelCardBody.tsx:191-195`**: `handleFanoutRefresh` = `refresh()` + announcement bump. `refresh` is `usePanelData`'s shared guarded refresh (`usePanelData.ts:164`), the same function polling and the manual button use. So plugging `usePanelStatusRefresh` into it routes through whatever scope `usePanelData` already uses. D4 still requires the executor to verify the per-panel rows path.
  - **`useOutputMeta`** is still called unconditionally at `PanelCardBody.tsx:111`. For a grantee it is served from the panel-seeded cache (`outputMetaCache.ts:32-34`, `scopeOutputToPanel`), so the HEL-1780 zero-Output-request invariant already holds, and this design does not change that.
  - **`DashboardRefreshLine.tsx:76-82`**: the `!isOwner` early return and the reserved-slot rule (`feedingOutputIds(panels)` when panels are known, else `hasPipelineFedPanels`) are as D4 describes. `hasPipelineFedPanels` is computed by `DashboardService` for every list item, owned or shared (`DashboardService.scala:298`, `DashboardRoutes.scala:46`), so the grantee reserved slot has its data before the panels load.
  - **Base spec:** the base `openspec/specs/dashboard-grantee-access/spec.md` has no requirement that hides these three features in a way the ADDED requirements would contradict. Line 71's "Panel features not available through per-panel routes SHALL be hidden" stops applying once they are available. No requirement-name collisions.
  - **Placeholders:** grepping `TODO|TBD` across proposal, design, tasks and specs gives zero hits.

- **AC coverage, traced:**
  - **AC1 (dashboard-scoped route, never `/api/outputs|pipelines`):** D1, D4, task 2.2, e2e zero-request window (D6, 4.1), m6.
  - **AC2 (per-request ACL, stranger 404, NOBYPASSRLS):** D1 `authorizeResourceWithSharing`, D5 404/401 and `helio_app` transcript, task 2.3, m2.
  - **AC3 (no pipeline ids, step names, errors or owner ids):** D1 "never present", D5 recursive key allow-list plus raw-body negative checks, `additionalProperties: false`, m1. Self-decision S1 (failed intent shown) is within the AC because provenance already exposes `lastRun.status`. Round 3 accepted this and I agree.
  - **AC4 (e2e viewer and editor, all three features, no Output/pipeline requests):** D6 e2e and task 4.1, including the phone pass.
  - **AC5 (red first):** tasks 1.2-1.4 commit red before implementation; mutations m1-m9 are listed in 4.2.

- **Internal consistency:** proposal, design, tasks and spec agree on the following:
  - the route shape;
  - the trigger field (`dataUpdatedAt` only);
  - the baseline rule;
  - owner path unchanged;
  - no migration;
  - sibling-lane file exclusions.

  Task 4.4 adds the CLAUDE.md endpoint bullet. I found no contradictions.

### Verdict: CONFIRM

### Non-blocking notes

- After a panel-scope refresh, a grantee panel's own per-panel `dataAsOf` (from the panel list) stays at its pre-run value until the next panel-list refetch, while the meta row fact moves. If a per-panel "as of" label is visible in panel scope, the executor may want to source it from the status item's `lastRunAt` / `dataUpdatedAt` as well. Otherwise, note the staleness in files-modified.md.
- Base spec line 71 says panel content is read "only through the dashboard-scoped per-panel routes". The new route is dashboard-scoped but not per-panel. Optionally make that requirement a MODIFIED entry naming `GET /api/dashboards/:id/panel-status`, so the archived spec does not read as if this route were out of bounds.
- When task 2.1 factors out the shared invalid-rule function, it must keep the `pipelineRunRepo == null` short-circuit (`invalid = false`). Test fixtures construct `OutputService` without it.

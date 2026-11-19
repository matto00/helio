## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 206a72d00f7d8712db1bb3524498634b5b2cd913. The child-1 planning artifacts are uncommitted in the worktree. Every claim below comes from the code; the executor's and orchestrator's narratives were not taken as evidence.

### What I verified (with evidence)

**Correct in the design:**
- The list is owner-only. `DashboardRepository.findAll` filters on `ownerId` (DashboardRepository.scala:57). `findAllVisible` (l.169) has no caller in main code.
- The per-panel routes admit a signed-in grantee with no token. Every path in `PublicDashboardRoutes.scala:63-222` goes through `authorizeResourceWithSharing`. They read through internal (RLS-independent) lookups: `PublicPanelRowsResolver` uses `outputRepo.findByIdInternal`, and `PublicPanelOutputMetaResolver` uses `findConfigsByIdsInternal`. The same paths already serve anonymous share viewers in prod, so D6's data path works under prod RLS.
- Editors are admitted to writes. `DashboardService` l.191-211 and 247-263 return 403 for a Viewer and proceed for an Editor. `PanelService` uses `authorizeEditorOnDashboard` (l.176, 190).
- Grant uniqueness: V16 `unique_grantee_per_resource (resource_type, resource_id, grantee_id)`. Public grants have `grantee_id IS NULL`, so `perm.granteeId === userId` can never match one. D1's exclusion of public grants is sound.
- Routing by `accessRole !== "owner"` instead of by viewer-ness is the correct cut. A dashboard-only editor has no pipeline access, so in prod it is denied on `/api/outputs/*` exactly like a viewer.
- HEL-921: none of the children adds a payload route. Child 2 explicitly keeps `/api/outputs/:id/history/:point/rows` unreachable. The public `/history` is summary-only. The ask tool loop gates `get_history_rows` on a pipeline grant. No child violates the premise.
- `withKnownFlag` (dashboardsSlice.ts:97 and others) is an existing preserve-on-merge chokepoint that D3 can reuse.

**Where the design is wrong or incomplete:** see the Change Requests.

### Verdict: REFUTE

### Change Requests

1. **The "Finding" names the wrong mechanism and cannot be observed in dev. Fix the claim, and prove it as `helio_app`.** `/api/outputs/:id`, `/rows`, `/assertion-status`, `/filter-capabilities` and `/distinct-values` do not use `OutputReadAccess`, which is only a hint helper (OutputReadAccess.scala:8-11). They go through `OutputService.findById` / `OutputRowReads.rows`, then `OutputRepository.findById`, which is `ctx.withUserContext(...)(table.filter(_.id === id))` (OutputRepository.scala:144). The only ACL there is RLS: `outputs_select USING (helio_can_access_pipeline(pipeline_id))` (V94:238).
   - In dev, CI and Playwright the DB role is a BYPASSRLS superuser (MISTAKES.md "RLS policies never run in dev or CI"). A dashboard-only grantee therefore gets **200 with rows** from `/api/outputs/:id/rows` there.
   - The executor's "re-verify before relying on it" will see the opposite of what design.md claims.
   - Required: correct the Context bullet and the Finding to cite `outputs_select`/V94. Extend D2 so the `helio_app` transcript also shows:
     - (a) `SELECT ... FROM outputs WHERE id = <bound output>` returns 0 rows as the dashboard-only viewer and as the dashboard-only editor;
     - (b) the per-panel rows resolution still returns rows for both.
   - That transcript, not dev behaviour, is the evidence for the routing decision.

2. **D6/D5 miss consumers that read Output or pipeline routes, or that would break for non-owners.** Name each one in design.md with its non-owner behaviour (hidden, or rerouted). Leaving them to "the executor enumerates" is not enough, because several are not panel "features" and the e2e does not exercise them:
   - `useDashboardMeta` (useDashboardMeta.ts:56 `fetchOutputMeta` = `GET /api/outputs/:id`; l.101 `getPipelineById` = `GET /api/pipelines/:id`). It is mounted by `app/dashboardMeta/DashboardMetaRow.tsx:80` and `DashboardRefreshLine.tsx:73`. Define what the freshness/refresh line shows for a non-owner: hidden, or a neutral state. "Never run" or an error is not acceptable.
   - `usePanelRunRefresh` (PanelCardBody.tsx:175) calls `fetchOutputMeta`, then `pipelineRunFanout`'s SSE `GET /api/pipelines/:id/run-events` and `runs/latest`. That SSE has a backoff-retry loop (pipelineRunFanout.ts:93-174).
   - The data-invalid / assertion badge: `useDataInvalid`, then `getAssertionStatusShared`, then `GET /api/outputs/:id/assertion-status` (PanelCard.tsx:97-102, provenanceCache.ts:91).
   - The warm tab cache and row reuse (`tabs/warm/warmCapture.ts`, `warmRestore.ts`, `panelRowsReuse.ts`), all keyed on `outputMetaCache`/outputId. A shared dashboard opened in a tab must not restore through the Output path.
   - `PanelFullscreenOverlay` / panel detail (`onDetail`), and table column-header sort if it issues a server sort.
   - **Form submit for editors.** The server is owner-only ("Only this form's owner can submit to its data source", PanelService.scala:122). D5 hides submit only for viewers, so an editor would get a working-looking button that 403s. It must be hidden (or shown as disabled with a reason) for every non-owner.
   - The "Ask about this dashboard" entry point. Child 1 must say whether it is shown to grantees (child 3 verifies it). If it is shown, its cited-Output links must not open the Output routes.

3. **Widen the request invariant (C16, D6, D8) from `/api/outputs/` to `/api/outputs/` and `/api/pipelines/`.** `getPipelineById`, `run-events` and `runs/latest` are not under `/api/outputs/`. For a dashboard-only grantee they 404 or reconnect-loop in prod, and the current invariant would stay green. Also assert no 4xx/5xx `/api/*` responses and no console errors while the non-owner views the dashboard. Before counting requests, wait until the Output panel's rows are visible and the network has settled (that is the positive anchor).

4. **Widening `GET /api/dashboards` has side effects the design does not address, and they conflict with "owners are unchanged".** State and decide each one:
   - Default landing: `getMostRecentDashboardId` (dashboardsSlice.ts:58) picks `items[0]` by `lastUpdated`. An owner who is also a grantee can now land on someone else's dashboard after login.
   - Onboarding: `useOnboardingHost.ts:65` and `OnboardingChecklist.tsx:84` count `dashboards.items.length`. A brand-new user whose only dashboard is shared (the exact stage-1 persona) gets first-run onboarding suppressed and the "create a dashboard" step marked done.
   - helio-mcp: `helio-mcp/src/helioApi.ts:242` lists via the same route, so agents (including the hosted remote connector) will start seeing dashboards they cannot edit. The proposal Impact must name helio-mcp, and its `DashboardResponse` type must pick up `accessRole`. Alternatively, restrict the new behaviour to the app.
   - The likely right answer is to count and land on owned dashboards only, but it is a decision the artifacts must state, with a test.

5. **The red-first plan (task 2.1, D8) cannot work as written.** On 206a72d00 the viewer test stops at the not-found assertion, so the later viewer assertions never run. The negative assertions (zero `/api/outputs/` requests, no layout-edit/add-panel/rename/share controls) would be vacuously green on the not-found page anyway. "Each new assertion red for the right reason" is not achievable. Restate it as:
   - (a) red on the unfixed branch at the opens / list assertions only;
   - (b) a mutation on the fixed code for each negative-assertion family, each red at its own assertion. The current m1-m3 cover the list, one layout toggle and the outputs path. Add:
     - viewer add-panel gate removed;
     - viewer panel-rename gate removed;
     - editor share/delete gate removed;
     - Shared-marker condition forced true, so the owner's no-marker check goes red;
     - a `/api/pipelines/` consumer (e.g. `useDashboardMeta`) left ungated, so the widened invariant from CR3 goes red.

6. **D1: name the dedupe mechanism.** `findAllVisible` dedupes with `owned union granted` only because both branches yield identical rows. Once a role column is added, an owner who also holds a grant row on their own dashboard produces two distinct tuples. I found no self-grant guard in `services/`, and V16 does not prevent one. The granted branch must explicitly exclude `dash.ownerId === userId`, and the count must be taken over that same deduped query. The planned "owned+granted listed once" spec case must seed a real self-grant row to exercise this.

### Non-blocking notes
- D2 runs "the list query's SQL shape" by hand. Prefer the SQL Slick actually generates (`.result.statements`), or run the real route as `helio_app`, so the proof cannot drift from the code.
- D3/D4: say what `selectCanEditDashboard` returns when `accessRole` is absent, and test it. Fail-closed for `ownerId !== me` is safer than the "default owner only for dashboards the caller created" heuristic, which has no defined source of truth. The merge sites that must route through the preserve helper are `upsertDashboardById`/`withKnownFlag`, `keepLocalLayout` (layout, repair), `dashboardUpserted` (patch-set apply) and `applyProposal`.
- The client already has token-only per-panel callers for filter capabilities, distinct values, history, insight and provenance (`publicDashboardService.ts`, `usePublicPanelData`, and the public branches in `insightService`/`provenanceService`/`outputHistoryService`). Child 2 is mostly making the token optional and wiring these in, not new work. Consider whether child 1 can reuse `usePublicPanelData` directly instead of adding a third rows path in `fetchPanelPage`.
- Children: child 2's "everything child 1 hid is shown again" should list the CR2 items (freshness line, run-refresh, data-invalid badge, warm cache). Form submit for editors is a product question (server is owner-only) and needs a home: child 2 or a new child. Dependencies (all on child 1) are correct.
- A pipeline grantee who is also a dashboard grantee will lose filter/sort on the per-panel path even though `/api/outputs/*` would work for them. This is acceptable as a stated trade-off; say it in Risks.

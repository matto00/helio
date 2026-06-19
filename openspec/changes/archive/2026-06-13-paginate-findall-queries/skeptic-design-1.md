## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

**Ticket AC read:** `openspec/changes/paginate-findall-queries/ticket.md` — 7 ACs covering `Page` model, repository pagination, route params, response envelope, panel support, UI-unchanged behaviour, and backend tests.

**Design artifacts read:** `proposal.md`, `design.md`, `tasks.md`, and all four `specs/*/spec.md` files.

**Ground-truth code checked:**
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — actual panel method names and signatures
- `backend/src/main/scala/com/helio/api/routes/DashboardRoutes.scala` — route handlers actually present
- `backend/src/main/scala/com/helio/api/routes/PublicDashboardRoutes.scala` — actual handler for `GET /api/dashboards/:id/panels`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — routing composition
- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — `PanelsResponse` definition
- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` — `DashboardsResponse` definition
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — `DataSourcesResponse` definition
- `backend/src/main/scala/com/helio/api/protocols/DataTypeProtocol.scala` — `DataTypesResponse` definition
- `frontend/src/features/dashboards/services/dashboardService.ts`
- `frontend/src/features/sources/services/dataSourceService.ts`
- `frontend/src/features/dataTypes/services/dataTypeService.ts`
- `frontend/src/features/panels/services/panelService.ts`

---

### Verdict: REFUTE

---

### Change Requests

1. **D5 names the wrong class and method for the panels endpoint — the implementation target will be wrong.**

   Design D5 states: "This endpoint doesn't go through `PanelRoutes` but through `DashboardRoutes → DashboardService`. Pagination params are added to the `DashboardRoutes` `GET /:id/panels` path handler."

   Ground truth: `GET /api/dashboards/:id/panels` is handled by `PublicDashboardRoutes` (line 29–46 of `PublicDashboardRoutes.scala`), which calls `PanelRepository.findAllByDashboardId` directly. There is **no** `/:id/panels` handler anywhere in `DashboardRoutes.scala` — only `/:id/duplicate`, `/:id/update`, and `/:id` (PATCH/DELETE). The `DashboardRoutes` class does not touch panels at all.

   Additionally, task 2.7 names `PanelRepository.findByDashboardId` as the target method, but the actual method in `PanelRepository.scala` (line 32) is `findAllByDashboardId`. There is no `findByDashboardId`.

   Required correction: D5, task 2.7, task 3.4, task 5.4, and `specs/backend-persistence/spec.md` (the `PanelRepository.findByDashboardId` scenario) must be updated to name the correct class (`PublicDashboardRoutes`), the correct repository method (`findAllByDashboardId`), and remove the claim that this goes through `DashboardService`. The executor will implement the wrong target if this is not corrected.

2. **The claim that the panel list endpoint currently returns a plain array is false — it already returns `{items:[...]}`.**

   Design D4 states: "The panel list endpoint currently returns a plain array; it will be wrapped in the same envelope." `proposal.md` repeats this. But `PublicDashboardRoutes.scala` line 41 already returns `PanelsResponse(items = panels.map(PanelResponse.fromDomain))`, and `PanelProtocol.scala` line 37 defines `final case class PanelsResponse(items: Vector[PanelResponse])`. The frontend `panelService.ts` line 30 already calls `response.data.items`.

   This false premise causes D4's "wrapping" step and the "breaking for any direct API consumer" risk mitigation to be mis-stated. The real change for panels is **additive** (adding `total`, `offset`, `limit` to an existing `{items:[...]}` envelope) — the same as dashboards/data-sources/data-types — not a shape promotion from array to envelope. The design and proposal must be corrected so the executor does not accidentally re-wrap an already-wrapped response or introduce a regression believing the current shape is a plain array.

3. **Frontend "service layer changes" are partially a no-op and the design does not acknowledge this.**

   The design (D6, task 6.1–6.4) calls for updating all four service functions to "unwrap `.items` from the new envelope." But inspection shows all four already unwrap `.items`:
   - `dashboardService.ts` line 24: `return response.data.items`
   - `dataSourceService.ts` line 48: `return response.data.items`
   - `dataTypeService.ts` line 10: `return response.data.items`
   - `panelService.ts` line 30: `return response.data.items`

   The **actual** frontend work is updating the TypeScript response type interfaces (e.g. adding `total: number; offset: number; limit: number` to each `*Response` interface) so the compiler catches stale call sites — and propagating those new fields into Redux state if D6 specifies that. The tasks as written will mislead the executor into thinking there is an unwrapping step to add, when in reality all that exists is a type-widening step. Clarify the actual delta so the executor knows what to change.

---

### Non-blocking notes

- The DBIO.zip / DBIO.seq parallel-count approach described in D2 is sound for RLS parity, but the tasks (2.2, 2.4, 2.6, 2.8) model `countAll` as separate `Future[Int]` methods called by the service layer (task 3.x), not as DBIO actions composed inside the repository. Either approach works but the tasks contradict D2. If the design intends a single transaction, the task description should state that both the slice and count queries are composed inside the repository, not the service. This is ambiguous but not a blocker.
- `GET /api/types` is the actual path prefix (confirmed: `DataTypeRoutes.scala` line 24 uses `pathPrefix("types")`). The design's `GET /api/types` reference is correct; the `ticket.md` and `CLAUDE.md` description of the endpoint as `/api/data-types` is slightly inconsistent with reality. No action needed for this change, but worth noting.

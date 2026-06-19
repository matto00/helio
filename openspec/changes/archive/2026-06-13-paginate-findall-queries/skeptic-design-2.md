## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Round-1 CRs re-checked:** Read `skeptic-design-1.md` (written 12:11), then read
updated `design.md` (modified 12:12) and `tasks.md` (modified 12:13) directly.

**Ground-truth files re-verified:**
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` line 32 — method is `findAllByDashboardId`
- `backend/src/main/scala/com/helio/api/routes/PublicDashboardRoutes.scala` line 38 — calls `panelRepo.findAllByDashboardId` directly, no service intermediary for panels list
- `frontend/src/features/dashboards/services/dashboardService.ts` lines 10-24 — `DashboardsResponse.items` already defined, `return response.data.items` already present
- `frontend/src/features/sources/services/dataSourceService.ts` lines 16+48 — same pattern
- `frontend/src/features/dataTypes/services/dataTypeService.ts` lines 5+10 — same pattern
- `frontend/src/features/panels/services/panelService.ts` lines 20-30 — same pattern
- `backend/src/main/scala/com/helio/infrastructure/DbContext.scala` lines 50-51 — `withUserContext` wraps a single `DBIO[R]` per call

**Spec files read:** all four `specs/*/spec.md` files; `backend-persistence/spec.md` was
updated to use `findAllByDashboardId` and `countByDashboardId` — consistent with tasks.

---

### Verdict: REFUTE

---

### Change Requests

1. **Context section still names the wrong method and wrong routing path for panels — not
   fixed by the round-1 revision.**

   `design.md` line 4 still reads:
   > `PanelRepository.findByDashboardId`

   The actual method name is `findAllByDashboardId` (confirmed in `PanelRepository.scala` line 32).
   D5, tasks 2.7/3.4/5.4, and `specs/backend-persistence/spec.md` were correctly updated in
   round 1, but the **Context section** was not. An executor reading top-to-bottom encounters
   the wrong name before reaching D5 and may act on it.

   `design.md` line 9 still reads:
   > "The `GET /api/dashboards/:id/panels` endpoint is served via `DashboardRepository` via
   > the `DashboardService`"

   Ground truth: it is handled by `PublicDashboardRoutes` calling `PanelRepository` directly
   (`PublicDashboardRoutes.scala` line 38). `DashboardRepository` and `DashboardService` are
   not in that call path at all.

   Required fix: correct lines 4 and 9 of `design.md` to match D5 (which is already correct).

2. **Goals section line 24 contradicts D6 with a false premise — not fixed by the round-1
   revision.**

   `design.md` line 24 (Goals bullet) still reads:
   > "Update frontend service layer to unwrap `.items` from the new envelope (currently assumes
   > plain array)"

   D6 (same file, line 65-70) correctly states: "All four service functions already unwrap
   `.items` from the response" and "The actual frontend work is **type-widening**."

   The "currently assumes plain array" parenthetical is factually false (all four services
   return `response.data.items` today) and directly contradicts D6. An executor will read
   Goals before Decisions and may waste effort adding unwrapping code that already exists,
   or may inadvertently double-wrap.

   Required fix: correct Goals line 24 to read: "Update frontend service layer TypeScript
   response interfaces to include `total`, `offset`, `limit` fields (type-widening only;
   `.items` unwrapping already present in all four services)."

---

### Non-blocking notes

- **D2 vs. tasks architecture mismatch (carried from round 1, still unresolved):** D2 states
  that count and data queries "are run as a single `DBIO.seq`/`zip` inside `withUserContext`"
  and explicitly rejects separate `Future` calls for TOCTOU reasons. But tasks 2.2/2.4/2.6/2.8
  specify separate `countAll` repository methods returning `Future[Int]`, and tasks 3.1-3.3
  say the service layer "calls both `findAll` and `countAll`" — implying two distinct
  `withUserContext` calls, each its own transaction. These two approaches are mutually
  exclusive given how `DbContext.withUserContext` works (one `DBIO[R]` per transaction,
  line 50-51 of `DbContext.scala`). The executor will have to choose one; the design should
  state which is authoritative. This was a non-blocking note in round 1 and remains so — the
  executor can reasonably pick the simpler separate-future approach and document the trade-off
  inline — but the contradiction should be resolved to avoid back-and-forth.

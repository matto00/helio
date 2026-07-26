## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Bulk-writer breakpoint precedent (design.md D1, Context).**
   - `backend/src/main/scala/com/helio/services/DashboardContentsService.scala:102-107` —
     `remapLayout` builds `DashboardLayout(lg = items, md = items, sm = items, xs = items)` verbatim,
     confirming the cited precedent.
   - `helio-mcp/src/helioApi.ts:719-738` — `updateDashboardLayout`'s docstring ("applies them to all
     four breakpoints... a desktop-first placement") and body (`{ lg: items, md: items, sm: items, xs:
     items }`) match the design's quote exactly.
   - Contrast claim (interactive grid genuinely differs) also verified:
     `frontend/src/features/dashboards/state/dashboardLayout.ts:10-15` defines
     `dashboardGridCols = { lg: 12, md: 10, sm: 6, xs: 2 }`, and `projectLayout`/`resolveDashboardLayout`
     (lines 139-205) scale positions per breakpoint via `targetCols/sourceCols`. The design's dichotomy
     (bulk writers: one placement; interactive grid: real per-breakpoint resolution) is accurate.

2. **`mobilePanelHeights.ts` "unaffected" claim.** Partially inaccurate as literally worded. I traced
   the actual data flow:
   - `frontend/src/features/panels/ui/MobilePanelStack.tsx:46-58` reads `resolvedLayout.xs` and passes
     each panel's `h` into `computeMobilePanelHeight(panel.type, h, contentWidth)`.
   - `frontend/src/features/panels/ui/mobilePanelHeights.ts:72-96` — for `kind === "chart"`,
     `computeChartHeight(h, w)` DOES use the xs layout item's `h` (banded/clamped between
     `CHART_COMPACT_H=4` and `CHART_TALL_H=8`) to modulate the rendered mobile height. It is correct
     that this is never a literal `h × rowHeight` multiplication (the design's precise wording holds),
     but the broader claim "no interaction with mobile sizing... confirmed unaffected" overstates it —
     for chart panels specifically, the `h` value auto-layout writes into `xs` does feed into the mobile
     height computation (bounded/saturating effect). `MobilePanelStack.tsx:47-48` also orders panels by
     `resolvedLayout.xs`'s `y`/`x` (`orderPanelsForMobileStack`), so stack order also derives from the
     `xs` values auto-layout writes.
   - However, this exposure is **not new** — it already exists identically today for every dashboard
     written via `remapLayout` or `updateDashboardLayout` (both already copy the same `h` into `xs`), so
     this design does not introduce a new mobile-rendering risk; it only adds a second caller of an
     already-existing, already-accepted pattern. No functional gap, no AC affected — a documentation-
     precision issue only. See Change Request 1.

3. **Per-kind clamp table (design.md D4) vs. `~/Development/helio-news/news/run.py`.** Read `_BOUNDS`
   (lines 52-59), `_FALLBACK` (39-46), `_clamp` (67-69), `_fill_shelf` (197-217), `_pack` (220-240),
   `_FILL_THRESHOLD = 7` (64), `GRID_COLS = 12` (35). Every value in design.md's table matches verbatim:
   `chart(4,6,24)`, `metric(2,3,5)`, `collection(3,4,24)`, `image(3,5,24)`, `table(3,4,24)`,
   `markdown(3,5,24)`, default `(1,2,24)` via `_BOUNDS.get(kind, (1,2,24))`, fill threshold 7,
   `maxW` implicitly `GRID_COLS` via `min(GRID_COLS, w)`. Faithful port, no drift.

4. **D2 (own endpoint vs. option on existing write paths).** The ticket's own language is "e.g. POST
   /api/dashboards/:id/auto-layout" (an example, not a mandate) plus "Reuse rather than duplicate." D2
   explicitly satisfies "reuse" at the algorithm-module level (one pack function/clamp table reusable by
   `DashboardContentsService`/`BoundPanelService`/`PanelService` later) while keeping this change's HTTP
   surface to one endpoint — a reasonable, explicitly justified scope decision, not scope creep.

5. **Scope discipline.** `proposal.md` Non-goals (lines 64-65) and `design.md` Non-Goals (lines 48-49)
   both explicitly exclude HEL-368, HEL-369, HEL-624, and folding into HEL-363/364/370's request shapes.
   No absorption found anywhere in tasks.md.

6. **Determinism / property test / omitted-panel handling (D3/D5/D6).** Concretely specified, not
   hand-waved: D3 states the exact ordering rule (input-array order = visual order, `Vector` not
   `Set`/`Map` end-to-end, no re-sort). D5 specifies a generator-driven property test over random
   `(kind,w,h)` including out-of-bounds values, plus a documented ScalaCheck-vs-hand-rolled fallback
   (verified `backend/build.sbt` has no existing ScalaCheck dependency, matching the design's stated
   risk/plan to check at implementation time). D6 states precisely what happens to omitted and unknown
   panel ids, and honestly documents the known simplification (kept panels aren't collision-avoided
   against newly packed ones) as a Risk with a stated mitigation (Scaladoc + API doc), consistent with
   the ticket AC's own "(or are documented as unmanaged)" allowance.

7. **No Flyway migration needed.** `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala:214`
   — `layout` is already `column[DashboardLayout]("layout")` with `dashboardLayoutColumnType` a JSON
   `BaseColumnType`. Confirmed no new migration is required; `ls backend/.../db/migration` shows no
   auto-layout-related migration was added (correctly — none is needed).

8. **Cross-file wiring targets are real**, not invented: `DashboardContentsRoutes.scala` exists (mirror
   target for task 3.1); `pathPrefix("api")` is applied centrally in `ApiRoutes.scala:209` (so tasks.md's
   relative `POST /dashboards/:id/auto-layout` correctly resolves to `/api/dashboards/:id/auto-layout`,
   no contradiction with proposal/ticket's full path); `DashboardLayoutItemPayload`/`DashboardService.applyUpdate`
   (`layoutOpt`) exist as cited; `PanelKind.All` is registry-derived from exactly the 9 kinds design.md
   cites (`metric/chart/table/text/markdown/image/divider/collection/timeline`,
   `backend/src/main/scala/com/helio/domain/Panel.scala:146-160`); `mcp-panel-composition-tools` is a
   real existing OpenSpec capability (`openspec/specs/mcp-panel-composition-tools`), and `write.ts` uses
   `server.registerTool` as claimed.

9. No `TODO`/`TBD`/hand-waving found in any of the five artifacts (`grep -in` across ticket/proposal/
   design/tasks/spec files returned nothing).

### Verdict: CONFIRM

### Non-blocking notes
1. `design.md` Context (lines 24-27) overstates the `mobilePanelHeights.ts` claim — say "no
   interaction" / "confirmed unaffected" where in fact the `xs` layout item's `h` does feed
   `computeChartHeight`'s banded modulation for chart panels, and `xs`'s `y`/`x` drive
   `orderPanelsForMobileStack`'s ordering. Recommend tightening the wording at implementation time to:
   "no `h × rowHeight` multiplication is used (confirmed), and any influence via chart's banded `h`
   modulation / xs-derived stack order already exists identically for every current bulk writer
   (`remapLayout`, `updateDashboardLayout`) — this ticket adds no new mobile-rendering behavior." This
   does not change any task or the architecture; it's a documentation-precision fix only, so it does not
   block execution.

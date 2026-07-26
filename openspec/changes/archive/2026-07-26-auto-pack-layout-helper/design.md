## Context

`helio-news`'s `_pack`/`_fill_shelf`/`_clamp`/`_BOUNDS`/`_FALLBACK` (`~/Development/helio-news/news/run.py`,
read in full for this design) flow `(kind, w, h)` triples left→right across a 12-column grid, wrapping
shelves, then widening a nearly-full shelf to close the ragged edge, then clamping each panel's size to a
per-kind floor/ceiling before packing. That algorithm has zero DB/HTTP dependency and ports directly.

Ground truth checked in the codebase (not assumed) before writing this design:

- `frontend/src/features/panels/ui/panelGridConfig.ts` / `dashboardLayout.ts`: the INTERACTIVE grid
  (`DesktopPanelGrid`) genuinely resolves four *different* per-breakpoint layouts (lg=12/md=10/sm=6/xs=2
  cols) via `resolveDashboardLayout`'s projection + fallback path — each breakpoint gets independently
  scaled positions, not a copy of the same numbers.
- BUT every existing *bulk, non-interactive* layout writer already applies ONE placement identically to all
  four breakpoints, ignoring the column-count difference:
  - `DashboardContentsService.remapLayout` (HEL-363): `DashboardLayout(lg = items, md = items, sm = items,
    xs = items)`.
  - `helio-mcp/src/helioApi.ts#updateDashboardLayout`: `{ lg: items, md: items, sm: items, xs: items }`,
    docstring: "applies them to all four breakpoints ... a desktop-first placement."
  - The backend `DashboardLayoutPayload`/`DashboardLayout` wire and domain shapes are plain four-vector
    structs with no cross-breakpoint derivation logic — callers decide what each vector contains.
  - This is the ticket's own stated precedent ("The same placement applies to all breakpoints today (see
    `update_dashboard_layout` semantics) — keep that behavior").
- `frontend/src/features/panels/ui/mobilePanelHeights.ts`: the phone read-only stack derives panel height
  from `PanelKind` + fixed pixel bands, NOT from `layout.xs`'s `h × rowHeight` (the desktop grid's row-based
  formula never applies on the stack). `MobilePanelStack.tsx` does still read `resolvedLayout.xs`'s `h` as
  one input to a chart panel's banded height modulation, and its `y`/`x` for stack ordering — but that
  exposure is pre-existing today via the same "same placement to all breakpoints" bulk-writer convention
  (`remapLayout`/`updateDashboardLayout`), so auto-layout introduces no new interaction: no code changes
  needed in `mobilePanelHeights.ts` or `MobilePanelStack.tsx`.
- `backend/src/main/scala/com/helio/domain/Panel.scala`: 9 registered kinds (`metric/chart/table/text/
  markdown/image/divider/collection/timeline`) via `Panel.Registry` / `PanelKind.All`.
- `backend/.../DashboardRepository.scala:214`: `layout` is already a JSON-typed Slick column
  (`dashboardLayoutColumnType`) — no Flyway migration needed for this change.

## Goals / Non-Goals

**Goals:**
- Deterministic, pure Scala pack function `(ordered (panelId, kind, w, h))[] → (panelId, x, y, w, h)[]`,
  unit-testable with zero HTTP/DB.
- One new endpoint, `POST /api/dashboards/:id/auto-layout`, that resolves panel kinds, packs, persists via
  the existing `DashboardRepository.update` path, and returns the updated dashboard.
- Per-kind clamping server-side (ticket scope explicitly calls for it — settled, not left implicit).
- Overlap-freedom proven as a property over generated inputs, not by example.

**Non-Goals:**
- Deciding panel sizes (agent/model judgement, unchanged).
- Differing per-breakpoint layouts — auto-layout is a bulk writer; it follows the bulk-writer convention
  documented above, not the interactive grid's per-breakpoint resolution.
- Compaction/reflow of an already-positioned dashboard on later edits.
- HEL-363's replace-contents / HEL-364's bound-panel / HEL-370's batch-create growing an inline
  `autoLayout: true` option — see Decision 2.

## Decisions

**D1 — Breakpoints: one packed placement, applied identically to lg/md/sm/xs.**
Matches the established bulk-writer convention (see Context). The packer computes ONE
`Vector[(panelId,x,y,w,h)]` against `cols` (default 12, the `lg` count) and the service wraps it as
`DashboardLayout(lg=items, md=items, sm=items, xs=items)`, exactly mirroring
`DashboardContentsService.remapLayout`. Not doing four independent packs (against 12/10/6/2 cols) because
no other bulk writer does that today and doing so here alone would silently create the FIRST endpoint whose
`md`/`sm`/`xs` diverge in shape from `lg` — a bigger, uncoordinated behavior change the ticket doesn't ask
for. The interactive grid still overrides on next drag/resize (`resolveBreakpointLayout`'s saved-entry
happy path), same as it does today for HEL-363-written dashboards.

**D2 — Own endpoint, not an option on existing write paths.**
`POST /api/dashboards/:id/auto-layout` is standalone. The packer module is exported so `DashboardContentsService`
/`BoundPanelService`/`PanelService` (batch-create) *could* call it directly in a later ticket, but this change
does not add an `autoLayout` flag to those request shapes — that's a second, separable API-surface decision
(each caller's request/response contract, error semantics, and MCP tool wiring change) better scoped as its
own ticket if wanted. Reuse is achieved at the algorithm-module level (one pack function, one clamp table),
not by merging endpoints. `ticket.md`'s "reuse rather than duplicate" is satisfied by not re-deriving `_pack`
per caller — not by collapsing distinct HTTP contracts.

**D3 — Determinism / ordering rule.**
Input order (`[{panelId,w,h}]` array order) IS visual order — the pack function iterates the input
`Vector` in place, left→right, shelf-wrap on overflow, identical to `_pack`'s `for i, p in enumerate(built)`.
No re-sorting by kind, size, or panelId. Same input list ⇒ byte-identical output, always (pure function, no
randomness, no map iteration — `Vector`, not `Set`/`Map`, end to end).

**D4 — Per-kind clamp table lives server-side, ported verbatim from `_BOUNDS`/`_FALLBACK`.**
```
metric:     minW=2, minH=3, maxH=5
chart:      minW=4, minH=6, maxH=24
table:      minW=3, minH=4, maxH=24
collection: minW=3, minH=4, maxH=24
image:      minW=3, minH=5, maxH=24
markdown:   minW=3, minH=5, maxH=24
text/divider/timeline (not in helio-news's set): minW=1, minH=2, maxH=24  (the `_BOUNDS.get(kind, (1,2,24))` default)
```
`maxW` is implicitly `cols` (clamped in `_clamp` via `min(GRID_COLS, w)`); ported the same way. Panel kind is
looked up server-side from the dashboard's existing panels (never trusted from the request) — mirrors
`DashboardContentsService.validatePanels` validating request data against known-good server state before any
write.

**D5 — Overlap-freedom is a ScalaCheck/generator-driven property test**, not just example cases: generate N
panels with random `(kind, w, h)` (including out-of-bounds values to exercise clamping) and assert the packed
output has zero pairwise rectangle overlaps, for many random seeds/sizes. Hand-written cases (wrap, shelf-fill,
clamp, single-panel, empty) supplement it per the ticket's explicit ScalaTest list — both are required, not
either/or.

**D6 — Omitted / unknown panelId handling.** Panels on the dashboard but absent from the request keep their
current `dashboard.layout.lg` position verbatim (looked up before packing, not re-derived) — packed items are
appended into the SAME `x,y` grid space after the kept ones don't reserve space (the packer has no visibility
into kept items' positions; this is a known simplification — see Risks). A `panelId` in the request not
present among `PanelRepository`'s panels for that dashboard is rejected whole-request with 400 (all-or-nothing,
same shape as `DashboardContentsService.validatePanels`'s "fails on the first bad panel" convention).

## Risks / Trade-offs

- [Kept (omitted-from-request) panels are not collision-avoided against newly packed ones — a
  mixed request could visually overlap a kept panel] → Documented behavior per D6 and the ticket's own
  acceptance criterion ("Panels omitted from the input keep their current position (or are documented as
  unmanaged)"); out of scope to solve full-dashboard reflow here (ticket's explicit non-goal). Executor
  states this plainly in the endpoint's Scaladoc and API doc.
- [`cols` param lets a caller request a grid narrower than `lg`'s 12, then D1 still writes that result to all
  four breakpoints] → Acceptable: `cols` is opt-in, defaults to 12; a caller narrowing it is making the same
  choice `update_dashboard_layout` callers already implicitly make today.
- [New ScalaCheck dependency, if not already present] → Check `backend/build.sbt` at implementation time;
  ScalaTest's built-in `org.scalatest.prop.TableDrivenPropertyChecks`/hand-rolled generators are an acceptable
  fallback with zero new dependency if ScalaCheck isn't already wired.

## Migration Plan

Additive only: new route, new service, new pure module, new MCP tool, new schema/OpenAPI paths. No Flyway
migration (layout column already JSON-typed). No changes to `PATCH /api/dashboards/:id` or
`resolveDashboardLayout`. Rollback = revert the PR; nothing else depends on the new endpoint yet.

## Open Questions

None blocking — D1/D2/D3/D4/D5 resolve every question flagged in the ticket pre-brief.

## Planner Notes

Self-approved: D2 (standalone endpoint, no inline option on HEL-363/364/370) — keeps this change's surface
area to exactly what the ticket scopes; folding auto-layout into three other endpoints' request/response
contracts is a bigger, separately-reviewable change. Self-approved: ScalaCheck-vs-fallback left as an
implementation-time check rather than a blocking decision (D5's Risk) since it doesn't change the algorithm
or contract, only the test-harness dependency.

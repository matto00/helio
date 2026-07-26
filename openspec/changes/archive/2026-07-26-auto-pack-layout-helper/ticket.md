# HEL-367 — Add a server-side auto-pack layout helper that flows w×h panels into non-overlapping grid positions

## Context

`helio-news` follows the principle "the model sizes, the code packs": the layout model returns only a `w × h` per panel, and `run._pack` (`~/Development/helio-news/news/run.py`) flows those sizes left-to-right across the 12-column grid, wrapping to a new shelf when a row fills, so overlaps are impossible by construction. It also carries `_fill_shelf` (widen a nearly-full shelf to close a ragged right edge), `_clamp`/`_BOUNDS` (per-kind min/max width/height so a choice can't render broken), and `_FALLBACK` sizes. Every agent that builds a Helio dashboard has to re-implement this geometry, because the only layout primitive Helio exposes (`update_dashboard_layout`, `PATCH /api/dashboards/:id`) requires the caller to supply fully-resolved `{x,y,w,h}` for every panel.

Helio should offer an optional server-side helper that takes `{panelId, w, h}` (sizes only) and returns/persists non-overlapping `{x,y,w,h}` positions — the geometry, done once, correctly.

## Scope

* **Backend auto-pack endpoint** — e.g. `POST /api/dashboards/:id/auto-layout` accepting `[{panelId, w, h}]` (+ optional `cols`, default 12) and either returning the packed `[{panelId,x,y,w,h}]` or persisting it via the existing layout write path and returning the updated dashboard. Port the `_pack` shelf-flow algorithm (order-preserving left→right wrap), plus per-kind clamping and ragged-edge fill, to Scala.
  * Reuse the existing layout persistence: `DashboardService` layout update + `DashboardRepository`, and the layout item shape in `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` (`DashboardLayoutItemPayload`). The same placement applies to all breakpoints today (see `update_dashboard_layout` semantics) — keep that behavior.
  * New route/service under `backend/src/main/scala/com/helio/api/routes/`; wire into `ApiRoutes.scala`. Never inline fully-qualified names.
* **Clamp/bounds** — apply per-panel-type min width / min+max height bounds (equivalent to helio-news' `_BOUNDS`) so a supplied size that would render broken (e.g. a 6×3 chart clipping its axis) is corrected. Keep the model's *relative* sizing.
* **MCP surface** — add an `auto_layout_dashboard` tool in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts` taking panel ids + sizes.
* Update `schemas/` + `openspec/` for the request/response.

## Acceptance criteria

- [ ] `POST /api/dashboards/:id/auto-layout` with a list of `{panelId, w, h}` returns/persists non-overlapping positions on a 12-column grid, order preserved (input order = visual order), with no two panels overlapping.
- [ ] A row whose widths sum below the column count but above a fill threshold is widened proportionally to close the ragged right edge (relative sizing preserved); a sparsely-filled row is left alone.
- [ ] Per-kind clamping corrects out-of-bounds sizes (e.g. a chart narrower/shorter than its readable minimum) without the caller intervening.
- [ ] Panels omitted from the input keep their current position (or are documented as unmanaged); panel ids not on the dashboard are rejected with 400.
- [ ] ScalaTest coverage: basic wrap/no-overlap, shelf-fill widening, clamp correction, single-panel and empty edge cases.
- [ ] MCP `auto_layout_dashboard` tool added + documented; helio-news `_pack`/`_fill_shelf`/`_clamp` could be replaced by one call.

## Out of scope

* Deciding panel **sizes** (that judgement stays with the agent/model — this helper only does geometry).
* Responsive per-breakpoint layouts that differ from each other (matches current `update_dashboard_layout` behavior: one placement for all breakpoints).
* Compaction/reflow of an already-positioned dashboard on later edits.

## Dependencies

* Relates to HEL-364 (compound bound-panel op) and HEL-363 (idempotent rebuild) — a full agentic build is: create panels → auto-layout. Optional endpoint; nothing blocks it.
* No hard blockers.

## Backward compatibility

Additive endpoint + tool; `update_dashboard_layout` (explicit x/y/w/h) is unchanged and remains the primitive for callers that resolve their own geometry.

---

## Orchestrator pre-brief (design-gate must settle)

1. **Responsive breakpoints.** Verify the actual frontend `PanelGrid` breakpoint structure (lg/md/sm/xs, `noCompactor`) rather than assuming. Ticket's own "Out of scope" says: matches current `update_dashboard_layout` behavior — one placement applied to all breakpoints. Confirm this against the real frontend code and state it explicitly in the design. Note there is also mobile-specific sizing (`mobilePanelHeights.ts`) from the mobile PWA work — confirm it's out of scope / unaffected.
2. **Where it lives / how it's invoked.** Pure packing function `(w,h)[] → positioned layout`, testable and reusable. Decide: own endpoint (`POST /api/dashboards/:id/auto-layout`), and/or an option on existing write paths (HEL-363 replace-contents already accepts a layout; HEL-370 batch create and HEL-364 bound-panel create are natural callers). Reuse rather than duplicate.
3. **Determinism.** Same inputs → same layout, always. State the ordering rule explicitly (input order = visual order, left-to-right shelf-flow).
4. **Overlap-freedom as a tested property.** Property-based test over many generated size-lists, not just hand-written cases.
5. **Per-kind size bounds.** Decide explicitly whether `_clamp`/`_BOUNDS` equivalents belong server-side too (ticket scope says yes) — don't leave implicit.

## Scope discipline

Do NOT absorb: HEL-368 (panel id key reconciliation), HEL-369 (external-run hooks), HEL-624 (pie/scatter aggregation). Note dependencies in the proposal instead, do not implement.

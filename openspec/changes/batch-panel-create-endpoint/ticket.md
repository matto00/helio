# HEL-370: Add a batch panel-create endpoint (create many panels on a dashboard in one call)

## Context

Even with a compound bound-panel op, a board is still built one panel per round-trip. In `helio-news`, `_build_story` (`~/Development/helio-news/news/run.py`) calls `add_image_panel`, then `add_text_panel`, then `build_bound_panel` per data panel — every one a separate `create_panel` call — and a board carries the summary + photo for every story plus the day-in-review panels. A morning run issues dozens of `create_panel` calls across the boards. Helio already has a batch **update** path for panels (`PanelBatchItem` / `UpdatePanelsBatchRequest` in `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala`, `PanelServiceHelpers.validateBatchChartTypes` / `validateBatchTypeMatch`) but **no batch create** — so the unbound-panel fan-out (image, markdown/text) has no collapse path.

Add a batch create for panels so an agent lays down a board's non-data panels (and pre-created data panels) in one call.

## Scope

* **Backend batch-create endpoint** — e.g. `POST /api/panels/batch` accepting `{ dashboardId, panels: [CreatePanelRequest-shaped items] }`, creating all panels transactionally (all-or-nothing) and returning the created panels with ids in input order. Mirror the existing batch-**update** validation/transaction pattern:
  * `backend/src/main/scala/com/helio/services/PanelService.scala` + `PanelServiceHelpers.scala` (reuse `resolveCreateConfig` / `resolveCreateAppearance` / `buildNewPanel` per item; validate every item's `chartType` before any write, as `validateBatchChartTypes` does for updates).
  * New route (or extend `PanelRoutes.scala`) under `backend/src/main/scala/com/helio/api/routes/`; wire into `ApiRoutes.scala`. Never inline fully-qualified names.
  * Enforce V41 binding rule per item for any `config.dataTypeId` (same as single create) — a bad binding fails the whole batch, no partial write.
* **MCP surface** — add a `create_panels` tool in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts` taking an array of panel specs (same per-type `config`/`appearance` shapes as `create_panel`).
* Update `schemas/` + `openspec/` for the batch-create request/response.

## Acceptance criteria

- [ ] `POST /api/panels/batch` creates N panels on a dashboard in one transaction and returns them (with ids) in input order.
- [ ] All-or-nothing: if any item is invalid (bad type, invalid chartType, V41-violating binding), no panels are created and a 400 identifies the offending item.
- [ ] Per-item `config` and `appearance` (incl. `chart.chartType`) are applied at create time, matching single `create_panel` behavior exactly.
- [ ] ScalaTest coverage: multi-item happy path, rollback on one bad item, per-item config/appearance parity with single create, V41 rejection.
- [ ] MCP `create_panels` tool added + documented; helio-news' per-story image+markdown fan-out could collapse to one call per board.

## Out of scope

* The source→pipeline→run→bind chain (that's the compound bound-panel op, HEL-364) — this endpoint creates panels (bound data panels may be created here then bound separately, or created already-bound via config where supported, but it does not build pipelines).
* Layout placement (see the auto-pack layout ticket, HEL-367).
* Batching across multiple dashboards in one call (single `dashboardId` per batch).

## Dependencies

* Relates to HEL-364 (compound bound-panel op) and HEL-363 (idempotent rebuild) — these three compose the fast agentic build path. The idempotent-rebuild endpoint may subsume batch-create for the full-replace case; keep this as the incremental-add primitive.
* No hard blockers.

## Backward compatibility

Additive endpoint + tool; single `create_panel` and the existing batch-**update** path are unchanged.

---

## Orchestrator pre-brief (design guidance from the human, not part of the Linear ticket)

### Central design tension — MUST be settled explicitly in the proposal

HEL-363 (`PUT /api/dashboards/:id/contents`, PR #298) already creates many panels atomically in one transaction with all-validation-before-any-write. This ticket wants to *add* many panels in one call. These are close enough that shipping a second, independently-written multi-panel writer would be a real design defect — this batch has already caught near-duplicate composition twice (HEL-364 vs the Smart Shapes chain).

The proposal must explicitly settle:
- Is batch-create simply the **additive sibling** of replace-contents, sharing the same validation and transaction machinery (likely), or is it genuinely different? Justify the answer.
- **Reuse `DashboardContentsOps` / the HEL-363 path where the semantics match.** Do not hand-write a parallel multi-panel insert with its own subtly different failure behavior.
- Does batch-create accept **bound** panels (i.e. N× the HEL-364 chain), or only plain panels bound to pre-existing DataTypes? Both are defensible; the compound-chain version is much more work and may belong in a spinoff. Decide deliberately and say so. (Ticket text and out-of-scope section lean toward: panels bound to pre-existing DataTypes only, no pipeline building — but confirm.)

### Other requirements

- **Failure semantics:** all-or-nothing, following HEL-363's validate-everything-before-any-write precedent — a bad item fails with zero side effects.
- **Multi-tenancy:** owner-scoped throughout, with explicit cross-user tests. HEL-363 found a cross-tenant existence leak (403 where it should 404) and HEL-384 shipped a real ACL gap — this is a recurring defect class in this codebase. Test for it explicitly.
- Strict `source → pipeline → type → panel` binding still holds; batch-create must not become a way around it.
- Update `schemas/` and the relevant `openspec/` capability spec.

### Scope discipline — do NOT absorb these queued sibling tickets

- HEL-367 (server-side auto-pack layout) — a batch-create endpoint naturally invites "and place them for me." Do not implement layout/placement logic here.
- HEL-366 (resource tagging)
- HEL-368 (panel id key reconciliation)
- HEL-369 (external-run hooks)
- HEL-624 (pie/scatter aggregation)

Note any real dependency on these in the proposal instead of expanding scope to cover them.

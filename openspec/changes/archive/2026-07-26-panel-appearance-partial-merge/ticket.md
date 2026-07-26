# HEL-362: Make the panel appearance PATCH a partial merge (stop replacing PanelAppearance)

## Context

Today a single-item appearance PATCH (`PATCH /api/panels/:id` with an `appearance` field, and the batch path) **replaces the entire** `PanelAppearance`. `PanelServiceHelpers.normalizeAppearancePayload` (`backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala`) builds a **fresh** `PanelAppearance` from the payload — every omitted field falls back to a default: an omitted `chart` becomes `None` (dropping a previously-set `chartType`), an omitted `background` becomes the default tint. `PanelPatchApplier.applyAppearance` then persists that whole object via `panelRepo.updateAppearance`.

This forces two ugly workarounds in the `helio-news` pipeline (`~/Development/helio-news/news/helio_client.py`):

* `_apply_appearance()` must send `chartType` and the sentiment `background` tint **together in one call**, because a second call would wipe the first. The code comment there documents the whole hazard.
* `chart` must be a **complete** `ChartAppearance` (the module-level `CHART_APPEARANCE` constant) on every call — a bare `{"chartType": "bar"}` 400s (the README "Chart types need a full appearance object" gotcha), because there is no partial decoder and the normalizer would otherwise blank the rest of the chart sub-object.

The MCP `update_panel_appearance` tool (`helio-mcp/src/tools/write.ts`) even advertises *"Partial — only the provided fields change"*, which is currently false for anything but the top-level scalar it happens to send.

## Scope

* Change the appearance PATCH path to **merge** the incoming payload over the panel's stored `PanelAppearance` instead of rebuilding from defaults:
  * `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — replace `normalizeAppearancePayload` (or add a merge variant used by the PATCH path) so that a field absent from `PanelAppearancePayload` **preserves the stored value**; only fields present in the payload are validated + applied. Keep create-time behavior (`resolveCreateAppearance`) building from `PanelAppearance.Default` unchanged.
  * `backend/src/main/scala/com/helio/services/PanelPatchApplier.scala` — `applyAppearance` must have access to the existing panel's appearance to merge against (it already loads `existing`); thread the stored appearance into the normalize/merge call.
  * Sub-object merge for `chart`: when the payload carries a partial `chart` (e.g. only `chartType`), merge it over the stored `ChartAppearance` (or `ChartAppearance.Default` when the panel had none) rather than requiring the full object. `PanelAppearancePayload.chart` is typed as `Option[ChartAppearance]` in `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala`; introduce a partial chart payload (all-optional fields) so `{"chart": {"chartType": "bar"}}` is accepted. Keep `chartType` validation (`RequestValidation.validateChartType`).
  * Apply the same merge semantics to the batch appearance path (`validateBatchChartTypes` / batch apply) so single and batch stay consistent.
* Preserve absent-vs-null semantics: absent field = keep stored; if a caller needs to *clear* a field, define explicit-null behavior (document it; a full reset is out of scope unless trivially supported).
* Update the MCP tool description in `helio-mcp/src/tools/write.ts` for `update_panel_appearance` to accurately state true partial-merge semantics (including partial `chart`).
* Update `schemas/panel.schema.json` and any `openspec/` appearance PATCH shape if the wire contract for `chart` changes (partial chart object now valid).

## Acceptance criteria

- [ ] `PATCH /api/panels/:id` with `{"appearance": {"background": "#0a0"}}` on a chart panel that already has a `chartType` returns 200 and the panel **retains** its `chartType` and all other chart sub-fields.
- [ ] `PATCH /api/panels/:id` with `{"appearance": {"chart": {"chartType": "bar"}}}` returns 200 (no longer 400) and sets only `chartType`, leaving `seriesColors`, `legend`, `tooltip`, `axisLabels` at their stored values.
- [ ] Two sequential appearance PATCHes (one setting `chart.chartType`, one setting `background`) leave **both** applied — the second does not wipe the first.
- [ ] An invalid `chart.chartType` (e.g. `"donut"`) is still rejected with 400 on both the single and batch paths.
- [ ] Create-time appearance behavior is unchanged (absent appearance → `PanelAppearance.Default`).
- [ ] ScalaTest coverage for: partial background merge, partial chart merge, sequential-PATCH preservation, invalid chartType rejection, and the batch path.
- [ ] Backward compatible: a client that still sends a full `PanelAppearance` (like helio-news' `CHART_APPEARANCE`) produces an identical result to today.

## Out of scope

* Redesigning the `PanelAppearance` domain model or adding new appearance fields.
* Frontend appearance editor changes (it already sends complete objects; it keeps working).
* A field-clear/reset gesture beyond documenting explicit-null behavior.

## Dependencies

* Relates to HEL-328 (MCP PATCH tools) — the MCP `update_panel_appearance` description is corrected here.
* No hard blockers. Highest-value item in the epic; unblocks removing the `_apply_appearance` workaround and the `CHART_APPEARANCE` constant in helio-news.

## Backward compatibility

Wire change is additive: full `PanelAppearance`/`ChartAppearance` payloads still validate and apply identically. The only behavioral change is that *omitted* fields are now preserved instead of reset — a strict improvement for existing agent clients, none of which rely on the destructive reset.

## Orchestrator notes (from pre-brief, not part of the original ticket)

* **The central hazard**: spray-json omits `Option = None` on the wire. With naive `Option` decoding you cannot distinguish "field omitted" (leave alone) from "field explicitly null" (clear it) — both arrive as `None`. The design must decide, explicitly and in writing:
  - How absent vs explicit-null are distinguished at the wire boundary (e.g. decode from the raw `JsObject` and test key presence, rather than mapping to `Option` first).
  - Whether explicit-null-means-clear is supported at all, or omission is the only semantic (clearing out of scope). Either is defensible — decide deliberately.
  - Whether merge is shallow (top-level fields) or deep (into `chart`). Shallow is probably right for top-level `PanelAppearance`, but `chart` itself needs its own partial-merge (per acceptance criteria) — reconcile this explicitly in the design doc.
* **Test with fields genuinely ABSENT from the JSON**, not merely set to null — that's the test that catches this class of bug.
* Backwards compatibility mandatory: frontend, helio-news, and the MCP server currently send complete appearance objects; behavior for those must be identical after the change.
* Same semantics must apply to both the single-panel PATCH and the batch appearance path.
* Check whether `PATCH /api/dashboards/:id` appearance has the same replace-semantics problem. If so, decide with the design gate whether it belongs in this ticket or a spinoff; file the spinoff if scoped out.
* Update `schemas/` and the relevant `openspec/` capability spec so the contract documents merge semantics.
* Do not touch HEL-344 (epic) or sibling ticket statuses — set only HEL-362 to Done.

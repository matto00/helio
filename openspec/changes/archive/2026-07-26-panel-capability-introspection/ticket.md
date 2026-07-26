# HEL-365: Add panel-capability introspection: given a DataType, return bindable panel types and required field slots

## Context

`helio-news`'s planner is offered a **menu, not a vocabulary** — the single design idea the README credits with making the whole thing work: a model asked to invent panel keys hallucinates; the same model picking from real lines does well. That menu is computed entirely **client-side** in `agents.story_offers()` (`~/Development/helio-news/news/agents.py`), which hand-rolls the logic for "is there enough data to chart? enough columns for a table? a single value for a metric?" and knows out-of-band which `fieldMapping` slots each panel type needs (`chart → {xAxis,yAxis}`, `metric → {value,label?,unit?}`, `timeline → {time,event}`, `collection → base-type slots`). That knowledge lives in the MCP tool descriptions (`helio-mcp/src/tools/write.ts` `bind_panel`) and in the frontend — it is **duplicated by hand in every agent** that targets Helio.

Helio should expose the "menu" itself: given a DataType (its columns/shape and row count), return which panel types are bindable and the field slots each requires. Then any agent computes offers from ground truth instead of re-deriving Helio's binding rules.

## Scope

* **Backend introspection endpoint** — e.g. `GET /api/types/:id/panel-capabilities` returning, for the DataType, the set of bindable panel types and each one's required/optional `fieldMapping` slots + which columns are eligible for each slot (e.g. numeric columns for a metric `value` / chart `yAxis`; a timestamp/orderable column for timeline `time`; any column for `label`/`event`). Include coarse shape signals the menu needs: column list with types, row count / single-row-ness, and whether the type is a pipeline output (only pipeline outputs are bindable — V41).
  * Ground the slot definitions in the real per-type field-mapping contract: `backend/src/main/scala/com/helio/domain/panels/` (`ChartPanel`, `MetricPanel`, `TablePanel`, `CollectionPanel`, `TimelinePanel`, and their `*Config`) and the `bind_panel` slot documentation. Derive slots from the domain, do not hardcode a second copy that can drift — factor a single source of truth (e.g. a `PanelBindingSpec` per `PanelType`) both the bind validator and this endpoint consume.
  * New route under `backend/src/main/scala/com/helio/api/routes/` (DataType-scoped, mirror `DataTypeRoutes.scala`); wire into `ApiRoutes.scala`; logic in a service. Never inline fully-qualified names.
* **MCP surface** — add a `get_panel_capabilities` read tool in `helio-mcp/src/tools/read.ts` + `helio-mcp/src/helioApi.ts` returning the capability payload for a DataType id, so an agent builds its offers menu from the server.
* Update `schemas/` + `openspec/` with the capability response shape.

## Acceptance criteria

- [ ] `GET /api/types/:id/panel-capabilities` returns, for a numeric-heavy multi-row pipeline-output type, `chart` and `table` (and `metric`/`collection` per single-row rules) as bindable, each with its required/optional slots and the eligible columns per slot.
- [ ] A source-companion DataType (non-null sourceId) reports **no** bindable data-panel types (or an explicit `bindable: false` with the V41 reason), matching what binding would actually reject.
- [ ] Slot definitions are derived from the same source of truth the bind validator uses — a test asserts the endpoint's slots for each panel type match the binder's accepted slots (no drift).
- [ ] Response includes column names+types and row-count/single-row shape signals sufficient to reconstruct `story_offers`-style gating server-agnostically.
- [ ] MCP `get_panel_capabilities` tool added + documented.
- [ ] ScalaTest coverage: numeric multi-row type, single-row type (metric-eligible), companion type (not bindable), timestamp-bearing type (timeline-eligible).

## Out of scope

* Any editorial "should this story get a chart?" judgement — that stays in the agent. This endpoint reports **what is technically bindable**, not what is worth showing.
* Recommending chart sub-shape (bar vs line) — the agent decides; this only reports that `chart` is bindable and which columns fit x/y.
* Aggregation planning (panels don't aggregate; that's a pipeline concern).

## Dependencies

* Relates to HEL-345 (Richer Agent Grounding) and the NL/agent-authoring epics (HEL-341 / HEL-342) — this is the grounding primitive their planners would consume. Note for those lanes; build only the introspection here.
* No hard blockers.

## Backward compatibility

Purely additive read endpoint + tool; no existing contract changes.

## Orchestrator pre-brief notes (design-gate concerns to settle)

1. **Source of truth, not a second opinion.** Derive capability logic from the same rules the server enforces at bind time (`Panel.buildQuery` / panel config validation), not a separately hand-written table.
2. **Panel-level aggregation changes the answer.** HEL-292 gave metric panels `{value, agg}` and chart panels `{groupBy, agg, yField}`, aggregating over ALL bound rows. A many-row DataType with one numeric column CAN feed a metric panel now — verify against `ChartPanel.tsx` / panel configs rather than assuming the old "metric needs exactly one row" rule.
3. **Known inconsistency, not ours to fix:** chart aggregation is gated to bar/line only in `ChartPanel.tsx` (`useAggregate = chartAggregate != null && (chartType === "bar" || chartType === "line")`); pie/scatter silently ignore aggregation specs. Filed as HEL-624. If this response advertises chart types, must not promise aggregated pie/scatter that won't render — scope the answer honestly or note the caveat.
4. **Overlap with HEL-399 (shapes work, just shipped)** — already matches shapes to panel kinds in panel-creation flow, keyed off `outputContract.rowCount` (`ExactlyOne` → metric, etc.). Reconcile: share logic or clearly explain why the two are legitimately different questions.
5. **Multi-tenancy.** DataType lookups must be owner-scoped. Test cross-user behavior explicitly (expect 404, not 403, for cross-tenant existence).

## Scope discipline

HEL-364 (compound bound-panel op), HEL-370 (batch panel-create), HEL-366 (resource tagging), HEL-367 (auto-pack layout), HEL-368 (panel id key) are queued behind this ticket. Do not absorb them — note dependencies in the proposal instead of expanding scope.

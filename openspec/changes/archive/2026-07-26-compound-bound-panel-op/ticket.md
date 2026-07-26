# HEL-364: Add a compound bound-panel op: source→pipeline→run→panel→bind in one call

## Context

Building one data panel in `helio-news` costs ~6 sequential MCP round-trips. `HelioClient.build_bound_panel()` (`~/Development/helio-news/news/helio_client.py`) calls, in order: `create_data_source` → `create_pipeline` → N× `add_pipeline_step` → `run_pipeline` → `create_panel` → `bind_panel` → `update_panel_appearance`. Every one is a separate HTTP request through the MCP server, and the whole chain must succeed or the panel is orphaned. A morning run builds dozens of panels this way — the fan-out dominates wall-clock and is the single biggest source of partial-failure states.

The canonical path (DataSource → Pipeline → DataType → Panel) is real and enforced (V41 pipeline-only binding). This ticket adds one server-side compound operation that walks it atomically, so an agent hands over a source spec + steps + panel spec and gets back a bound, rendered panel in a single call.

## Scope

* **Backend compound endpoint** — e.g. `POST /api/panels/bound` accepting one payload: `{ dashboardId, source (inline columns+rows | existing sourceDataSourceId), pipeline { outputDataTypeName, steps[] }, panel { type, title, config, appearance }, fieldMapping }`. Orchestrate the existing services in one flow:
  * `backend/src/main/scala/com/helio/services/DataSourceService.scala` (create source), `PipelineService.scala` (create pipeline + steps), `PipelineRunService.scala` (run to completion — the run is already synchronous), `PanelService.scala` (create + bind).
  * New thin route under `backend/src/main/scala/com/helio/api/routes/`; compose in `ApiRoutes.scala`. Keep the actual logic in a service (e.g. a new `BoundPanelService` or a method on `PanelService`) — no business logic in routes; never inline fully-qualified names.
* **Failure semantics** — if any stage fails, surface which stage failed and its error; do not leave a half-built panel bound to nothing. Prefer cleaning up resources created earlier in the same call on failure, or document clearly what persists.
* **Reuse existing source** — allow `sourceDataSourceId` instead of inline `source`, so an agent can build multiple panels over one source without re-uploading rows.
* **MCP surface** — add a `create_bound_panel` tool in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts` that wraps the endpoint; it should collapse `build_bound_panel`'s 6 calls to one. Reuse the existing per-type `fieldMapping` / `config` shapes documented on `create_panel`/`bind_panel`.
* Update `schemas/` and `openspec/` for the new compound request/response contract.

## Acceptance criteria

- [ ] One `POST /api/panels/bound` call creates the source (or reuses `sourceDataSourceId`), creates+runs the pipeline, creates the panel, binds it to the pipeline-output DataType, and returns the created panel (with ids for the source, pipeline, output DataType, and panel) — with rows already present (synchronous run).
- [ ] V41 pipeline-only binding is still enforced; a config that would bind a source companion is rejected with 400 before any panel is created.
- [ ] A failure at any stage returns a 4xx/5xx naming the failed stage; no dangling bound-to-null panel is left behind.
- [ ] `appearance` (including `chart.chartType`) supplied in the panel spec is applied on creation (no separate appearance call needed).
- [ ] ScalaTest coverage: happy path end-to-end, reuse-existing-source path, V41 rejection, mid-chain failure behavior.
- [ ] MCP `create_bound_panel` tool added + documented; helio-news `build_bound_panel` could be replaced by a single call.

## Out of scope

* Batch/multi-panel creation in one call (that is the separate batch-panel-create ticket, HEL-370) — this op builds exactly one bound panel.
* New pipeline step types or smart-pipeline shape presets (HEL-336 / HEL-337).
* Layout placement of the created panel (see the auto-pack layout ticket, HEL-367).
* Resource tagging (HEL-366) and panel id key (HEL-368) — separate queued tickets, do not absorb.

## Dependencies

* Relates to HEL-362 (partial appearance PATCH) — the panel `appearance` field applied here benefits from partial-merge but does not require it (a full appearance object works).
* Relates to HEL-337 (Smart Pipeline Shapes): a compound op is a natural place to later accept a smart-shape preset instead of explicit steps — note for that lane, do not build it here.
* No hard blockers.

## Backward compatibility

Additive new endpoint + tool. All existing granular tools (`create_data_source`, `create_pipeline`, `bind_panel`, …) remain, so helio-news' current path keeps working until it migrates.

## Orchestrator notes (from pre-brief, not part of the original ticket text)

- This is the fourth ticket of HEL-344 — Agentic Workflow Enablement. Main is at 1589cec0.
- Shipped ahead of this ticket, directly load-bearing:
  - HEL-362 (#297): appearance PATCH partial merge via `Option[Option[T]]` absent-vs-null idiom.
  - HEL-363 (#298): `PUT /api/dashboards/:id/contents` — atomic all-or-nothing replace in a real Postgres transaction (`DashboardContentsOps.replaceContents`), validation before any write. This is the atomicity pattern to follow.
  - HEL-365 (#299): `GET /api/types/:id/panel-capabilities` + `PanelBindingSpec` — server's own answer to which panel kinds can bind to a DataType and what slots they need.
- Critical prior art — do not reinvent:
  - HEL-399 wired panel creation to shape instantiation, composing `expand → createPipeline → createPipelineStep* → run` then binding `dataTypeId`, reusing five pre-existing endpoints, no new backend endpoint.
  - HEL-400 shipped MCP tool `create_pipeline_from_shape`, which calls the shape's `expand` before any write so an invalid shape/params can't leave an orphan pipeline.
  - Design gate must explicitly settle whether this ticket's compound op generalizes/reuses HEL-399/400's path or is a genuinely different composition. Three near-identical chain-composers with divergent failure semantics would be a real design defect.
- Design gate must settle:
  1. Failure semantics (all-or-nothing rollback/cleanup vs. checkpointed return-what-was-created). Pipeline runs are synchronous (verify, don't assume) — the in-process engine writes rows before `POST /api/pipelines/:id/run` returns, making true composition feasible. A pipeline run producing zero rows legitimately is NOT a failure.
  2. Transaction boundary vs. external effects — be concrete about what is/isn't rolled back, following HEL-363's repository-layer-transaction precedent where applicable.
  3. Validation-before-write using HEL-365's `PanelBindingSpec`/panel-capability logic to reject an impossible panel/DataType binding UP FRONT.
  4. Multi-tenancy — every resource in the chain must be owner-scoped; test cross-user behavior explicitly (HEL-363 and HEL-384 both found cross-tenant gaps in similar chains).
  5. Strict `source → pipeline → type → panel` binding still holds — the compound op must not become a way to bypass it.
- Scope discipline: do not absorb HEL-370 (batch panel-create), HEL-366 (resource tagging), HEL-367 (auto-pack layout), HEL-368 (panel id key). Note dependencies in the proposal instead.

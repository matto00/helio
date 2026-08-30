# Pipelines & Outputs Remodel — Design Spec

## Summary

Collapse the six user-facing concepts of today's data chain (Source → Pipeline → DataType → Metric → Panel, plus companion types) into four: **Source → Pipeline → Output → Dashboard**. A pipeline keeps its data-frame-in, data-frame-out contract but now produces **many Outputs** — panel-ready visualizations (metric, chart, table, collection, timeline) attached to any step of the pipeline, each rendered live on the pipeline page from dry or live runs. A dashboard **Panel** becomes a _placement_ of an Output (position, size, title override, light appearance); everything about _what_ is shown lives on the Output and propagates to every dashboard it is placed on. **Data Types**, **Metrics**, **companion types**, and **panel-level aggregation** are retired as user-facing concepts.

The remodel is phased: Phase 1 ships a linear trunk with **leaf tails** (short chains hanging off any trunk step, ending in an Output) on a node-graph data model; Phase 2 adds true branching (parallel lanes that rejoin via join/union) as an editor + engine extension with no further migration. This replaces the design-gated DAG epic (HEL-338) rather than sitting beside it.

## Motivation / evidence

The original intent for DataTypes — "define `User` once, use it in multiple panels across dashboards" (`notes/future-features.md`) — was never buildable. `PipelineRepository.create` (`backend/src/main/scala/com/helio/repositories/PipelineRepository.scala:208-264`) always mints a brand-new empty DataType; there is no path to attach a pipeline to an existing type, and the type's schema is re-derived from run rows on every success (`PipelineRunService.upsertFieldsFromRows`). A type is therefore a pipeline output wearing a second name and a second nav page.

Measured on 2026-08-30:

- **Prod workspace:** 40 sources, 66 pipelines, 115 types (39 companion, 76 output), 4 metrics (all from one session on 2026-08-26), 18 dashboards. Pipeline → type is 1:1 by construction; the 66 → 76 delta is orphans.
- **Dev DB reuse distribution:** of 285 types, 253 have zero panels bound, 17 have exactly one, 15 have two or more. Reuse that exists is _fan-out_ (one output → many panels), which the new model handles better than types ever did.
- **Companion types:** every source auto-creates one (39 of prod's 115 types; 135 of dev's 285), and V41 forbids binding to any of them. `BoundPanelService` implements the static-source path literally as source → zero-step pipeline → run → panel purely so the output has `sourceId = None`.
- **helio-news pattern:** ~20 `news-*-src` static sources → 20 one-step `news-*-pipe` pipelines → 20 `news_out_*` types → mostly one panel each. Three objects per panel for static content.
- **delivery-analytics pattern:** one `fact_issues` source → ten pipelines (`kpi_delivered`, `kpi_backlog`, `kpi_avg_hours`, `dist_cycle`, `epic_counts`, …), most emitting one row, because a one-row output per KPI was the only way to feed a metric panel. Metrics (HEL-418) and panel-level aggregation (HEL-292) were both responses to that pressure, leaving aggregation with three homes.
- **UI encodes the leak:** panel creation is a four-screen wizard (kind → template → _pick a DataType_ → name); metric binding happens later in a different modal; the pipeline page previews output as a table only (`PipelinePreviewModal` → `DataGrid`, no charts); the onboarding checklist literally has to say _"Types are only ever a pipeline's output — you never create one directly."_
- **Sleeper field test (HEL-857):** 25 sources / 43 pipelines / an accumulating pile of orphaned types by the end of one agent-authored build; `get_workspace_context` exceeded the MCP token cap at 220k characters.
- **DAG spike (HEL-361)** lists as a hard constraint "every branch leaf must still yield a bindable pipeline-output DataType" — the exact assumption this spec drops.

Prior art supports the direction: Metabase's _Question_ (query + visualization) placed on dashboards, Redash's visualizations-on-a-query, Looker's Looks. Query-plus-visualization as the unit is what self-serve BI converged on. Grafana's inverse (query inside the panel) fights Helio's materialized-snapshot + schedule model.

## Decisions made in the 2026-08-30 design session

| #   | Decision                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Output owns the visualization; Panel is a placement.** One Output may be placed on many dashboards; editing it updates every placement.                                                                                                                                                     |
| 2   | **Aggregation lives only in pipeline steps.** Outputs are render-only. Metrics registry and panel-level aggregation are retired.                                                                                                                                                              |
| 3   | **Phase 1 = trunk + leaf tails on a node-graph model; Phase 2 = branching.** No second migration.                                                                                                                                                                                             |
| 4   | **Sources stay the pipeline root** and can be created inline from "New pipeline". Companion types retire; the inferred schema lives on the source.                                                                                                                                            |
| 5   | **Name: Outputs** (plural by design — a pipeline has steps and many outputs).                                                                                                                                                                                                                 |
| 6   | **Panel** remains the name for a placement. Nav: **Dashboards · Pipelines · Sources · Connectors · Assistant** (Connectors stays because source kinds keep expanding).                                                                                                                        |
| 7   | Pipeline page = river with inline tails + Output chips **and** an Outputs gallery tab. Phase 2 branches render as parallel lanes in the river that can rejoin.                                                                                                                                |
| 8   | Dashboard "Add panel" = **Output picker modal**, one click places at the next free slot. A library drawer with drag-to-place is a later authoring-feel ticket if earned.                                                                                                                      |
| 9   | Orphan pipeline-output types migrate to a `table` Output rather than being dropped. Deleting an Output cascades to its panels, with a placement-count warning first.                                                                                                                          |
| 10  | `create_pipeline` over MCP is a **single call** that can build source → steps → outputs.                                                                                                                                                                                                      |
| 11  | **No deprecation.** Retired structures (tables, routes, MCP tools, pages, services) are deleted wholesale in the ticket that replaces them — no shims, aliases, dual-read paths, or `@deprecated` tails. The user is the only user of this free product; deprecation would only be tech debt. |
| 12  | **Phase 1 and Phase 2 both land in v0.7 — Beta readiness**, at the front of its queue, Phase 2 immediately after Phase 1. Phase 2 tickets are filed now, fully specified from this spec, blocked on Phase 1. HEL-338/HEL-361 are cancelled; there is no separate DAG design session.          |
| 13  | Migration-created tails carry **no snapshot** until their pipeline next runs; their panels render "run to preview" after the deploy.                                                                                                                                                          |
| 14  | Row-interpolated **`markdown` Outputs ship in Phase 1** as an Output kind (helio-news depends on data-bound markdown).                                                                                                                                                                        |
| 15  | Picker **grid defaults** (12-col desktop, react-grid-layout units): metric 3×2 · chart 6×4 · table 6×6 · collection 6×4 · timeline 4×6 · markdown 4×4. One constants file; mobile uses the existing `mobilePanelHeights` model.                                                               |
| 16  | **The epic + ordered tickets in Linear are the implementation plan.** No separate plan document. Ticket bodies carry scope, acceptance criteria, and blocking relations in Concertino's input format; the next batch agent starts at row 0a of the delivery order.                            |

## Non-goals / explicitly deferred

- **Branching, rejoin, multi-root pipelines in Phase 1** — they are Phase 2 (same milestone, immediately after). The data model supports them from day one; the Phase-1 editor and engine walk restrict tails to non-branching leaf chains.
- **Backward compatibility of any kind** (decision 11). Old routes, tools, tables, and pages are removed in the ticket that replaces them.
- **Per-panel visualization overrides** (a placement forking the Output's config). Rejected in favour of the "edit once, updates everywhere" guarantee. If a user wants a different chart of the same rows, that is a second Output.
- **Cross-filtering (HEL-588)** and **interactive panels (HEL-643)** — design inputs for later epics: filtering operates over materialized snapshots (client-side filter or re-run); actions attach to Outputs.
- **Spark / Dataproc execution parity (HEL-238)** — the engine tree-walk lands behind the `PipelineExecutionBackend` abstraction (HEL-330) so the Dataproc backend inherits the node model; implementing the walk on Spark is that epic's work.
- **Library drawer / drag-to-place** on the dashboard — later, under HEL-347.
- **Templates (HEL-421)** — re-scoped by this spec (a template becomes pipeline + outputs + layout, parameterized by source) but not delivered by it.

## Concept model

| Concept       | What it is                                                                                                                                                                                                           | Owned config                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Source**    | Where data comes from (CSV, REST, SQL, static table, text/markdown, PDF, image). Reusable across pipelines. Carries its own inferred schema.                                                                         | connector/config, `inferredSchema`, refresh |
| **Pipeline**  | Data-frame-in, data-frame-out transform graph over one root source (multi-root arrives with Phase 2). Phase 1: a **trunk** chain plus **leaf tails** — short chains hanging off any trunk step, ending in an Output. | steps (nodes), schedule, run history        |
| **Output**    | A leaf node of the pipeline that says _how to show_ the rows reaching it: kind, field mapping, format, chart/collection/timeline options. Has a derived schema and a row snapshot. Panel-ready.                      | kind + presentation config + derived schema |
| **Dashboard** | A layout of **Panels**: placements of Outputs plus dashboard-native content panels (text, markdown, image, divider).                                                                                                 | layout, appearance, panels                  |
| **Panel**     | A placement of one Output on one dashboard (or a content panel). Owns position/size, optional title override, light appearance.                                                                                      | `outputId`, title override, appearance      |

Invariants (these replace today's "pipeline-only binding" rule):

- Every Output belongs to exactly one pipeline node. An Output can be placed on many dashboards.
- A Panel owns only placement. Everything about _what_ is shown is edited on the Output and propagates to every placement.
- Aggregation exists only as steps. An Output is render-only.
- One pipeline run refreshes every Output of that pipeline atomically — every placement of that pipeline shows the same snapshot.
- Outputs inherit the pipeline's ACL; Panels inherit the dashboard's.

Output kinds in Phase 1: `metric`, `chart`, `table`, `collection`, `timeline`, and `markdown` (a markdown template interpolated from rows — today's data-bound text/markdown panel). Content panels (text, markdown-literal, image, divider) remain dashboard-native and carry no Output.

The first-run story becomes: _connect a source, shape it into outputs, place them on a dashboard._ Three steps, and the middle one happens on a single page with live previews.

## Data model & migration

### Schema changes (one Flyway migration)

| Table            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline_steps` | add `parent_step_id TEXT NULL REFERENCES pipeline_steps(id)` (`NULL` = child of the source root; **no** `ON DELETE CASCADE` — deleting a step **splices**: its position-0 child is re-parented to the deleted step's parent, exactly as today's linear delete re-links the chain, while its tails and the Outputs attached to it are deleted, with a placement-count warning). `position` becomes sibling order. **Trunk** = the position-0 chain from the root; a **tail** = a child at position ≥ 1 and its descendants. The engine walks the tree; only the Phase-1 editor restricts tails to non-branching leaf chains. |
| `outputs` (new)  | `id, pipeline_id (FK CASCADE), node_step_id (FK CASCADE, NULL = root), owner_id, name, kind, config JSONB, schema JSONB, position, tag, created_at, updated_at`. `config` carries per kind what `panels` holds today: `fieldMapping`, `format`, `chartOptions`, `collectionOptions`, `timelineOptions`, `columnWidths`/`columnOrder`/`density`, markdown template. `schema` is derived at run time by the HEL-891 union inference — `DataType.fields` relocated. RLS policy mirrors `pipelines` (owner + grantee read).                                                                                                     |
| `node_snapshots` | `data_type_rows` re-keyed by `(pipeline_id, node_step_id NULL-able, run_id)`. Only **materialized nodes** — nodes with ≥ 1 Output — persist rows, so two Outputs on the same node share one snapshot. RLS policy mirrors `outputs`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `panels`         | discriminator `kind ∈ {output, text, markdown, image, divider}`. Output panels: `output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE`, `title`, `appearance`. Dropped columns: `type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order`. Content panels keep `content`, `image_*`, `divider_*`.                                                                                                                                                                                                |
| `data_sources`   | add `inferred_schema JSONB` (the companion type's fields move here; refreshed by the same `upsertSourceDataType` path, renamed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| dropped          | `metrics`, `data_types`, `data_type_rows`, `pipelines.output_data_type_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Migration steps, in order

1. Companion types → `data_sources.inferred_schema`; companion rows deleted.
2. Each pipeline's steps get `parent_step_id` from their `position` order (pure trunk; `position` reset to 0 for trunk steps).
3. Each bound panel → an Output on its pipeline's last trunk step (root if zero steps), `kind = panel.type`, `config` lifted from the panel's columns, `name = panel.title`. If the panel carried HEL-292 panel-level `aggregation` or a `metric_id`, that becomes a **tail**: an `aggregate` (or `groupBy` + `aggregate`) step under the last trunk step, with the Output on the tail. The metric's `format` becomes the Output's `format`. Panel → `output_id`, `kind = output`.
4. Every remaining pipeline-output type with no panel becomes one `table` Output named after the type on the last trunk step, so no pipeline loses its preview (decision 9).
5. `data_type_rows` copied to `node_snapshots` under the last trunk step. The tails created in step 3 have no snapshot until their pipeline next runs; their Outputs render "run to preview" until then (decision 13 — no in-migration synthesis). Then drop `metrics`, `data_types`, `data_type_rows`, `pipelines.output_data_type_id`.

The migration is proved by a red-first test against a prod-shaped snapshot (see Testing).

### Read path

`panel → output → node_snapshot`. Public/shared dashboards resolve the same way on the existing optional-auth route. `GET /api/types/:id/rows` becomes `GET /api/outputs/:id/rows`. Dashboard export/import serializes Outputs by reference (`pipelineId`, `outputId`); an import requires the pipeline to exist — the same rule as types today.

## Engine

`InProcessPipelineEngine`'s `foldLeft` over a step list becomes a tree walk:

1. Load the root frame from the source.
2. Walk the trunk in order. At each node, before advancing, evaluate every tail from that node's frame (each tail is its own short fold).
3. At every **materialized node** (≥ 1 Output), persist the frame as a `node_snapshot` and derive each Output's `schema` via the HEL-891 shallow union inference. Non-materialized frames are not persisted.
4. Run status, per-step row counts (SSE), and assertion results extend naturally: row counts are reported per node id, tails included.

Dry runs walk the same tree in memory and return per-Output preview rows — the data behind inline chart previews on the pipeline page and behind `preview_outputs` over MCP.

The walk lands behind `PipelineExecutionBackend` (HEL-330, sequenced before this) so Dataproc (HEL-238) inherits the node model. A pure trunk must produce byte-identical output to today's `foldLeft` (parity test).

## API & contracts

New/changed REST surface (all under the existing authenticated tree; `schemas/` + `openspec/` updated in the same change as the code):

- `POST /api/pipelines` — accepts `sourceId` **or** an inline source spec, optional `steps[]` (each with optional `parentStepId`), optional `outputs[]`. One call can build source → trunk → tails → outputs.
- `POST /api/pipelines/:id/steps` — gains `parentStepId` (default: append to trunk).
- `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs/:id/rows`, `GET /api/outputs/:id/panels` (placements — powers the delete warning).
- `POST /api/pipelines/:id/preview` — dry run returning per-Output preview rows (`?outputId=` to scope).
- `GET /api/pipelines/:id/capabilities?stepId=` — which Output kinds/slots are bindable at that node, evaluated against the node's projected schema. Same `PanelBindingSpec` logic, relocated; replaces `GET /api/panels/capabilities`.
- `POST /api/pipeline-shapes/:id/expand` — unchanged mechanics, but expansions now target a `parentStepId` and may include an `outputs[]` block ("add Outputs from a shape").
- `POST /api/panels` — `{ dashboardId, kind: "output", outputId, title?, layout? }` or a content-panel body. `PATCH /api/panels/:id` keeps only placement fields. `POST /api/panels/bound` is removed.
- Removed: `/api/types/*`, `/api/metrics/*`, `/api/panels/:id/binding`, `/api/panels/capabilities`.

Schemas (`schemas/`, JSON Schema 2020-12): new `schemas/outputs/` (`output`, `create-output-request`, `update-output-request`, `output-capabilities-response`, `preview-outputs-response`); `schemas/panels/panel.schema.json` and `create-panel-request` reshaped around `kind`/`outputId`, with `bound-panel-request/response`, `panel-capabilities-response`, and `panel-query` removed; `schemas/pipelines/create-pipeline-step-request.schema.json` gains `parentStepId` and a new `create-pipeline-request` carries the single-call shape; the source schemas gain `inferredSchema`; `schemas/metrics/` and `schemas/data-types/` removed; `schemas/dashboards/dashboard-proposal.schema.json` and `pipeline-proposal.schema.json` re-target to Outputs; the export/import snapshot bumps its version. OpenSpec capability specs follow the same additions/removals in the same change.

## Pipeline page UX

Layout (decision 7): the existing vertical river of step cards stays as the **trunk**. Each trunk step card carries an **Outputs rail** — chips for Outputs attached directly to that step, each showing a live thumbnail (metric value, sparkline-sized chart, table skeleton) from the last dry or live run. A **tail** renders as an indented, dashed mini-chain under its parent step, ending in its Output chip. An **Outputs** tab beside Steps shows every Output as a gallery card rendered live, with its placement count and a **Place on dashboard** button.

Interactions:

- **Add output** on any step → choose kind → the Output sheet opens with the node's projected schema, slot eligibility from `capabilities`, and a live preview from the last frame. Kinds needing an aggregate the node does not have offer "add as tail with an aggregate step" (authoring sugar — it inserts a real `aggregate` step; the Output stays render-only).
- **Add step to tail** — a tail's mini-chain accepts the same step ops as the trunk; the Phase-1 editor refuses branching within a tail.
- Clicking an Output chip or gallery card → side sheet: config, full preview, placements list (with links), Place, Delete (warns with placement count).
- **Start from a shape** now offers "add Outputs from a shape" against a chosen step.
- Run / Dry run behave as today; SSE row counts render on trunk and tail steps.

"New pipeline" (decision 4) offers: pick an existing source · paste a table · upload CSV · REST via a connector + endpoint. It creates the source if needed and lands on the pipeline page with the root previewed.

Phase 2 adds parallel lanes: a trunk step may have multiple step children rendered side by side; `join` / `union` / `lookup` accept "other lane" as an input alongside "other source". No data-model change.

## Dashboard UX

**Add panel** (decision 8) opens the **Output picker**: searchable, grouped by pipeline, each Output rendered live with its placement count and an "already on this board" state; one click places it at the next free grid slot with the kind's default size (decision 15: metric 3×2 · chart 6×4 · table 6×6 · collection 6×4 · timeline 4×6 · markdown 4×4). Content panels (text, markdown, image, divider) are a row at the bottom. "No output fits?" links to New pipeline and the Assistant. The picker is keyboard- and mobile-safe and has the same semantics as an agent's `place_outputs` call.

**Panel edit sheet** is deliberately small: title override, size (drag on grid), appearance, a link to the Output on its pipeline, and **Swap output**. Any request to change chart type or fields links out to the Output with an "updates N dashboards" note.

Removed: `PanelCreationModal` and its `creationSteps/*`, `BindingEditor`, `MetricPicker`/`MetricBindingFields`, `TypeRegistryPage`/`TypeDetailPage`, `MetricsPage`/`MetricDetailPage`/`CreateMetricModal`/`MetricEditorForm`. `sections.ts` loses `registry` and `metrics`. Onboarding copy becomes three steps: connect a source · shape it into outputs · place them on a dashboard.

## Agent / MCP surface & proposals

**Changed tools**

- `create_pipeline` — `sourceId` **or** inline source spec; optional `steps[]` (with `parentStepId`); optional `outputs[]`. Single call builds everything (decision 10).
- `add_pipeline_step` — gains `parentStepId`.
- `create_pipeline_from_shape` → `add_outputs_from_shape(pipelineId, stepId?, shape, params)`.
- `create_panel` / `create_panels` / `bind_panel` / `create_bound_panel` → `place_outputs(dashboardId, [{ outputId, title?, w?, h? }])` and `create_content_panel`. `update_panel` keeps placement fields only.
- `get_panel_capabilities` → `get_output_capabilities(pipelineId, stepId?)`.
- `get_workspace_context` drops types and metrics; lists pipelines with their outputs (kind, schema, placements) and sources with `inferredSchema`. Expected to materially shrink the payload that hit the token cap during the Sleeper build.

**New tools:** `add_output`, `update_output`, `delete_output`, `list_outputs`, `get_output_rows` (replaces `get_data_type_rows`), `preview_outputs(pipelineId, outputId?)`.

**Removed tools:** `list_data_types`, `update_data_type`, `delete_data_type`, `get_data_type_rows`, `list_metrics`, `get_metric`, `create_metric`, `update_metric`, `delete_metric`, `bind_panel`, `create_bound_panel`, `get_panel_capabilities`.

**Proposals.** `DashboardProposal`, `PipelineProposal`, combined proposals, and patch sets re-target to Outputs: a proposal proposes a pipeline (steps + outputs) and a dashboard (placements + content panels). Validation grounds each Output's field mapping against the projected schema at its node — `PipelineAnalyzeService`'s projection walked per node. Review pages render Output previews instead of "panel bound to type X". Patch-set undo semantics are unchanged: a patch is still add/remove/modify of nodes and placements, and the inverse builders are rewritten for nodes/outputs (absorbing HEL-766).

The propose → review → apply boundary is untouched: `apply` is never a tool in the in-app assistant.

## Authorization & RLS

Outputs inherit the pipeline's ACL (like steps). Panels inherit the dashboard's. Public dashboards read snapshots via `panel → output → node_snapshot` on the existing optional-auth route. RLS policies move from `data_types`/`data_type_rows` to `outputs`/`node_snapshots`, `RlsPolicyGuardSpec` gains both tables, and the migration ticket includes a prod-shaped RLS smoke test under a non-superuser role — the one place the dev/CI RLS-parity gap (policies never run locally because both connect as superuser) bites this work.

## Retirements

Removed outright: Data Types page + `/registry` routes + `DataTypeRoutes`; Metrics page + `metrics` table + `MetricRoutes`/`MetricService`/`MetricRepository` + 5 MCP tools; companion types; HEL-292 panel-level aggregation; the four-screen `PanelCreationModal`; `BindingEditor` (its logic becomes the Output editor); `pipelines.output_data_type_id`; `BoundPanelService`'s zero-step-pipeline synthesis.

## Delivery order (locked 2026-08-30)

Everything below lands in **v0.7 — Beta readiness** at the front of its queue unless a milestone column says otherwise (decision 12). Rows are a strict sequence except where "parallel" is stated. **The next Concertino batch starts at row 0a and proceeds top to bottom.** "Absorbs" tickets are cancelled in Linear with a pointer to the absorbing row, and their substance becomes acceptance criteria of that row (decision 11 — fold, don't deprecate). "Retargets" keep their ID with a rewritten description and a blocking relation on the named row. Each P-row is one Concertino ticket; the epic is filed alongside them (decision 16).

### Prerequisites (existing tickets, behaviour-preserving)

| Row | Ticket                                                                      | Blocked by | Notes                                                                                  |
| --- | --------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| 0a  | HEL-330 Extract `PipelineExecutionBackend`                                  | —          | The engine tree-walk lands behind it; Dataproc (HEL-238) inherits the node model.      |
| 0b  | HEL-842 `RlsPolicyGuardSpec` gains `audit_events` + `connector_credentials` | —          | Parallel with 0a. Lands before P1.1 adds `outputs`/`node_snapshots` to the same guard. |
| 0c  | HEL-725 PageShell / PageHeader / PageStatus primitives                      | —          | Parallel with 0a–P1.3. Rebuilt pages in P1.5/P1.6 use them.                            |
| 0d  | HEL-720 Shared base form for text/pdf/image sources                         | —          | Parallel with 0a–P1.3. Inline source creation in P1.5 reuses it.                       |

### Phase 1 — Outputs on a trunk with leaf tails

| Row  | Ticket                                                                                                                                                                                                                                                                                                                                                       | Blocked by                              | Absorbs (cancel → fold as AC)                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P1.1 | **Model + migration** — `outputs`, `parent_step_id` (splice-on-delete), `node_snapshots`, `data_sources.inferred_schema`; the five migration steps; drop `metrics`/`data_types`/`data_type_rows`/`output_data_type_id`; delete the Metric and DataType repositories/services/domain models; RLS policies + guard spec; red-first prod-shaped migration test. | 0a, 0b                                  | HEL-689, HEL-615, HEL-864, HEL-642                                                                                     |
| P1.2 | **Engine tree-walk** — behind `PipelineExecutionBackend`; materialized-node snapshots; per-node schema derivation; per-Output dry-run previews; SSE row counts per node; parity test against the old `foldLeft`.                                                                                                                                             | P1.1                                    | HEL-744 (raised to High), HEL-334                                                                                      |
| P1.3 | **API + contracts** — Output routes, panel reshape, single-call `create_pipeline`, capabilities-at-node, `schemas/` + OpenSpec; delete type/metric/binding/capabilities routes and `BoundPanelService`.                                                                                                                                                      | P1.2                                    | HEL-722, HEL-895, HEL-638, HEL-644, HEL-892, HEL-877, HEL-876                                                          |
| P1.4 | **helio-mcp + proposals** — tool retarget (add/remove list in the MCP section), `get_workspace_context` slimming, proposal grounding per node, patch-set inverse builders for nodes/outputs, review pages; the Sleeper rebuild as the acceptance test.                                                                                                       | P1.3 (parallel with P1.5, P1.6)         | HEL-882, HEL-658, HEL-648, HEL-631, HEL-766, HEL-848, HEL-670, HEL-641, HEL-640. HEL-865 stays open, partly delivered. |
| P1.5 | **Pipeline page** — river with tails + Output chips + Outputs gallery tab + Output sheet with live previews; "New pipeline" with inline source; shapes as "add Outputs from a shape"; `markdown` Output kind (decision 14).                                                                                                                                  | P1.3, 0c, 0d (parallel with P1.4, P1.6) | HEL-682, HEL-676, HEL-878, HEL-681, HEL-629, HEL-621, HEL-622, HEL-731                                                 |
| P1.6 | **Dashboard + nav + onboarding** — Output picker with grid defaults (decision 15), panel sheet, nav = Dashboards · Pipelines · Sources · Connectors · Assistant, three-step onboarding copy; delete `PanelCreationModal`, `BindingEditor`, Metric* and Type* pages/components.                                                                               | P1.3, 0c (parallel with P1.4, P1.5)     | HEL-467, HEL-743, HEL-653, HEL-654, HEL-810, HEL-784, HEL-789, HEL-793, HEL-794, HEL-792, HEL-490                      |
| P1.7 | **Public dashboards, export/import, docs** — public read path via `panel → output → node_snapshot`, snapshot schema bump, `README.md` "How data flows", `docs/agent-native.md`, `CLAUDE.md` endpoint list, helio-news + delivery-analytics rebuild scripts, Playwright E2E with interaction counts.                                                          | P1.4, P1.5, P1.6                        | HEL-626, HEL-628                                                                                                       |

### Phase 2 — branching (same milestone, immediately after)

| Row  | Ticket                                                                                                                                                                                                 | Blocked by | Absorbs                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------- |
| P2.1 | **Engine: multi-child walk** — a trunk node may have several step children; `join` / `union` / `lookup` accept "other lane" as an input alongside "other source"; rejoin semantics; per-lane previews. | P1.7       | HEL-338, HEL-361 (cancelled — no design session; the model is decided here) |
| P2.2 | **Editor: parallel lanes** — lanes rendered side by side in the river, lane-aware Output rail, add-lane / rejoin affordances, per-lane SSE row counts.                                                 | P2.1       | —                                                                           |
| P2.3 | **Multi-root pipelines** — several source roots per pipeline (model + API + inline source per root), lanes originating at any root.                                                                    | P2.1       | —                                                                           |
| P2.4 | **MCP + proposals for branching** — multi-child `parentStepId`, lanes in `get_workspace_context`, grounding per lane, `create_pipeline` accepting a full graph.                                        | P2.2, P2.3 | —                                                                           |

### After Phase 2 (retargets, in order)

| Row | Ticket(s)                                                         | Milestone | Blocked by | Retarget                                                                              |
| --- | ----------------------------------------------------------------- | --------- | ---------- | ------------------------------------------------------------------------------------- |
| R1  | HEL-551 → HEL-558, HEL-563, HEL-571, HEL-577, HEL-586 (templates) | v0.7      | P2.4       | Template = pipeline (steps + outputs) + dashboard layout, parameterized by source.    |
| R2  | HEL-503 global search                                             | v0.7      | P1.7       | Entities = dashboards / pipelines / outputs / sources.                                |
| R3  | HEL-489, HEL-501, HEL-508, HEL-582 (freshness / alerts)           | v0.9      | P1.7       | Per pipeline / per Output.                                                            |
| R4  | HEL-583 glob multi-file read                                      | v0.9      | P1.7       | "→ single source", not "single DataType (union)".                                     |
| —   | HEL-831, HEL-832, HEL-833, HEL-835 design-system sweeps           | any       | —          | Scope excludes files retired by P1.5/P1.6.                                            |
| —   | HEL-643 interactive panels, HEL-588 cross-filtering               | later     | —          | Design inputs only: actions attach to Outputs; filtering over materialized snapshots. |

## Testing strategy

Tests that prove the remodel, not just pass:

- **Migration, red-first:** run against a prod-shaped snapshot (18 dashboards / 66 pipelines / 115 types / 4 metrics), asserting panel count preserved, every panel resolves placement → output → pipeline, tails created for every HEL-292/metric panel, and row-for-row snapshot equality before/after for every materialized node.
- **Engine parity:** a pure trunk produces byte-identical output to today's `foldLeft`; tails evaluate from the correct parent frame; only materialized nodes persist; dry-run previews equal live-run snapshots for the same input.
- **RLS smoke:** non-superuser role against `outputs`/`node_snapshots`, including the public-dashboard read path.
- **E2E (Playwright):** source → pipeline → three Outputs → placed on a dashboard, with the interaction count documented against today's path (today: ≥ 4 screens / ~5 clicks per panel after the pipeline exists).
- **MCP E2E:** the four Sleeper dashboards rebuilt through the single-call surface from a clean workspace — HEL-857's exit criterion reused as this epic's acceptance test.
- **Contract:** `schemas/` + OpenSpec drift checks already in the pre-commit gate; helio-mcp typecheck (HEL-797) should be gated before P1.4.

## Release / compatibility

Breaking API and MCP change with **no deprecation period** (decision 11): retired routes, tools, tables, pages, and services are deleted in the ticket that replaces them, and helio-mcp ships the new tool set only. The only compatibility artifact is the tool rename table in the MCP section, kept in `docs/agent-native.md` for the user's own scripts. The helio-news and delivery-analytics rebuild scripts are updated in P1.7. The single-user, free, pre-beta status is what makes this safe; the spec should be revisited if a second user appears before P1.7 lands.

No data is dropped by the migration: every bound panel keeps its data, every orphan output type becomes a table Output, and companion schemas move onto sources. Migration-created tails render "run to preview" until their pipeline next runs (decision 13).

## Appendix A — Linear triage (from the 2026-08-30 pass over 340 open tickets)

Applied in Linear when the epic and P-tickets are filed (decision 16), so every cancellation carries a pointer to the row that absorbs it. The row assignments are authoritative in the Delivery order section; this is the flat view.

**Cancelled → folded as acceptance criteria of a P-row (38):** HEL-467, HEL-743, HEL-653, HEL-654, HEL-810, HEL-784, HEL-789, HEL-793, HEL-864, HEL-615, HEL-642, HEL-682, HEL-676, HEL-878, HEL-681, HEL-334, HEL-794, HEL-792, HEL-848, HEL-338, HEL-361, HEL-895, HEL-638, HEL-644, HEL-892, HEL-877, HEL-876, HEL-722, HEL-641, HEL-640, HEL-626, HEL-628, HEL-490, HEL-670, HEL-621, HEL-622, HEL-731, HEL-689. Also folded: HEL-882, HEL-658, HEL-648, HEL-631, HEL-766, HEL-744 (these six are the file-split / rollback / empty-aggregate tickets that P1.1–P1.4 rewrite through).

**Retargeted — ID kept, description rewritten, blocked on a P-row (14):** HEL-551, HEL-558, HEL-563, HEL-571, HEL-577, HEL-586 (R1); HEL-503 (R2); HEL-489, HEL-501, HEL-508, HEL-582 (R3); HEL-583 (R4); HEL-643, HEL-588 (design inputs, no blocking relation).

**Sequenced, unchanged in substance:** HEL-330 (0a), HEL-842 (0b), HEL-725 (0c), HEL-720 (0d); HEL-831/832/833/835 scope excludes retired files; HEL-857's exit criterion is P1.4's acceptance test and HEL-865 stays open, partly delivered by context slimming.

**Unaffected (~290):** connectors/ingestion (v0.9), mobile (v0.8), security/retention, alerting, observability, theming, in-panel data grid (HEL-351 — table Outputs render the same), dashboard authoring feel minus HEL-467, dev-tooling/readiness tail. HEL-730 and HEL-883 stay dashboard-level.

## Resolved follow-ups (2026-08-30)

All open questions were resolved in the design session and recorded as decisions 11–16 above: no deprecation (11); Phase 1 and Phase 2 in v0.7 with Phase 2 tickets filed now (12); migration-created tails carry no snapshot until the next run (13); `markdown` Outputs ship in Phase 1 (14); picker grid defaults fixed (15); the epic + ordered tickets are the plan (16). Nothing remains open before ticket filing.

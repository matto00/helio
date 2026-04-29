# Helio — Product Roadmap — v2

**Last updated:** 2026-04-28
**Baseline:** v1.0 released — panel types, data ingestion, TypeRegistry, core dashboard grid
**Builds on:** [roadmap.md](roadmap.md)

---

## Roadmap Philosophy

V1.0 established the structural foundation: panel types, data ingestion via TypeRegistry, and the core dashboard grid. The v1.x series is about **making the product feel finished and powerful** before widening the surface area.

Priority order:

1. Elevate the interaction model (zoom, sizing, panel detail)
2. Expand panel expressiveness (cosmetic types, robust creation)
3. Harden the data pipeline (split views, define transformation primitives)
4. Lay groundwork for unstructured data and agentic capabilities

---

## v1.1 — UX Foundations

> **Linear project:** `Helio v1.1 — UX Foundations`
> Dashboard zoom and panel content sizing. Makes the product feel navigable and well-proportioned.

---

### Epic: Dashboard Zoom

A zoom level control in the dashboard toolbar. All panels and their content scale proportionally. Grid editing remains functional at all zoom levels.

- Add zoom level to dashboard UI state (Redux; not persisted — resets on load)
- Zoom toolbar control: discrete steps at 50% / 75% / 100% / 125% / 150%
- Apply CSS scale transform to the panel grid at the current zoom level
- Ctrl+scroll (desktop) and pinch (trackpad) gesture support
- Verify grid drag-resize and panel editing remain functional at non-100% zoom

### Epic: Batch Update & Write Efficiency

Currently, every panel and dashboard change results in an individual API call. As user preferences (zoom, layout, appearance) multiply, this becomes a network and write overhead problem. Consolidate into a batch update strategy.

- Audit current write paths: identify all individual PATCH calls made during a normal dashboard session (layout changes, appearance, zoom, panel moves/resizes)
- Design a batch update API: a single endpoint (e.g., `POST /api/dashboards/:id/batch`) that accepts an array of typed operations (panel update, layout update, preference update) and applies them transactionally
- Frontend: accumulate pending changes in Redux; flush to the batch endpoint on a debounce interval (extend the existing 250ms layout debounce to cover all write types)
- Persist zoom level as a user preference via the batch endpoint (resolves Open Question 5)
- Ensure optimistic UI updates in Redux are not blocked by the flush — changes apply locally immediately, server confirms asynchronously

### Epic: Panel Content Sizing

Panel content should fill its container meaningfully at default sizes rather than centering small elements in large boxes.

- Design audit: document current padding, font sizes, and element sizing per panel type (design task, produces a spec)
- Implement CSS container queries (or equivalent) for panel content re-flow as panel dimensions change
- Apply sizing system to metric panel
- Apply sizing system to chart panel
- Apply sizing system to text panel
- Apply sizing system to table panel

---

## v1.2 — Panel System

> **Linear project:** `Helio v1.2 — Panel System`
> Cosmetic panel types, a rebuilt creation flow, and a full-screen detail/edit view.

---

### Epic: Cosmetic Panel Types

New panel types that display content without requiring a DataType binding. Usable immediately on creation.

- **Markdown panel:** CommonMark renderer; editable content field; no data binding required
- **Image panel:** static image via URL or file upload; renders within panel bounds with configurable fit (contain / cover / fill)
- **Divider panel:** horizontal or vertical rule; configurable weight and color; purely cosmetic
- **Embed panel:** iframe with configurable URL; URL allowlist enforced server-side for security

### Epic: Robust Panel Creation

Replace the current minimal creation form with a type-first modal that guides the user and provides visual feedback.

- Type-first creation modal: user selects panel type before configuring anything else
- Panel type picker: visual card per type with icon, name, and one-line description
- Starter templates: 2–3 preset configurations per panel type (e.g., "KPI Metric", "Time-series line chart", "Data summary table")
- Live inline preview: panel preview updates as the user configures during creation
- Modal accessibility: Escape key and click-outside dismiss the modal

### Epic: Panel Detail View

Click any panel to open a full-screen modal. Two modes: view (read-only, content at maximum size) and edit (all customization in one place).

- Panel click handler opens detail modal; grid editing is not triggered by a click on the panel body
- View mode: panel content rendered at maximum available modal size; read-only
- Edit mode toggle within modal (button + keyboard shortcut `E` from view mode)
- Edit mode: consolidate all panel settings — appearance, data binding, field mapping, refresh interval — replacing the current customization popover
- Explicit Save / Cancel in edit mode (no auto-save on every field change)
- Keyboard shortcut `Esc` closes modal from view mode; confirms discard from edit mode if unsaved changes exist

---

## v1.3 — Data Pipeline & Registry Hardening

> **Linear project:** `Helio v1.3 — Data Pipeline & Registry Hardening`
> Separate Data Sources, Data Pipelines, and Type Registry into distinct first-class views. Establish the pipeline as the canonical transformation layer. Type Registry becomes the only binding target for panels.

**Architecture:**
```
Data Source  →  Data Pipeline  →  Type Registry  →  Panel
(raw data)      (transformations)  (named schema)    (display)
```

---

### Epic: Navigation & View Split

Split the current combined data section into three independent top-level views in the sidebar.

- Add **Data Pipelines** as a top-level sidebar nav item with its own route
- Data Pipelines list view: list all pipelines, show source, output type, last-run status
- Data Pipelines detail view: scaffold (wire up route, empty state, create button)
- Refactor **Data Sources** into its own standalone section (currently shares space with Type Registry)
- Refactor **Type Registry** into its own standalone section

### Epic: Data Pipeline Editor

> **Design session required before ticketing sub-issues.** Key questions: visual metaphor (node graph vs. step list?), data preview model at each step, error model when source schema changes. Design session produces a wireframe and resolves these questions; sub-issues below are then estimated and scheduled.

- Design session: wireframe pipeline editor UX; resolve visual metaphor, preview model, error model
- Pipeline data model: backend schema (pipeline, pipeline_steps tables) + CRUD API
- Pipeline create/edit flow: basic scaffolding wired to API
- Pipeline execution engine (backend): apply ordered steps to source data, return preview rows
- **Operations (one issue each):**
  - Select fields — choose which source fields to include
  - Rename field — rename a source field to a canonical output name
  - Cast type — override the inferred type for a field
  - Filter rows — keep rows matching a condition (field / operator / value)
  - Compute field — add a derived field via an expression (e.g., `revenue / users`)
  - Aggregate — group by one or more fields; apply sum / count / avg / min / max
  - Limit — cap output to N rows
  - Sort — order output by a field asc / desc
- Step-by-step data preview: after each step, show a sample of the current output rows in the editor

### Epic: Pipeline Execution — Manual Run & Dry-Run

User-triggered pipeline execution from the pipeline tab. The backend runs the pipeline and writes output to the DataType snapshot.

- Pipeline run button in the pipeline editor/detail view
- Dry-run mode: execute all steps and return a preview of the output rows without writing to the Type Registry
- Overwrite mode (v1.3 default): full replacement of the current DataType snapshot on each run
- Run status indicator: in-progress / succeeded / failed with error message
- "Last run" timestamp and row count displayed in the pipeline list and detail view

### Epic: Spark Integration *(Stretch within v1.3)*

Self-hosted Apache Spark as the pipeline execution backend for optimized, scalable processing. Decouples pipeline execution from the application server.

- Self-hosted Spark cluster setup and configuration (infrastructure)
- Pipeline execution engine submits jobs to Spark instead of running in-process
- Job submission API: pipeline definition serialized to a Spark job; results written back to the DataType snapshot
- Async job tracking: run status (queued / running / succeeded / failed) polled from Spark
- Job history & logs: per-pipeline run history with duration, row count, and error output accessible in the pipeline tab

### Epic: Spark-Backed Panel Queries *(Stretch within v1.3)*

Once pipelines run on Spark, panel data reads should also go through Spark rather than querying the DataType snapshot store directly. This gives panels the full power of Spark for filtering, aggregation, and field projection at query time — and keeps the execution model consistent end-to-end.

- Panel query model: each panel emits a structured query (selected fields, filters, sort, limit) derived from its field mapping configuration
- Panel query executor: submits panel queries to Spark instead of reading directly from the snapshot
- Result streaming / pagination: handle large result sets gracefully (Spark returns results in pages; panel displays first N rows with load-more)
- Query pushdown: filters and aggregations defined in the panel are pushed into the Spark query rather than applied in-memory on the frontend
- Performance baseline: establish acceptable panel load time targets; profile and optimize Spark query plans for common panel types

### Epic: Type Registry as Defacto Panel Source

Enforce the pipeline → DataType → Panel binding chain. Panels may no longer bind directly to raw Data Sources.

- Remove the direct Data Source → Panel binding path from the frontend and API
- Panel creation: require DataType selection (sourced from Type Registry)
- Empty state when no DataTypes exist: prompt user to create a pipeline first, with a link to the pipeline creation flow
- Migration: identify any existing panels bound directly to a source; display an inline warning prompting the user to attach a pipeline

---

## v1.4 — Unstructured Data *(Stretch)*

> **Linear project:** `Helio v1.4 — Unstructured Data`
> Extend sources and the Type Registry to handle unstructured content. Foundation for agentic workflows.

---

### Epic: Unstructured Source Types

- **PDF connector:** extract text content per page or as a full-document string; register page number and character count as metadata fields
- **Plain text / Markdown connector:** ingest `.txt` and `.md` files; content as a single string field
- **Image connector:** store as binary reference; register filename, dimensions, and MIME type as metadata fields

### Epic: Unstructured DataTypes & Pipeline Operations

- Content field type in Type Registry: string-body or binary-ref, distinguished from structured fields
- Unstructured type indicator in the Type Registry list view
- Text pipeline operations:
  - Split by paragraph / heading
  - Extract headings (returns array of strings)
  - Chunk by approximate token count (for LLM context windows)

---

## v2.0 — Agentic Dashboard Creation *(Future)*

> **Linear project:** `Helio v2.0 — Agentic Dashboard Creation`
> An AI agent creates dashboards from a natural-language goal using the user's registered DataTypes, pipelines, and sources as context.
> **Prerequisites:** v1.3 complete (stable Type Registry); v1.4 preferred (unstructured types expand context surface).

---

### Epic: Agent Integration

- Context builder: serialize the current workspace's DataTypes (field names, types), pipeline definitions, and available Data Sources into a structured prompt context
- Agent API integration: send user goal + context to external model API (Claude); receive structured dashboard proposal (JSON)
- Proposal review UI: display the proposed dashboard layout and panels before applying — user can accept, edit, or reject
- Apply proposal: create dashboard + panels via existing API from the accepted proposal payload

---

## Open Questions

These should be resolved before or during v1.3 design:

1. **Pipeline versioning:** ✅ **Resolved (v1.3):** Pipelines are live and schema-aware. When a source schema changes, the pipeline editor surfaces a lint-style warning highlighting steps that reference removed or renamed fields. The user resolves conflicts manually. No versioning in v1.3. **Long-term (post-v1.3):** Revisit immutable pipeline versions (snapshots per save, explicit schema upgrade flow) once live conflict resolution proves insufficient at scale.
2. **Pipeline scheduling & caching:** ✅ **Resolved (v1.3):** Manual runs only. The user triggers a pipeline run from the pipeline tab; output overwrites the current DataType snapshot (append mode deferred). Dry-run option shows a preview of what would be written without committing. Panels read from the last committed snapshot and display a "last updated" timestamp. **Long-term:** Scheduled execution (server-side cron per pipeline) is the target; execution API should be designed so a scheduler can call the same run path as the manual trigger. See also: Spark Integration epic in v1.3.
3. **Multi-source pipelines (join):** ✅ **Resolved:** Deferred to post-v1.3 (candidate for v1.4–v1.5). Single-source pipelines cover the majority of v1.3 use cases. Multi-source (join) and multi-output pipelines are a follow-on scope item. Spark as the execution backend makes the backend implementation straightforward when the time comes; the UI is the primary complexity.
4. **Type Registry namespacing:** ✅ **Resolved (v1.3 stretch):** Search + tags. Flat list with name search is sufficient at launch; user-defined tags added when users accumulate enough types to feel the pain. No folder hierarchy. **Long-term:** Sub-types (a type that extends or narrows a parent type's schema) are planned; when sub-types land, an ontology view grouped by tag — showing type inheritance relationships — becomes the natural navigation surface for the registry.
5. **Zoom persistence:** ✅ **Resolved:** Per-user per-dashboard (auth has already landed). Zoom is a personal viewing preference, not part of the dashboard definition. Stored as a lightweight user preference row; does not affect other users' view of the same dashboard. Implemented as part of the batch update epic in v1.1 (see below).

# HEL-400: Smart shapes: agent/MCP surface (instantiate a shape from propose_dashboard / create_pipeline)

## Context

Agents should be able to instantiate a smart shape instead of hand-assembling steps, so `propose_dashboard` / `create_pipeline` flows can say "make a time-series of X by month" in one call. Built on the shape abstraction + catalog (HEL-391). The MCP server lives in `helio-mcp/`; pipeline tools are in `helio-mcp/src/tools/write.ts`.

## Scope

MCP (`helio-mcp/`):

- Expose the shape catalog to agents (either a `list_pipeline_shapes` tool reading `GET /api/pipelines/shapes`, or documented in an existing tool's description).
- Add a way to instantiate a shape: e.g. a `create_pipeline_from_shape` tool (source + shape id + params → pipeline + output DataType), or a `shape` parameter path on `create_pipeline`. Mirror the existing `create_pipeline` / `add_pipeline_step` registration pattern in `helio-mcp/src/tools/write.ts`. Update tool descriptions with the shape ids + params shapes.
- If `propose_dashboard` can reference shapes in its proposal payload, thread that through.

Backend:

- Reuse the shape instantiation service path from the panel-declares-shape ticket (no duplicate logic). If a new authenticated endpoint is needed for shape instantiation, add it under `backend/src/main/scala/com/helio/api/routes/` and wire into `ApiRoutes.scala`. No inline fully-qualified names.

## Acceptance criteria

- [ ] An agent can discover available shapes (catalog) and instantiate one via MCP, producing a pipeline + output DataType bindable by a panel.
- [ ] Tool descriptions document each shape id + its params.
- [ ] Instantiation reuses the same backend service the UI uses (single source of truth).
- [ ] Tests: MCP tool wiring (dist build), and a backend test for the instantiation endpoint if one is added.
- [ ] Backward compatible: additive tools/params; existing MCP tools unchanged.

## Out of scope

- The in-app editor UX (sibling ticket, HEL-402 — already shipped).
- Conversational refinement of shapes (HEL-343, another lane).

## Dependencies

- Blocked by HEL-391 (shape abstraction + catalog) — SHIPPED.
- Shares the instantiation service with the panel-declares-shape ticket (HEL-399, not yet shipped — see orchestrator brief below).

## Orchestrator brief (additional context beyond the raw ticket)

- Main is at `97b3ff7b`. HEL-337 epic has shipped: HEL-391 (#288) registry + catalog + reference `passthrough`; HEL-393 (#289) `single-row`; HEL-394 (#290) `top-n`; HEL-396 (#291) `time-series`; HEL-398 (#292) `pivot-matrix`; HEL-402 (#293) editor instantiation UX. Registered shape ids: `passthrough`, `single-row`, `top-n`, `time-series`, `pivot-matrix`. Read them all in `backend/src/main/scala/com/helio/domain/shapes/`.
- Only HEL-399 (panel-declares-shape wiring) remains after HEL-400 — it has NOT shipped yet, so "reuse the panel-declares-shape service" in the ticket description is aspirational; the real reusable surface today is the HEL-402 endpoint below.
- Backend surface to consume:
  - `GET /api/pipeline-shapes` — catalog. Distinct top-level prefix, deliberately NOT under `/api/pipelines/` (collides with the `PipelineIdSegment` catch-all). Schema: `schemas/pipeline-shape-catalog.schema.json`.
  - `POST /api/pipeline-shapes/:id/expand` — NEW in HEL-402, the first HTTP caller of `PipelineShape.expand`. 404 unknown shape id, 422 with the shape's own validation message verbatim, 200 with the expanded step list. Documented in `openspec/specs/pipeline-shape-registry/spec.md`. This is very likely the endpoint the MCP tooling should build on rather than reimplementing expansion. Verify its real request/response shape against the running server.
  - `paramsSchema` is DESCRIPTIVE metadata only, NOT validating JSON Schema. Real validation lives server-side in `expand`, returning the message surfaced as 422. The MCP tool needs to return that message back to the agent verbatim — a swallowed validation error is the failure mode to design against.
  - `outputContract.fields` is `Vector.empty` for EVERY shape. Do not build anything that depends on `fields` being populated. `rowCount` and `description` carry the real information.
  - Steps seeded from a shape carry NO persisted link back to the shape (deliberate HEL-402 decision). Don't assume provenance exists.
- MCP codebase (`helio-mcp/`): read `src/tools/write.ts` (`create_pipeline`, `add_pipeline_step`, `run_pipeline`), `src/tools/read.ts`, `src/tools/proposal.ts` (`propose_dashboard`, `apply_proposal`), and `src/context.ts` (`buildWorkspaceContext`). Mirror their existing structure and error handling.
  - Build `dist` before the server will pick up changes; there is no dotenv — env comes from the MCP client config, not a `.env` file.
  - `add_pipeline_step`'s `type` is free-text `z.string()`, NOT an enum — new capabilities get documented in the tool's `description` string. Those descriptions are the agent's entire menu, so treat description text as a first-class deliverable, not a comment.
  - There's a known-stale-docs spinoff already filed (HEL-617) for `add_pipeline_step` missing some op docs. Don't fix it here unless it's directly in your path; note it if you touch adjacent text.
- Design questions to settle deliberately at the design gate:
  1. Tool surface shape — a shape-catalog read tool, an instantiate/expand tool, or extending existing `create_pipeline` with an optional shape reference. Justify the choice against how an agent actually composes a dashboard.
  2. Whether workspace context (`buildWorkspaceContext`) should advertise the shape catalog so a planning agent sees shapes as an available vocabulary. The helio-news lesson: agents do far better picking from a real menu than inventing keys — weigh that.
  3. Error propagation — how the 422 validation message reaches the agent intact.

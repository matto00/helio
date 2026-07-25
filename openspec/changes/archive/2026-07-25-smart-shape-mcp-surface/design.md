## Context

`helio-mcp/` gives agents `create_pipeline` + `add_pipeline_step` (hand-assembled steps) and, separately,
`propose_dashboard`/`apply_proposal` (panels over existing pipeline-output DataTypes). The backend now
also has smart pipeline shapes: `GET /api/pipeline-shapes` (catalog) and
`POST /api/pipeline-shapes/:id/expand` (HEL-402, first HTTP caller of `PipelineShape.expand`) —
authenticated, already wired into `ApiRoutes.scala`. Five shapes are registered:
`passthrough`/`single-row`/`top-n`/`time-series`/`pivot-matrix` (`backend/.../domain/shapes/`). `expand`
is pure (no persistence); a params failure returns the shape's own message as a 422 (`ServiceError.
UnprocessableEntity`), an unknown id a 404 (`ServiceError.NotFound`) — both routed through
`ServiceResponse.completeError` to `ErrorResponse(message)`, which `helio-mcp/src/httpClient.ts`'s
`describeError` already extracts verbatim and `guarded()` already surfaces as an `isError: true` tool
result (see `HelioApiError`/`guarded` in `write.ts`/`proposal.ts`/`read.ts`).

## Goals / Non-Goals

**Goals:**
- Let an agent discover shapes and instantiate one into a running pipeline + output DataType, reusing
  the HEL-402 `expand` endpoint as the single source of truth (no reimplemented validation/expansion).
- Document every shape id + params in tool descriptions (mirrors `add_pipeline_step`'s per-op text).
- Preserve the existing verbatim-422-message plumbing with zero new error-handling code.

**Non-Goals:**
- No new backend endpoint or Scala change — `PipelineShapeRoutes`/`PipelineShapeService` are consumed
  as-is (ticket's "if a new endpoint is needed" branch does not apply; HEL-402 already built it).
- No `propose_dashboard` shape threading (Decision 4).
- No auto-run of the instantiated pipeline (Decision 3).

## Decisions

**Decision 1 — Two tools, not a `create_pipeline` parameter.** Add `list_pipeline_shapes` (read) and
`create_pipeline_from_shape` (write) as distinct tools rather than an optional `shape` argument on
`create_pipeline`. `create_pipeline`'s current contract is "create an empty pipeline, add steps
yourself"; a shape reference would make `outputDataTypeName` the only always-required field while every
other field becomes conditionally required/forbidden depending on `shape` — a worse Zod schema and a
worse tool description than two small, single-purpose tools with their own focused descriptions. This
also mirrors the existing `create_pipeline` + `add_pipeline_step` two-tool split rather than fighting it.
Alternative considered: fold shape catalog docs into `add_pipeline_step`'s description (like ops) — reads
inconsistently, because a shape isn't a step kind, it expands to *multiple* steps atomically.

**Decision 2 — Validate before writing.** `create_pipeline_from_shape` calls `expand` FIRST (pure,
no persistence), and only creates the pipeline + adds steps once `expand` returns `Right`. This avoids
leaving an orphan empty pipeline when a shape id is unknown or params are invalid — a strictly better
failure mode than create-then-fail. Once `expand` succeeds, each returned `{kind, config}` entry is
posted via the existing `addPipelineStep` call in order (same as `add_pipeline_step` would do manually);
a step-add failure this late is no worse than an agent's own manual multi-`add_pipeline_step` sequence
failing partway — the tool result names which step failed and the pipeline id, so an agent can inspect
via `get_pipeline` or clean up via `delete_pipeline`, same recovery path as the hand-assembled flow today.

**Decision 3 — No auto-run.** `run_pipeline` stays a separate, explicit call after
`create_pipeline_from_shape`, matching `create_pipeline`/`add_pipeline_step`'s existing "build, then run"
split — an agent may want to add further non-shape steps (e.g. a `rename` after a `pivot-matrix`) before
running. `create_pipeline_from_shape`'s description says so explicitly.

**Decision 4 — `propose_dashboard` is left unchanged.** The ticket says "if `propose_dashboard` can
reference shapes, thread that through." `propose_dashboard` is deliberately a no-writes panel-proposal
assembler over *existing* pipeline-output DataTypes (see its docstring); instantiating a shape is a
write (creates a pipeline + steps) with its own success/failure surface (a 422 mid-proposal would break
the "assemble then review" contract). Threading it in would blur two different concerns. The intended
agent flow stays sequential and explicit: `list_pipeline_shapes`/`get_workspace_context` →
`create_pipeline_from_shape` → `run_pipeline` → `propose_dashboard`/`apply_proposal` referencing the
resulting `outputDataTypeId` — identical in shape to today's `create_pipeline` → `add_pipeline_step` →
`run_pipeline` → `propose_dashboard` flow, just with fewer manual steps up front.

**Decision 5 — Workspace context gets a `pipelineShapes` catalog snapshot.** `buildWorkspaceContext`
gains one more `Promise.all` fan-out call (`api.listPipelineShapes()`) alongside its existing four,
projecting each catalog entry to `{id, label, description, paramsSchema, outputRowCount,
outputDescription}` (`fields` dropped — HEL-402 confirms it is `Vector.empty` for every current shape;
exposing it would just be always-empty noise, per the brief's explicit guidance not to build on it). This
follows the repo's own recorded helio-news lesson: agents pick reliably from a real menu but invent keys
when given none — the same reasoning that justifies `list_connectors`' existing catalog exposure. Cost is
one flat call (not per-pipeline, unlike the `analyze` fan-out), so it doesn't change the documented
`4 + N(pipelines)` budget's growth shape. `list_pipeline_shapes` still exists standalone for a fresher/
narrower lookup without the full context payload.

## Risks / Trade-offs

- [Risk] A step-add failing partway through `create_pipeline_from_shape` leaves a partially-built
  pipeline. → Mitigation: Decision 2 validates params via `expand` before any write happens at all, so
  this can only occur for a systemic backend fault (not a bad shape id or bad params); the tool result
  names the pipeline id and failed step so the agent can inspect/retry/delete, matching today's manual
  multi-step recovery path.
- [Risk] `outputContract.fields` is always empty today — an agent can't learn the shape's output columns
  before running. → Mitigation: out of scope per the orchestrator brief (epic-level open question); the
  tool description tells the agent to call `analyze_pipeline` after adding steps, same as the
  hand-assembled flow already recommends.

## Planner Notes

- No new backend endpoint: confirmed `POST /api/pipeline-shapes/:id/expand` is already authenticated and
  wired in `ApiRoutes.scala` (HEL-402) — self-approved as in-scope reuse, not a gap requiring a new route.
- `create_pipeline_from_shape`'s composed return shape mirrors `getPipeline`'s existing
  `PipelineWithSteps` (`{...summary, steps}`) — self-approved for consistency, no new response shape.

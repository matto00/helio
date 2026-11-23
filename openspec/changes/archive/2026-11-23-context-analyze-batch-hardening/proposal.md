## Why

HEL-1625's final review left three non-blocking notes on the batched analyze read (`GET /api/pipelines/context-analyze`)
and its helio-mcp consumer. Each is a place where the batch can disagree with, or is not proven equal to, the
per-pipeline `GET /api/pipelines/:id/analyze` it replaces.

Premise check (`.concertino/runs/HEL-1827/evidence/premise-validation.md`): `data_sources.id` is a `TEXT` primary key
(V4, never altered), so `/analyze`'s `findByIdOwned`/`findByIdInternal` compare the raw id as case-sensitive text. The
batch instead lower-cases every id through `UUID.fromString(...).toString` and drops malformed ones. So the two paths
really disagree for a non-canonical id (an upper-case id resolves in the batch, not in `/analyze`) and for a malformed
id (the batch fails the whole pipeline and omits it; `/analyze` simply finds no source). The "the column compares as
uuid" comments are wrong. This is a real fix, not a comment-only change.

## What Changes

- Backend: the context-analyze batch looks every source id up exactly as `/analyze` does: the raw id, compared as text.
  No `UUID.fromString` normalisation, no malformed-id filtering, no lookup that can throw on a malformed id. The wrong
  "compares as uuid" comments on `DataSourceRepository.findByIdsOwned` and on the batch's id filter are corrected.
- helio-mcp: `get_workspace_context` treats a batch item without a `steps` array as absent from the batch, so that
  pipeline is analyzed per pipeline (and counted in the existing one-line "omitted N of M" stderr warning) instead of
  yielding a `stepsError`. The payload stays byte-identical to the HEL-1619 goldens.
- Evidence: a committed red run of `PipelineContextAnalyzeQueryCountSpec` under an N+1 mutation (one statement per
  pipeline), proving the statement-count spec can fail on the defect it exists to catch.
- No API shape change, no migration, no schema change. helio-mcp is a source change; the hosted MCP picks it up at its
  next redeploy (none in this change).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-context-analyze-read`: item parity with `/analyze` explicitly covers non-canonical and malformed source ids.
- `mcp-workspace-context-request-budget`: an analyze-batch item with no `steps` array falls back to per-pipeline analyze.

## Impact

- `backend/.../services/pipelines/PipelineContextAnalyzeReads.scala`, `backend/.../persistence/sources/DataSourceRepository.scala` (comment only, plus whatever the raw lookup needs).
- Backend tests under `backend/src/test/scala/com/helio/api/routes/pipelines/` (context-analyze specs).
- `helio-mcp/src/context.ts`, `helio-mcp/src/contextRequestBudget.test.ts` (and the fixture if a new mode is needed). Goldens `helio-mcp/src/__golden__/*` unchanged.

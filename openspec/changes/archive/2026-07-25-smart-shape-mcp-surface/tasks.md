## 1. Types

### MCP

- [x] 1.1 Add `ShapeParamDescriptorResponse`, `RowCountContractResponse` (discriminated union),
      `OutputContractResponse`, `PipelineShapeCatalogEntryResponse`, and
      `ShapeStepExpansionResponse` to `helio-mcp/src/types.ts`, mirroring the backend's
      `PipelineShapeProtocol.scala` wire shapes.

## 2. API wrappers

### MCP

- [x] 2.1 Add `HelioApi.listPipelineShapes()` (`GET /api/pipeline-shapes`) to `helio-mcp/src/helioApi.ts`.
- [x] 2.2 Add `HelioApi.expandPipelineShape(shapeId, params)` (`POST /api/pipeline-shapes/:id/expand`).
- [x] 2.3 Add `HelioApi.createPipelineFromShape(input)` composing: `expandPipelineShape` first (no
      write on failure), then `createPipeline`, then `addPipelineStep` per returned expansion in
      order; return `{...summary, steps}` (mirrors `getPipeline`'s `PipelineWithSteps`).

## 3. Tools

### MCP

- [x] 3.1 Register `list_pipeline_shapes` in `helio-mcp/src/tools/read.ts`, alongside `list_connectors`.
- [x] 3.2 Register `create_pipeline_from_shape` in `helio-mcp/src/tools/write.ts`, alongside
      `create_pipeline`/`add_pipeline_step`. Description documents every registered shape id + its
      params (mirroring `add_pipeline_step`'s per-op text) and states the tool does not auto-run.

## 4. Workspace context

### MCP

- [x] 4.1 Add a `pipelineShapes` fan-out call (`api.listPipelineShapes()`) to
      `buildWorkspaceContext`'s `Promise.all` in `helio-mcp/src/context.ts`.
- [x] 4.2 Project each catalog entry to `{id, label, description, paramsSchema, outputRowCount,
      outputDescription}` (flatten `RowCountContract` to a string; drop the always-empty `fields`
      array) and add `pipelineShapes` to the `WorkspaceContext` interface.
- [x] 4.3 Update `get_workspace_context`'s tool description in `read.ts` to mention the new field.

## 5. Tests

### Tests

- [x] 5.1 `helio-mcp` builds clean (`npm run build` / `tsc`) with the new types/tools registered.
- [x] 5.2 Extend `helio-mcp/scripts/verify.ts` (the existing real-MCP-client harness) with sections for
      `list_pipeline_shapes`, `create_pipeline_from_shape` (valid `top-n` params → pipeline + sort/limit
      steps), and confirm `get_workspace_context`'s resource read includes `pipelineShapes`.
- [x] 5.3 Run `npm run verify` against the running dev backend (`HELIO_API_BASE_URL`/`HELIO_PAT`) and
      confirm: valid params succeed; invalid params on `create_pipeline_from_shape` surface the shape's
      verbatim validation message and create no pipeline; an unknown shape id surfaces the 404 message
      and creates no pipeline. Record the run output in `files-modified.md` for evaluator review.

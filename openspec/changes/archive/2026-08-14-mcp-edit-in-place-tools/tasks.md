## 1. MCP: updateSchemas.ts module (design.md D3)

- [x] 1.0 Add `UpdateDataTypeRequest`/`UpdatePipelineStepRequest` TypeScript interfaces to
      `helio-mcp/src/types.ts` (mirroring `UpdateMetricRequest`'s existing declaration there —
      name/fields/computedFields all optional; config/position all optional, no `type` field).
- [x] 1.1 Create `helio-mcp/src/tools/updateSchemas.ts`, mirroring `metricSchemas.ts`'s structure.
      Add `dataFieldSchema`/`computedFieldSchema` zod schemas (name/displayName/dataType/nullable
      and name/displayName/expression/dataType respectively), mirroring the backend case classes
      exactly.
- [x] 1.2 Add `buildUpdateDataTypeBody({name?, fields?, computedFields?})` — returns
      `UpdateDataTypeRequest`-shaped object with only the provided keys present (`!== undefined`
      per key, mirrors `buildUpdateMetricBody`'s pattern exactly).
- [x] 1.3 Add `buildUpdatePipelineStepBody({config?, position?})` — returns an object with only the
      provided keys present; never constructs a `type` key (design.md D2).

## 2. MCP: HelioApi methods

- [x] 2.1 Add `updateDataSource(dataSourceId, name)` to `HelioApi` — `PATCH /api/data-sources/:id`
      with `{name}`, returns `DataSourceResponse`.
- [x] 2.2 Add `updateDataType(dataTypeId, patch)` to `HelioApi` — `PATCH /api/types/:id` with the
      already-built body from `buildUpdateDataTypeBody` (task 1.2), returns `DataTypeResponse`.
- [x] 2.3 Add `updatePipeline(pipelineId, name)` to `HelioApi` — `PATCH /api/pipelines/:id` with
      `{name}`, returns `PipelineSummaryResponse`.
- [x] 2.4 Add `updatePipelineStep(stepId, patch)` to `HelioApi` — `PATCH /api/pipeline-steps/:id`
      with the already-built body from `buildUpdatePipelineStepBody` (task 1.3), returns
      `PipelineStepResponse`.

## 3. MCP: write.ts tool registration

- [x] 3.1 Register `update_data_source` — `dataSourceId` + required `name`; description states
      rename-only (design.md D1).
- [x] 3.2 Register `update_data_type` — `dataTypeId` + optional `name`/`fields`/`computedFields`
      (using `updateSchemas.ts`'s `dataFieldSchema`/`computedFieldSchema`); description states
      `fields`/`computedFields` wholesale-replace semantics when provided; calls
      `buildUpdateDataTypeBody` before `api.updateDataType`.
- [x] 3.3 Register `update_pipeline` — `pipelineId` + required `name`; description states
      rename-only (design.md D1).
- [x] 3.4 Register `update_pipeline_step` — `stepId` + optional `config` (`z.record(z.unknown())`,
      same loose typing as `add_pipeline_step`) + optional `position` (`z.number().int()`);
      description states the field is omitted deliberately, not forgotten (design.md D2), and that
      `analyze_pipeline` will reflect a `config` edit; calls `buildUpdatePipelineStepBody` before
      `api.updatePipelineStep`.
- [x] 3.5 All four wired through the existing `guarded()` wrapper, same as every other tool in this
      file — no new error handling.

## 4. Docs

- [x] 4.1 Add the four new tools to `helio-mcp/README.md`'s tool table (same format/section as
      `create_pipeline`/`add_pipeline_step`/`update_panel_appearance`).
- [x] 4.2 Rebuild `dist/` (`npm run build` in `helio-mcp/`).

## 5. Tests

- [x] 5.1 New `updateSchemas.test.ts` (mirrors `write.test.ts`'s `buildUpdateMetricBody` coverage
      style, importing from `./updateSchemas.js` directly per design.md D3): unit test
      `buildUpdateDataTypeBody`'s partial-body construction (only provided keys present; an
      all-omitted call returns `{}`).
- [x] 5.2 Same file: unit test `buildUpdatePipelineStepBody`'s partial-body construction
      (`config`/`position` independently omittable; `type` never present in the constructed body).
- [x] 5.3 Confirm `npm test`/lint/format green; confirm `analyze_pipeline`'s AC (task 3.4) live via
      a manual/evaluator check against a running backend — reusing an existing pipeline's step
      edit, not a new integration-test harness (none exists for this file's other tools either).
      Done: live-verified with a real MCP client (`Client`/`StdioClientTransport`, mirroring
      `scripts/verify.ts`'s harness) against the worktree's running dev backend — all four
      `update_*` tools called end-to-end, including `update_pipeline_step` + a before/after
      `analyze_pipeline` diff confirming the config edit (count 2→4) is reflected. Scratch harness
      only, not committed.

# Files modified — HEL-328 (mcp-edit-in-place-tools)

- `helio-mcp/src/types.ts` — added `UpdateDataTypeRequest`/`UpdatePipelineStepRequest` TS
  interfaces (mirroring `UpdateMetricRequest`'s existing declaration), reusing
  `DataFieldResponse`/`ComputedFieldResponse` for the DataType field-array item shape.
- `helio-mcp/src/tools/updateSchemas.ts` (new) — `dataFieldSchema`/`computedFieldSchema` zod
  schemas + `buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody` partial-PATCH-body builders,
  mirroring `metricSchemas.ts`'s structure exactly (design.md D3).
- `helio-mcp/src/tools/updateSchemas.test.ts` (new) — unit tests for both builders (partial-body
  construction; all-omitted → `{}`; `type` never present in `update_pipeline_step`'s body),
  mirroring `write.test.ts`'s `buildUpdateMetricBody` coverage style; imports the narrow module
  directly to avoid `write.ts`'s expensive-to-type-check full Zod surface.
- `helio-mcp/src/helioApi.ts` — added `updateDataSource`/`updateDataType`/`updatePipeline`/
  `updatePipelineStep` methods (new "Edit-in-place (HEL-328)" section), each a thin PATCH
  pass-through to an existing, unmodified backend endpoint; updated the `types.js` import list.
- `helio-mcp/src/tools/write.ts` — registered the four new tools (`update_data_source`,
  `update_data_type`, `update_pipeline`, `update_pipeline_step`) via `server.registerTool`, each
  routed through the existing `guarded()` wrapper; imports the new builders/schemas from
  `updateSchemas.ts`.
- `helio-mcp/README.md` — added the four new tools to the "Write / composition tools" table.

## Not committed (gitignored / scratch)

- `helio-mcp/dist/` rebuilt via `npm run build` (task 4.2) to verify the compiled output — gitignored,
  not part of this commit.
- A scratch live-verification harness (real MCP client over stdio, mirroring
  `scripts/verify.ts`'s pattern) was written temporarily to `helio-mcp/scripts/` to confirm all
  four tools end-to-end against the worktree's running dev backend (including the
  `update_pipeline_step` → `analyze_pipeline` reflects-the-edit AC), then deleted — not part of
  the repo.

## Non-blocking finding (spinoff candidate, not fixed here)

Root `jest.config.cjs`'s `testPathIgnorePatterns` does not exclude `dist/` directories. Since
`helio-mcp/tsconfig.json` has no test-file exclusion, `npm run build` in `helio-mcp/` compiles
`*.test.ts` into `dist/**/*.test.js` too; if `helio-mcp/dist/` exists when root `npm test` runs,
Jest picks up those compiled files and fails to parse them (`SyntaxError: Cannot use import
statement outside a module`). Reproduces identically against the main checkout's own
(pre-existing, gitignored) `helio-mcp/dist/` — not introduced by this change. Worked around here
by sequencing gates before the `dist/` rebuild; not fixed inline (out of scope, touches a shared
root config file).

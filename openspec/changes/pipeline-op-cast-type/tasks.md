## 1. Backend

- [x] 1.1 Fix `applyCast` in `InProcessPipelineEngine.scala` to use `{"casts": Map[String,String]}` config shape (iterate map, cast each named field, pass others through)
- [x] 1.2 Fix `castValue` to handle a `"date"` target type (or explicitly document it as unsupported with a passthrough)
- [x] 1.3 Verify `allowedOps` already includes `"cast"` in `PipelineStepRoutes.scala` (no change needed if present)

## 2. Frontend

- [x] 2.1 Create `CastFieldsConfig.tsx` component: table rows from analyze `inputSchema`, each row has field name + type dropdown (`string`, `integer`, `long`, `double`, `boolean`, `— keep as is —`)
- [x] 2.2 Wire config hydration in `CastFieldsConfig`: parse persisted `{"casts":{...}}` on mount and populate dropdown selections
- [x] 2.3 On dropdown change: update `casts` map (remove key on `— keep as is —`) and call `updatePipelineStep` via Redux thunk
- [x] 2.4 In `PipelineDetailPage.tsx`: import and render `CastFieldsConfig` for `step.opType.id === "cast"`
- [x] 2.5 Fix default seed config for cast in `PipelineDetailPage.tsx` from `"{}"` to `'{"casts":{}}'`

## 3. Tests

- [x] 3.1 Backend: add `InProcessPipelineEngineSpec` cases — empty casts (no-op), valid cast string→integer, valid cast string→double, invalid value yields null, missing field in casts is ignored
- [x] 3.2 Backend: add `PipelineAnalyzeServiceSpec` cases — cast step with `{"casts":{"field":"integer"}}` produces correct outputSchema with updated type
- [x] 3.3 Frontend: add `CastFieldsConfig.test.tsx` — renders table from inputSchema, selecting a type calls updatePipelineStep with correct casts payload, hydrates from persisted config

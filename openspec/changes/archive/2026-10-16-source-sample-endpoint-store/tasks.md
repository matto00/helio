## Standing Constraints

- [C1] Contract/seam tests validate output produced by the real production serializer, never hand-built JSON, and include a negative case that the schema must reject.

## 1. Backend

- [x] 1.0 Extract `PipelineRunService.urlFetchSeam` into one shared function used by `PipelineRunService` and the sample service (behaviour-preserving); existing URL-backed run specs stay green
- [x] 1.1 Add `SampleRowJson.encode` (D6) with unit tests for Int/Long/Double/NaN/±Infinity/-0.0/null, and a nested map failing
- [x] 1.2 Add `SourceSampleService` (D2-D5) with service tests for dataset, uploaded CSV (<1000, >1000), URL CSV, REST (stub connector, flattening parity with `loadRowsWithStats`), SQL truncated with unknown total, image 400, read failure 502, URL CSV to a blocked host 502 via the shared seam
- [x] 1.3 Add `SourceSampleResponse` JSON protocol and the `/data-sources/:id/sample` route inside `DataSourcePreviewRoutes`' `rateLimited` block (custom writer: `sourceRowCount` always present, `null` for None); update the `ConnectorResolveContext` doc; wire the service in `ApiRoutes`; verify `sbt compile`
- [x] 1.4 Add `schemas/sources/source-sample-response.schema.json` (2020-12) with the closed `$defs/cell` type (D6) and `sourceRowCount` required `["integer","null"]`; verify the schema-drift check passes

## 2. Frontend

- [x] 2.1 Move `decodeValue`/`decodeRow` unchanged to `evaluator/wire.ts`, re-import from the corpus; existing evaluator tests stay green
- [x] 2.2 Add `fetchSourceSample` to `dataSourceService.ts` and the `SourceSample` type; verify by service test
- [x] 2.3 Add `sourceSamplesSlice` + thunk + selectors (`selectSourceSample`, `selectRootFrames`, `selectSourceFrames`), reset on sign-out, late fulfilment after sign-out ignored; verify by slice tests
- [x] 2.4 Add `useSourceSamples` hook wired once from `usePipelineDetailPage` (both layouts; capture-once, waits for sources list, never from step editors); verify by hook test
- [x] 2.5 Add `describeSampleLabel` + `SourceSampleLabel` in `SpineSourceCard` per D8 and DESIGN.md v3; verify by component tests
- [x] 2.6 Render the compact `SourceSampleLabel` under each source chip in `PipelineDetailHeader` (phone layout); verify by component test

## 3. Tests

- [x] 3.1 Route spec: the 31st sample request in a window at the default limit (30) is 429 with Retry-After, and the sample shares the bucket with `/preview`
- [x] 3.2 Run-guard spec: sample requests create no `pipeline_run_rate_window` row, no `pipeline_runs` row, and do not reduce run-guard capacity
- [x] 3.3 RLS spec on `TwoUserRlsApiFixture` (non-BYPASSRLS role) seeding a dataset source: owner 200 with rows, other user 404 with no rows, unknown id 404
- [x] 3.4 Seam test: backend validates a response the REAL writer serialized from rows with Int, Long, Double, NaN, null and string cells (no hand-built JSON), plus the `sourceRowCount: null` case; a row whose Int cells are plain numbers and a response missing `capturedAt`/`sourceRowCount` must fail. Frontend validates the same shared fixture with Ajv2020 and runs it through `wire.decodeRow`, asserting Int/Long come back as `Integral` of the right kind and plain numbers as `number`
- [x] 3.4a Encoder/corpus agreement test: `SampleRowJson.encode` and `ParityCorpus.encodeValue` produce equal parsed JSON values (not rendered strings) for the same value set; the backend also asserts the committed shared fixture equals the real serializer's output
- [x] 3.5 Store tests: one request on open, zero on step edits and remount, one on refresh, nothing read from storage on a fresh store
- [x] 3.6 Playwright e2e (D10: non-static label screenshots via page.route schema-valid fixture; static cases and network counts real; ≤2 workers, under the e2e flock): capture-once, zero-on-edit, refresh, and `page.reload()` one-fresh-capture network counts on the pipeline page; a phone-viewport screenshot of the chip label; screenshots of the four label cases in light and dark themes saved to the run's evidence folder

## Standing Constraints

- [C1] Show red before green: the drift (D4) and each guard assertion (D5) must be demonstrated failing by a recorded mutation before being claimed.
- [C2] Never print/cat/source `backend/.env` or any env map; sbt invocations use `-J-Xmx3g`; stop any sbt server started (`sbt --client shutdown`); check `free -g` before committing.
- [C3] Do not edit `scripts/check-schema-drift.mjs` (concurrent HEL-1412).

### Backend

- [x] 1.1 Probe and record the existing drift: a `"type": ""` step body is rejected by the proposal schema and accepted by the response schema at base; cite the Scala source showing the wire `type` is never empty.
- [x] 1.2 Add the `https://helio.local/schemas/` → located `schemas/` URI mapping in `JsonSchemaValidation` (verify the 1.0.87 API against the jar); verify a cross-file `$ref` compiles offline.
- [x] 1.3 Add `"minLength": 1` to `AnalyzeStep.properties.type` in `pipeline-analyze-response.schema.json`.
- [x] 1.4 Replace the proposal schema's `AnalyzeWarning`/`RootSourceSchema`/`SchemaField`/`AnalyzeProposalStep` with absolute cross-file `$ref`s; keep only `OutputAnalyze`; rewrite the stale "local copy" prose; verify valid JSON.

### Tests

- [x] 2.1 Add `AnalyzeSchemaSharedDefsSpec` per design D5 (disjoint `$defs`, exact cross-file `items.$ref` URIs, offline compile, negatives incl. SchemaField.type in both nestings, one positive); record mutation evidence that each part goes red.
- [x] 2.2 Run `PipelineAnalyzeProposalRoutesSpec` (incl. 3.11), `PipelineAnalyzeRoutesSpec`, `PipelineAnalyzeSchemaWarningsSpec`, `PipelineAnalyzeCanRunRoutesSpec` green.
- [x] 2.3 Run full `sbt testFull`, `npm run check:schemas` and its selftest green; record transcripts.

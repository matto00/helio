# HEL-1419: Schema test harness: add a URI mapping so the two analyze response schemas can $ref shared defs instead of duplicating them

## Description

origin_kind: followup
origin_ticket: HEL-1281

`backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala` compiles each schema file on its own (networknt 1.0.87, no URI mapping), so a cross-file `$ref` to `https://helio.local/...` throws `UnknownHostException` (verified by HEL-1281's design skeptic, for both relative and absolute refs). As a result, the analyze response schema and the proposal analyze response schema duplicate `AnalyzeStep`, `RootSourceSchema`, `SchemaField` and `AnalyzeWarning`, and nothing keeps the copies in sync (HEL-1235 had to add `warnings` to both by hand).

## Acceptance criteria

* Add a URI mapping (e.g. `helio.local/schemas/...` → classpath/repo `schemas/`) to the harness.
* Replace the duplicated defs in the proposal schema with cross-file `$ref`s.
* `PipelineAnalyzeProposalRoutesSpec` (incl. 3.11), `check:schemas` and schema-drift stay green.
* A guard that fails if a duplicated def drifts, or proof that the `$ref`s make drift impossible.

## Driver notes (claims, verified at Setup — see premise-validation evidence)

* "Proof that the `$ref`s make drift impossible" is acceptable only if no copy remains.
* All consumers must still validate real responses.

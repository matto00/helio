## Why

The proposal analyze response schema keeps local copies of four defs from the persisted analyze response schema
(`AnalyzeWarning`, `RootSourceSchema`, `SchemaField`, and `AnalyzeStep` as `AnalyzeProposalStep`) because the backend
schema test harness cannot resolve a cross-file `$ref` offline. Nothing keeps the copies in step, and they have already
drifted: `AnalyzeProposalStep.type` carries `minLength: 1` while `AnalyzeStep.type` does not.

## What Changes

- The backend schema test harness maps `https://helio.local/schemas/` to the repo's `schemas/` directory, so a
  cross-file `$ref` by `$id` resolves offline.
- `pipeline-analyze-proposal-response.schema.json` replaces its four copied defs with cross-file `$ref`s into
  `pipeline-analyze-response.schema.json`; `AnalyzeProposalStep` is removed. Its prose that justified the copies is
  corrected.
- The existing drift is resolved by adding `minLength: 1` to the canonical `AnalyzeStep.type` (matching the wire: the
  step `type` is always a non-empty op kind).
- A regression guard fails if the proposal schema ever re-declares a `$def` the response schema already owns, and
  proves the `$ref`s are enforced rather than silently vacuous.

## Non-goals

- No change to the wire format, Scala protocols, or `check-schema-drift.mjs` (it does not follow `$ref`s; HEL-1412
  is editing it concurrently).
- No de-duplication of other schema families; no networknt upgrade.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — no spec-level behavior changes (`skip_specs: true`); the response bodies are unchanged and the contract files
only lose duplication plus one tightening that the wire already satisfies.

## Impact

- `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala`
- `schemas/pipelines/pipeline-analyze-response.schema.json`, `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`
- One new backend test spec (the guard). Every existing spec compiling these schemas must stay green.

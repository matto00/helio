## Why

When a pipeline step fails, the client sees `422 unknown: Pipeline execution failed` — no step id, no step
type, no reason. The information exists: `StringOpsStep` already rejects an unsupported `operation` with a
message naming the bad value and every supported alternative. It is thrown at execute time and then discarded
by `PipelineRunService`, which flattens every failure to a fixed string (HEL-311, to stop raw exception tails
leaking). A field-test agent building over the Sleeper NFL API had to bisect a 9-step pipeline by deleting
steps one at a time to find a single typo (`regexExtract` for `extractRegex`). This is what made every other
bug in that report expensive to find.

## What Changes

- Step failures are wrapped, in the engine's step loop, with the failing step's **id** and **kind**, so every
  step kind is covered uniformly rather than special-casing `stringops`.
- `PipelineRunService` emits `Pipeline execution failed at step <id> (<kind>): <reason>` — but only for
  failures explicitly marked as safe to show. Any other failure still gains the step id and kind, but its
  reason collapses to a fixed non-descriptive string, so HEL-311's no-leak guarantee is preserved by
  allowlist rather than weakened.
- `PipelineAnalyzeService` gains a per-step-kind config-validation hook that runs at **analyze** time. The
  enum-valued step options that today are validated only during execution (`stringops.operation`,
  `fillnull.strategy`, `window.function`, `union.mode`, `join.type`, and the `aggregate`/`groupby`/`pivot`
  aggregation functions) report a `validationError` before any run is attempted.
- The curated message is verified to reach the MCP surface as readable caller-facing text.

## Capabilities

### New Capabilities
- `pipeline-step-config-validation`: analyze-time validation of step config values that today fail only at
  execution, exposed through the existing per-step `validationError` field.

### Modified Capabilities
- `pipeline-run-execution`: the `422` run-failure error names the failing step's id, kind, and reason.

## Non-goals

- HEL-860's rejection of mistyped/unknown config keys at write time (`CastStep`, `RenameStep`). This change
  builds the analyze-time validation surface 860 will extend; it does not add 860's checks or reject writes.
- Changing which failures are fatal, retry behaviour, or any successful-run behaviour.
- Surfacing per-row data errors; only step-level configuration/execution failures are in scope.

## Impact

`InProcessPipelineEngine`, `PipelineRunService`, `PipelineAnalyzeService`, the step classes providing
validation predicates, the analyze/run OpenAPI contract, and helio-mcp error passthrough.

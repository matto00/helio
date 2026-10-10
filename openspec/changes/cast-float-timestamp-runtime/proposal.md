## Why

A `cast` step to `float`, `number` or `timestamp` leaves every value as a string at run time while analyze declares the column `float`/`timestamp`, so downstream numeric functions, sorts and aggregates silently operate on strings in a column the schema says is numeric (HEL-1436, seen live by the HEL-1423 skeptic). The write validator accepts any target string at all, so the set of targets analyze honours and the set the runtime honours have drifted apart with nothing to notice.

## What Changes

- The cast runtime handles every accepted target: `float` and `number` produce a 64-bit floating-point number (same as `double`); `timestamp` and `date` keep a value the platform reads as a timestamp (source inference's timestamp formats, or anything `datebucket` can bucket) as its **original string** — the representation JSON/SQL timestamp columns and `datebucket` already carry — and yield `null` for any other value.
- **BREAKING (behaviour)**: an existing `date` cast previously passed every value through unchanged; an unparseable value now becomes `null` (owner ruling: null-on-unparseable). Existing `float`/`timestamp` casts change their output values from strings to numbers / validated timestamp strings.
- **BREAKING (API)**: the cast step's write validator rejects any target (422, the status every write surface already uses for a step-configuration rejection — `pipeline-step-config-rejection`) outside `string`, `integer`, `long`, `float`, `double`, `number`, `boolean`, `date`, `timestamp` — including `string-body` and `binary-ref` (owner ruling: reject-at-write). The check runs on the write path only: already-stored legacy targets are never gated (scheduled/auto-run unaffected), analyze projects them as passthrough, and the run passes the value through unchanged by an explicit, tested rule (the original value, no longer `toString`).
- The analyze `numeric-op-on-text-field` warning (HEL-1403) trusts a cast's output types for every accepted target, now that each one produces its projected run-time type (HEL-1455 item 3).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-cast-op`: the supported target set grows to include `float`, `number`, `date`, `timestamp`; unsupported targets are rejected at write; timestamp/date cast semantics are specified.

## Impact

- Backend: `CastStep` (runtime + write-only validator), `PipelineStep` (write-only companion hook in `rawConfigProblem`), `ColumnSchemaInference.inferCast` (legacy passthrough projection), `DateBucketStep` (expose its parse predicate), `AnalyzeSchemaWarnings` (cast trust set). No migration, no frontend change (the UI picker offers a subset of the accepted set and is unaffected).
- Stored pipelines: dev has 1 `date` and 1 `timestamp` cast (test-gate residue), 0 `float`/`number`, 0 legacy (`string-body`/`binary-ref`/other); prod count is supplied to the owner as a read-only query in the PR body.
- Spark execution path (`SparkJobSubmitter`, not wired — HEL-238) maps `float` to a 32-bit type; out of scope, noted as a follow-up.

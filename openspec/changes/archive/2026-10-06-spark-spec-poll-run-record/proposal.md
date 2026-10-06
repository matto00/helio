## Why

`SparkJobSubmitterSpec`'s two `submit` tests wait for the background Spark job with a fixed `Thread.sleep(3000)` each:
~6 s of dead time per run of the spec, and still a timing guess rather than a condition. HEL-1287's replacement (poll
`pipelines.lastRunStatus`) raced, because that column is written before the run row reaches a terminal status.

## What Changes

- Replace both sleeps with a bounded poll that waits for the state the assertions actually read: the persisted run
  record reaching a terminal status (and, see design.md Decision 2, the pipeline's `lastRunStatus` being set).
- Assertions in both tests stay byte-for-byte unchanged.
- Prove the poll with recorded mutation runs (temporary, never committed) against `SparkJobSubmitter`'s write timing.
- Measure and report the spec's wall-time saving.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change; no spec-level behavior changes (`skip_specs: true`).

## Non-goals

- No product-code change. `SparkJobSubmitter`'s write order and its un-awaited repository writes are noted as a
  follow-up, not fixed here.
- No change to CI config, other specs, or the spec's other (non-`submit`) tests.

## Impact

- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` only.

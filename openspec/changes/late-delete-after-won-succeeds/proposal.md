## Why

Owner ruling (HEL-1564): once a real run's own `succeeded` terminal write has won, a later delete of its pipeline must
not change the run's answer. Today the answer depends on timing: a delete that lands after the success chain has read
the pipeline's Output list trips the per-node run guard (`RunNoLongerOpen(Missing)`), which fails the chain, skips
the `succeeded` publish and maps to 404, while a delete that lands before the list read answers success. Post-fold
writes that are not guarded (binary references) can also fail on the vanished pipeline after the run already
succeeded. The answer a caller gets for a run that genuinely succeeded must not be a race.

## What Changes

- The unblocked success chain, when it fails after the run's own `succeeded` terminal write won and the pipeline no
  longer exists, answers success and publishes `succeeded` instead of failing. Remaining writes for the deleted
  pipeline are skipped (no node written after the delete is observed); nothing is re-created for a deleted pipeline.
- The recovery is narrow: it requires both "own terminal write won" and "pipeline gone" (privileged existence check).
  A lost terminal write keeps HEL-1518 D7 (404 when the pipeline is gone, 409 when reaped); a failure while the
  pipeline still exists propagates exactly as today. First terminal write wins is unchanged.
- `LateFinisherRunSpec`: the HEL-1544 404-pinning test is flipped to success; new forced-ordering tests cover a delete
  between two node writes and a post-fold (binary-reference) write failing on the deleted pipeline; the HEL-1518
  item-2 delete test, which becomes order-sensitive under the new rule, is sequenced so the delete lands before the
  run's own terminal write.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-reaper`: the "First terminal write wins" requirement's late-finisher wording ("404 ... wherever the
  deletion lands") is narrowed to deletions that land before the run's own `succeeded` write commits, and a scenario
  is added for a deletion landing after it: success, `succeeded` published.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala` (success-chain recovery;
  possibly a small extracted helper if the file's soft size budget is exceeded).
- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala`.
- `openspec/specs/pipeline-run-reaper/spec.md` via the delta.
- No API shape, schema, migration or frontend change.

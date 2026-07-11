## Why

`PanelMutationRepository.batchUpdate`'s typed-config patch path writes a fixed column
whitelist that omits `aggregation` (added in V43 / HEL-292). Changing a metric/chart panel's
aggregation spec through the batch-update path is silently dropped and never persisted — the
same class of bug `PanelRepository.replace` had before HEL-292 fixed it there. `batchUpdate`
was never brought to parity, so the two write paths can diverge again the next time a config
column is added.

## What Changes

- Add `aggregation` to the column whitelist that `PanelMutationRepository.batchUpdate`'s
  config-patch path writes back, so it matches `PanelRepository.replace`.
- Factor the shared config-column list (`typeId, fieldMapping, content, imageUrl, imageFit,
  dividerOrientation, dividerWeight, dividerColor, aggregation`) into one place referenced by
  both `replace` and `batchUpdate`, so a future config column added to one path can't be
  forgotten in the other.
- Add a regression test exercising the batch-update path that fails before the fix and passes
  after: patching a metric/chart panel's `aggregation` via `POST /api/panels/updateBatch`
  persists across a reload.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-batch-update`: the config-patch path (`fields: ["config"]`) MUST persist every config
  column produced by `domainToRow`, including `aggregation`, at parity with `PanelRepository.replace`.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala` (batchUpdate)
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` (replace, shared column list)
- New/updated backend test coverage under `backend/src/test/scala/.../infrastructure/`
- No API/wire-shape changes; no frontend changes; no new migrations.

## Non-goals

- No changes to `PanelConfigCodec.applyConfigPatch` or the aggregation domain model itself
  (that logic is correct — only the write-back column list is missing a column).
- No broader refactor of `PanelMutationRepository`/`PanelRepository` beyond factoring the
  shared config-column list.

# HEL-296: batchUpdate config-patch path silently drops the panel `aggregation` column

Priority: High
URL: https://linear.app/helioapp/issue/HEL-296/batchupdate-config-patch-path-silently-drops-the-panel-aggregation

## Problem

`PanelMutationRepository.batchUpdate`'s typed-config patch path writes back a **fixed column whitelist** that omits `aggregation` — the column added in V43 for HEL-292 panel-level aggregation. So when a panel's aggregation spec (metric `{value, agg}` or chart `{groupBy, agg, yField}`) is changed via the **batch** update path, the new value is silently dropped and never persisted.

This is the same class of bug that bit `PanelRepository.replace` during HEL-292 (config computed correctly in memory, discarded by the column whitelist on write). `replace` was fixed to include `r.aggregation`; `batchUpdate` was not brought to parity.

## Evidence

`backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala:105-108` — the batch config-patch update maps:

```
(r.typeId, r.fieldMapping, r.content, r.imageUrl, r.imageFit, r.dividerOrientation, r.dividerWeight, r.dividerColor, r.lastUpdated)
```

Compare `PanelRepository.replace` at `PanelRepository.scala:205-206`, which correctly includes `r.aggregation`:

```
(r.typeId, r.fieldMapping, r.content, r.imageUrl, r.imageFit, r.dividerOrientation, r.dividerWeight, r.dividerColor, r.aggregation, r.lastUpdated)
```

`aggregation` is a real column in the `PanelRow` projection (`PanelRowMapper.scala:276`) and `domainToRow` populates it for metric/chart panels — but `batchUpdate` never writes it.

## Fix

Add `r.aggregation` / `patchedRow.aggregation` to the batchUpdate whitelist so the two write paths are at parity. Consider factoring the config-column tuple into one shared place so a future config column can't be added to one path and forgotten in the other.

## Acceptance criteria

* Changing a metric/chart panel's aggregation spec through the batch-update path persists across a reload (regression test that fails before the fix).
* `replace` and `batchUpdate` reference a single shared config-column list, or a test asserts they stay in sync.
* `sbt test` green.

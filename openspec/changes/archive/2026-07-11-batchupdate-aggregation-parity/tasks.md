## 1. ### Backend

- [x] 1.1 Add `configColumnsOf(r: PanelTable)` and `configColumnValuesOf(row: PanelRow)` shared
      helpers to `PanelRepository` (companion object), covering `typeId, fieldMapping, content,
      imageUrl, imageFit, dividerOrientation, dividerWeight, dividerColor, aggregation`.
- [x] 1.2 Update `PanelRepository.replace` to use `configColumnsOf` / `configColumnValuesOf`
      instead of its hand-written column tuple.
- [x] 1.3 Update `PanelMutationOps.batchUpdate`'s config-patch branch
      (`PanelMutationRepository.scala:105-108`) to use the same shared helpers, adding
      `aggregation` to what it writes back.

## 2. ### Tests

- [x] 2.1 Add a regression test exercising `batchUpdate`'s config-patch path: patch a metric
      panel's `aggregation` (`{ value, agg }`) via the batch path, reload the panel, assert the
      aggregation spec persisted. Confirm it fails on pre-fix code.
- [x] 2.2 Add the equivalent regression test for a chart panel's `aggregation`
      (`{ groupBy, agg, yField }`) via the batch path.
- [x] 2.3 Run `sbt test` and confirm the full suite is green.

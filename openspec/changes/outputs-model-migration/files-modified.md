# Files modified (cumulative, cycle 18)

- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — wires `OutputRepository`
  through the constructor (nullable-optional, default `null`, purely additive for existing
  positional callers) and adds `rejectMissingOutput`, called from both `buildForCreate` (covers
  `create`/`batchCreate`/`DashboardContentsService`'s panel-build path) and `update`, so a
  nonexistent/cross-owner `outputId` on an `"output"`-kind panel cleanly 404s before any write
  instead of hitting the raw `panels.output_id` FK violation as a 500.
- `backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala` — adds
  `outputIdFromCreateConfig`/`outputIdFromConfigPatch` (mirrors the existing
  `dataTypeIdFromCreateConfig`/`dataTypeIdFromConfigPatch` extraction pattern).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — passes `outputRepoOpt.orNull` into
  `PanelService`'s new constructor param.
- `backend/src/test/scala/com/helio/api/routes/panels/PanelBatchCreateSpec.scala` — new test:
  a batch-create item with a nonexistent `outputId` now 404s with nothing created (previously
  would have 500'd on the FK violation); trims the now-stale "separate follow-on work" comment
  on the adjacent empty-`outputId` test.

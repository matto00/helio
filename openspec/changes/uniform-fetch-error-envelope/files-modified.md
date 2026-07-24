- `backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala` — new file; shared
  `CreateSourceEnvelope.build[Config]` helper, generic over any `Connector[Config]`, extracted from
  the previously open-coded `Left`/`Right` envelope construction in `SourceService.createSql`/
  `createRest`.
- `backend/src/main/scala/com/helio/services/SourceService.scala` — `createSql`/`createRest` now
  delegate to `CreateSourceEnvelope.build` instead of open-coding the envelope; removed now-unused
  `DataSourceResponse`/`DataTypeResponse` imports (still used implicitly via the helper).
- `backend/src/main/scala/com/helio/domain/Connector.scala` — trait-level doc comment gains a
  `'''Fetch-error envelope'''` block (alongside the existing `'''ExecutionContext'''`/`'''Schema
  inference'''` blocks) documenting the `CreateSourceEnvelope.build` contract; no signature change.
- `backend/src/test/scala/com/helio/services/CreateSourceEnvelopeSpec.scala` — new file; test-connector
  fixture (`EnvelopeFixtureConnector`/`EnvelopeFixtureConfig`) proving `CreateSourceEnvelope.build`
  works for any `Connector[Config]` implementation, with a strict-equality assertion on `fetchError`
  in the failure case (`shouldBe Some("fixture unreachable")`) as the concrete proof the helper
  forwards `err` verbatim.
- `openspec/changes/uniform-fetch-error-envelope/tasks.md` — checked off all 6 tasks.

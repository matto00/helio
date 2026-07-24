## 1. Backend

- [x] 1.1 Create `backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala` with
      `build[Config](connector: Connector[Config], config: Config, source: DataSource, now: Instant,
      dataTypeRepo: DataTypeRepository, user: AuthenticatedUser, overrides: Map[String,
      FieldOverridePayload] = Map.empty)(implicit ec: ExecutionContext): Future[CreateSourceResponse]`
      per design.md Decision 2 — `Left(err)` branch forwards `err` unmodified into
      `fetchError`; `Right(schema)` branch projects via `SchemaInferenceFacade.toDataFields`, builds
      and persists a `DataType` (`version = 1`), and wraps the result.
- [x] 1.2 Refactor `SourceService.createSql` to call `CreateSourceEnvelope.build(SqlConnector,
      sqlConfig, inserted, now, dataTypeRepo, user)`, removing the inline `flatMap` branch logic.
- [x] 1.3 Refactor `SourceService.createRest` to call `CreateSourceEnvelope.build(connector,
      restConfig, inserted, now, dataTypeRepo, user, overridesMap)`, removing the inline `flatMap`
      branch logic.
- [x] 1.4 Extend `Connector.scala`'s trait-level doc comment with a `'''Fetch-error envelope'''`
      block (per design.md Decision 5 / spec.md "Envelope contract documented on Connector"),
      naming `CreateSourceEnvelope.build` and describing the failure/success shape.

## 2. Tests

- [x] 2.1 Run the existing `SourceServiceSpec` create-path tests (`createSql`/`createRest`, success +
      failure) unmodified — confirm byte-identical `CreateSourceResponse` output after the refactor.
- [x] 2.2 Add a test-connector fixture (mirroring `NewConnectorInferenceSpec`'s `RowSupplyingConnector`
      pattern) exercising `CreateSourceEnvelope.build` directly: a success case (persists a `DataType`,
      `fetchError = None`) and a failure case (`dataType = None`, `fetchError = Some(err)`). The
      failure-case assertion MUST compare `fetchError` to the fixture's `Left(err)` string with
      strict equality (e.g. `result.fetchError shouldBe Some("fixture unreachable")`, not `shouldBe
      defined`) — this is the concrete, checkable proof that the helper forwards `err` verbatim with
      no re-wrapping, re-prefixing, or truncation, replacing any code-review-level claim with a test
      that fails if that property regresses.

## 1. Backend — secret redaction seam

- [x] 1.1 Create `backend/src/main/scala/com/helio/services/SecretField.scala` defining
  `SecretField[Config]`, `HasSecrets[Config]`, `SecretBackend`, `InlineSecretBackend`
  (`mask` → `"***"`, doc comment naming HEL-536 as the owner of future backends), and
  `SecretRedaction.redact[Config](config, backend: SecretBackend = InlineSecretBackend)
  (implicit hs: HasSecrets[Config]): Config`
- [x] 1.2 Add `implicit val hasSecrets: HasSecrets[SqlSourceConfigPayload]` to
  `SqlSourceConfigPayload`'s companion object in `DataSourceProtocol.scala`, declaring the
  `password` field with the empty-string exemption preserved in its `get`
- [x] 1.3 Add `implicit val hasSecrets: HasSecrets[RestApiConfigPayload]` to
  `RestApiConfigPayload`'s companion object, declaring the bearer `auth.token` and api-key
  `auth.value` fields, each gated on the matching auth-type discriminator
- [x] 1.4 Replace `redactSqlPayload`/`redactRestPayload`/`redactRestAuth` calls in
  `DataSourceResponse.fromDomain` with `SecretRedaction.redact(...)` for the `RestSource` and
  `SqlSource` cases; remove the now-unused private redaction methods
- [x] 1.5 Add a `'''Secret redaction'''` doc block to `Connector.scala`'s trait-level doc comment,
  alongside the existing four blocks (`Refresh semantics`, `ExecutionContext`, `Schema inference`,
  `Fetch-error envelope`), naming `HasSecrets` and `SecretRedaction.redact`

## 2. Tests

- [x] 2.1 Add JSON-level assertions to `DataSourceProtocolSpec.scala` (new test block, existing
  tests untouched): serialize `DataSourceResponse.fromDomain(...)` via `.toJson` for a REST bearer
  source, a REST api-key source, and a SQL source with a non-empty password, and assert the raw
  secret string is absent from the serialized text while `"***"` is present at the expected field
- [x] 2.2 Add a unit test for `SecretRedaction.redact` directly (in `services/` test package):
  masks a present field, leaves an absent field untouched, leaves non-secret fields untouched
- [x] 2.3 Add a unit test proving the SQL empty-password exemption survives the new path (empty
  password stays `""` after `SecretRedaction.redact`, not `"***"`)
- [x] 2.4 Run `sbt test` and confirm the full suite passes, including the pre-existing
  `DataSourceProtocolSpec` "credential redaction" block unmodified

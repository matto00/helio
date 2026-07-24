- `backend/src/main/scala/com/helio/services/SecretField.scala` — new file; defines the generic
  redaction seam (`SecretField`, `HasSecrets`, `SecretBackend`, `InlineSecretBackend`,
  `SecretRedaction.redact`) per design.md Decisions 1/3/4.
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — added
  `implicit val hasSecrets: HasSecrets[SqlSourceConfigPayload]` (password field, empty-string
  exemption preserved) and `implicit val hasSecrets: HasSecrets[RestApiConfigPayload]` (bearer
  `auth.token` + api-key `auth.value`, each gated on the matching auth-type discriminator) in
  each payload's own companion object; replaced the `redactSqlPayload`/`redactRestPayload`/
  `redactRestAuth` calls in `DataSourceResponse.fromDomain` with `SecretRedaction.redact(...)` and
  removed the now-unused private redaction methods.
- `backend/src/main/scala/com/helio/domain/Connector.scala` — added the `'''Secret redaction'''`
  doc block to the trait-level comment (doc-only change, no behavior change).
- `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala` — added a new
  "DataSourceResponse.fromDomain serialized JSON never leaks raw secrets" test block asserting on
  `.toJson.compactPrint` text (not a helper's return value) for REST bearer, REST api-key, and SQL
  password sources. The pre-existing "DataSourceResponse.fromDomain credential redaction" block is
  unmodified (verified via `git diff`).
- `backend/src/test/scala/com/helio/services/SecretFieldSpec.scala` — new file; unit tests for
  `SecretRedaction.redact` (masks present field, leaves absent field untouched, leaves non-secret
  fields untouched, honors a custom `SecretBackend`), `InlineSecretBackend.mask`, and a direct
  (non-`fromDomain`) proof that `SqlSourceConfigPayload`'s empty-password exemption survives the
  new path.
- `openspec/changes/connector-secret-redaction-seam/tasks.md` — all 9 tasks marked complete.

## 1. Migration + domain model

- [x] 1.1 `V93__connectors.sql` per design.md Decision 1/2 (real columns + `config` JSONB +
      `credential_id` FK `RESTRICT` + owner-only RLS, `FORCE ROW LEVEL SECURITY`)
- [x] 1.2 `Connector` domain case class + `ConnectorId` value class
      (`backend/src/main/scala/com/helio/domain/model/Connector.scala`), reusing
      `DataSourceKind` for the kind discriminator
- [x] 1.3 `ConnectorMeta` (or equivalent) response shape — structurally cannot carry a secret,
      mirroring `ConnectorCredentialMeta`'s own doc comment pattern

## 2. Repository

- [x] 2.1 `ConnectorRepository`: `create` (calls `ConnectorCredentialRepository.create` —
      its own committed transaction — then inserts the `connectors` row in a second
      transaction using the returned `credential_id`; on the second insert's failure, a
      best-effort compensating `ConnectorCredentialRepository.delete` of the just-created
      credential — see design.md Decision 2 for the accepted orphan-row edge case), `get`,
      `list`, `update` (non-secret fields only), `delete(id, dependentCount: ConnectorId =>
      Future[Int] = _ => Future.successful(0))` (design.md Decision 4 — 409 when nonzero,
      then `ConnectorCredentialRepository.delete` for the referenced credential)
- [x] 2.2 All methods run under `DbContext.withUserContext` (owner-scoped), mirroring
      `ConnectorCredentialRepository`
- [x] 2.3 `credential_id` passed to the `connectors` insert is always the id
      `ConnectorCredentialRepository.create` just returned — never a caller-supplied value —
      so a cross-tenant credential reference has no code path to occur through (design.md
      Decision 2 load-bearing note: Postgres FK validation bypasses RLS)

## 3. Routes + JSON protocols

- [x] 3.1 New `ConnectorEntityRoutes` (`api/routes/sources/`) mounted at `/api/connectors`:
      `POST`, `GET` (list), `GET /:id`, `PATCH /:id`, `DELETE /:id`. Distinct from the
      existing `ConnectorRoutes` (`GET /api/connector-types`, HEL-484/825) — do not rename or
      touch that file (design.md Decision 7)
- [x] 3.2 Create request accepts a credential value; response never includes it (AC2/AC3)
- [x] 3.3 Update request rejects a credential/secret field (design.md Decision 3) — 400, not
      silent ignore
- [x] 3.4 Delete returns 409 `ConnectorHasDependents` when `dependentCount` is nonzero
      (design.md Decision 4's real seam, not a stub)
- [x] 3.5 New `ConnectorEntityProtocol` trait in
      `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala`,
      mixed into the `JsonProtocols` aggregator trait (`api/JsonProtocols.scala`); distinct
      from the existing `ConnectorProtocol.scala`. Wire routes into
      `backend/src/main/scala/com/helio/api/ApiRoutes.scala`

## 4. Verification — the acceptance criteria, each with real evidence

- [x] 4.1 **DB-direct proof (AC2):** integration test that creates a Connector, then queries
      `connector_credentials`/`connectors` directly via a raw JDBC/Slick query (not through the
      repository) and asserts the stored ciphertext bytes are neither equal to nor a substring
      of the plaintext, nor a trivial base64 encoding of it
- [x] 4.2 **Read-path enumeration (AC3):** per design.md Decision 6 — forward pass (all five
      route responses: POST/GET/GET-list/PATCH/DELETE including error bodies, each asserted
      secret-free) and backward pass (grep for `decryptForUse`, `EncryptedSecretBackend`/
      `secretBackend.decrypt`, and `unwrapDataKey`/`withSystemContext`, confirming every call
      site outside `ConnectorCredentialRepository`/`EncryptedSecretBackend`/
      `MasterKeyProvider` is either this ticket's AC5 test or the pre-existing
      `rewrapAllBelow` maintenance path). State both directions explicitly in the
      evaluator-facing test/comment, not just "checked."
- [x] 4.3 **No logging (AC4, coordinate not absorb):** grep the new code for any `log.*`/
      `println`/string-interpolation call site that could include the plaintext or
      `EncryptedPayload`'s raw bytes; confirm `EncryptedPayload.toString`'s existing redaction
      (HEL-536) is not bypassed by this ticket's new code
- [x] 4.4 **Real outbound-auth proof (AC5):** integration test that creates a Connector with
      a real credential, decrypts it via `decryptForUse` (test-only caller — design.md
      Decision 6a), starts an in-process local stub HTTP server that asserts the exact
      credential value on the incoming `Authorization`/API-key header, and makes a genuine
      HTTP request against it — not a stubbed decryptor, and not a third-party network
      dependency
- [x] 4.5 **Cross-user RLS proof (ACL requirement):** test running as `helio_app_test`
      (non-bypassing role, per HEL-536's own tests) proving a second user cannot read/list/
      delete the first user's Connector — must fail identically with RLS enabled that a
      RLS-disabled run would NOT fail, i.e. demonstrate the test actually exercises RLS
- [x] 4.6 **Delete-with-dependents behavior test (AC6):** test `ConnectorRepository.delete`
      via the real route, injecting a `dependentCount` collaborator that returns a nonzero
      count (design.md Decision 4's real seam), asserting a 409 `ConnectorHasDependents` and
      that no row is deleted — exercises the shipped code path, not an isolated stub

## 5. Out-of-scope findings (record, do not fix)

- [x] 5.1 Note in the evaluator/skeptic-facing summary: credential rotation UX (Decision 3),
      MCP tool for Connectors, preview/test endpoint, and the real dependent-source FK (all
      belong to HEL-822+)

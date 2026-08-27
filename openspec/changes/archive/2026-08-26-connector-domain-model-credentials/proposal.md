## Why

v1.9 connectors (HEL-820) need a saved, reusable, credentialed host — one Connector many
sources can reference — instead of every source re-entering its own copy of a token. HEL-536
already shipped the encryption substrate this needs (`EncryptedSecretBackend`,
`ConnectorCredentialRepository`, `connector_credentials`/V92); HEL-825 freed the `Connector`
name. This is the spine ticket: children 3 (sources referencing Connectors) and 4
(templating) cannot start until the domain model and storage exist.

## What Changes

- New `Connector` domain type (`ConnectorId`, owner, name, kind, base host/URL, timestamps),
  reusing `DataSourceKind`/`ConnectorRegistry` vocabulary — no parallel kind enum.
- New Flyway migration: `connectors` table, owner-scoped RLS mirroring `data_sources`
  (V14/V35 pattern — `owner_id UUID NOT NULL`, `FORCE ROW LEVEL SECURITY`).
- `connectors.credential_id` references `connector_credentials(id)` (V92, HEL-536) — the
  secret itself is never duplicated into a second storage location.
- `ConnectorRepository` + new `ConnectorEntityRoutes`/`ConnectorEntityProtocol` serving
  `POST/GET/PATCH/DELETE /api/connectors` (the *path* was freed by HEL-825; the existing
  `ConnectorRoutes`/`ConnectorProtocol` classes, serving `GET /api/connector-types`, are
  distinct and untouched — see design.md Decision 7). Update handler accepts only non-secret
  fields; secret rotation is a distinct create-new-credential-and-repoint operation, never a
  PATCH of the ciphertext.
- Delete semantics for a Connector with dependent sources: **block** (409), matching the
  existing `data_sources` FK behavior (`ON DELETE SET NULL` — but a Connector reference is a
  hard dependency, not incidental metadata, so this ticket chooses to block rather than
  silently orphan a source's auth). Documented in design.md.
- No new encryption mechanism — consumes `EncryptedSecretBackend`/`ConnectorCredentialRepository`
  exactly as HEL-536 shipped them (a sibling trait to `SecretBackend`, not an implementation).

## Capabilities

### New Capabilities
- `connectors/connector-management`: CRUD lifecycle for a persisted, owner-scoped Connector
  entity (create with credential, read/list metadata-only, update non-secret fields, delete
  with dependent-source guard).
- `connectors/connector-credential-binding`: how a Connector's secret is stored (by reference
  to `connector_credentials`), decrypted only for outbound use, and never returned by any
  read path.

### Modified Capabilities
(none — `data_sources`/`connector_credentials` behavior is unchanged; this only adds a new
consumer of the latter)

## Impact

New: `backend/.../domain/model/Connector.scala`, `V93__connectors.sql`,
`ConnectorRepository`, `ConnectorEntityRoutes` mounted at `/api/connectors`,
`ConnectorEntityProtocol`. No existing route class, schema, or client code is modified — the
existing `ConnectorRoutes`/`ConnectorProtocol` (`GET /api/connector-types`, HEL-484/825)
are distinct, untouched files; only the previously-free `/api/connectors` *path* is newly
claimed. Out of scope: sources referencing Connectors (HEL-822), UI (HEL-824), templating
(HEL-823), the HEL-616 log-scrubbing guard (coordinate, don't absorb).

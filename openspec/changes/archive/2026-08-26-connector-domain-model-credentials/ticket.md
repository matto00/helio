# HEL-821: Connector domain model + encrypted credential storage (first real SecretBackend)

## Description

**Naming settled 2026-08-25:** the entity is a **Connector** (host + credential), per the product owner. Any occurrence of "Connection" below means **Connector**. The internal `Connector[Config]` SPI trait was renamed out of the way by HEL-825 (landed as `ConnectorDriver[Config]`, `SqlConnectorDriver`/`RestApiConnectorDriver`), which freed the `Connector` name for this ticket's user-facing entity.

Child 1 of HEL-820. **This is the spine — children 3 and 4 depend on it.**

### Scope

Introduce a persisted **Connector** entity: a saved, reusable, credentialed host that many sources can reference. REST: base URL + API key. SQL: host URL, username, password.

- New domain type + Flyway migration for a `connectors` table. The existing `data_sources` table stores all per-kind config in one opaque `config` TEXT/JSONB-as-string column (`V4__data_sources_and_types.sql`); decide deliberately whether Connectors follow that pattern or use real columns, and record the reasoning.
- Fields, at minimum: id, owner, name, connector kind (`rest_api` first), base host/URL, auth material, timestamps. Reuse `DataSourceKind`/`ConnectorRegistry` vocabulary rather than inventing a parallel kind enum.
- Ownership/ACL consistent with `data_sources` — check how sharing and RLS work for sources today and mirror it. Do not invent a new access model.

### The credential requirement — the hard part

Today the raw bearer token / API key is stored in plaintext inside `data_sources.config`. `SecretRedaction` masks it to `"***"` on read, which prevents client round-trip but is not storage security.

This ticket must introduce real encryption at rest. **CORRECTED (this run's brief supersedes the ticket's stale framing):** HEL-536 already shipped this substrate — `EncryptedSecretBackend`, `MasterKeyProvider`, `ConnectorCredentialRepository`, Flyway `V92__connector_credentials.sql` — and deliberately does NOT implement the `SecretBackend` trait from `SecretField.scala` (see HEL-536 design.md Decision 3a: `SecretBackend.mask` is total/infallible, encryption must be able to fail, so `EncryptedSecretBackend` is a sibling trait, not an implementation). **Consume `EncryptedSecretBackend`/`ConnectorCredentialRepository` as-is. Do not build a second parallel mechanism, and do not "fix" `EncryptedSecretBackend` back toward implementing `SecretBackend`.**

`TokenHashing` is not usable here: it is one-way SHA-256 for session/MFA tokens. An outbound HTTP call needs the value recoverable, so this needs reversible encryption, not hashing — already resolved by HEL-536's envelope encryption.

Work out deliberately how the new `connectors` table relates to the existing `connector_credentials` table (V92) — whether the credential lives there by reference or whether `connectors` needs columns of its own — rather than duplicating storage. State the reasoning in design.md.

### Read-path contract

The raw secret is written once and never returned by any read path — not the REST API, not MCP, not the UI, not logs. It is decrypted only at the point of making an outbound request.

## Acceptance Criteria

- [ ] A `Connector` can be created, read, updated (non-secret fields), and deleted
- [ ] The credential is encrypted at rest — verified by querying the database directly and confirming the stored bytes are not the plaintext secret. Reading the code is not sufficient evidence
- [ ] Demonstrated: no read path returns the raw secret. Enumerate the read paths (REST GET/list, MCP, any preview/test endpoint) and verify each; state the enumeration was checked in both directions
- [ ] The secret does not appear in logs at any level — HEL-616 (mechanical guard) is a separate ticket, NOT in this ticket's scope; do not absorb it, but do not ship something it would immediately catch either
- [ ] An outbound request can still authenticate — i.e. the value is genuinely recoverable, proven by a real fetch against a live endpoint, not a unit test with a stubbed decryptor
- [ ] Deleting a Connector with dependent sources behaves deliberately (block, or cascade with warning) — decide and document; do not leave it to referential accident

## Out of Scope

Sources referencing Connectors (HEL-822), the UI (HEL-824), templating (HEL-823). This ticket is the model and the storage. Record any out-of-scope findings for the human to triage; do not fix them and do not file tickets.

## Environment note

The production Secret Manager master-key secret is NOT YET PROVISIONED (user's own action item from HEL-536). Do not provision any GCP resource. Follow HEL-536 design.md Decision 4 for local-dev/CI key resolution (`CONNECTOR_MASTER_KEY` as an ordinary required env var, no environment-conditional logic in application code).

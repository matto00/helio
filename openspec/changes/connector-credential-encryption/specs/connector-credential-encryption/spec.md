## Purpose

Provides an owner-scoped, envelope-encrypted storage substrate for third-party connector
credentials so v1.9 connectors persist secrets safely instead of inventing per-connector schemes.

## ADDED Requirements

### Requirement: Credentials are stored ciphertext, never plaintext
Any credential value written through the storage helper SHALL be encrypted before it reaches
persistent storage. A direct query of the underlying storage SHALL NOT reveal the plaintext value.

#### Scenario: Written credential is ciphertext at the storage layer
- **WHEN** a credential value is written through the storage helper
- **THEN** querying the underlying table directly for that row returns a value that does not equal,
  and does not contain as a substring, the original plaintext

#### Scenario: Round-trip encrypt/decrypt
- **WHEN** a credential is written and then read back through the storage helper with the correct
  master key configured
- **THEN** the value returned equals the original plaintext exactly

### Requirement: Writes fail closed when no master key is configured
The storage helper SHALL refuse to write a credential when no master key is configured or the
configured key cannot be resolved. It SHALL NOT fall back to storing the value in plaintext under
any circumstance.

#### Scenario: Write attempted with no master key configured
- **WHEN** a credential write is attempted while the master-key configuration is absent or invalid
- **THEN** the write fails with an explicit error and no row (plaintext or otherwise) is persisted

### Requirement: Decryption fails closed on the wrong or rotated master key
Reading a credential encrypted under a previous master key, using a different or rotated key,
SHALL fail explicitly rather than returning corrupted or partial plaintext.

#### Scenario: Read attempted after the master key changes without re-wrapping
- **WHEN** a credential encrypted under key A is read while only key B is configured
- **THEN** decryption fails with an explicit error, not a silently wrong value

### Requirement: Credential storage is owner-scoped under row-level security
Each stored credential SHALL be associated with exactly one owning user, and the database SHALL
enforce that a non-owning user cannot read another user's credential rows, independent of any
application-layer filtering.

#### Scenario: Cross-user read is denied at the database layer
- **WHEN** a query for another user's credential row is executed under that other user's
  database session context (not a privileged/bypassing role)
- **THEN** zero rows are returned, proving the denial is enforced by row-level security rather than
  by application-side filtering alone

### Requirement: Decrypted values are never returned to API clients
The plaintext credential value SHALL be accessible only within the privileged server-side context
that performs the outbound connector call. No API response SHALL echo a decrypted credential value.

#### Scenario: Credential value is write-only from the client's perspective
- **WHEN** a client requests any representation of a stored credential via the API
- **THEN** the response never contains the decrypted plaintext value

### Requirement: Local development and CI operate without a production master key
The system SHALL resolve the master key from a single configuration source (`CONNECTOR_MASTER_KEY`)
that behaves identically in every environment. Local development and CI SHALL be able to supply
their own non-production value through that same source, with no development-only key value or
dev/prod branch present in application code — so there is no code path by which a
non-production key could activate under production configuration, because there is no
environment-conditional logic to activate.

#### Scenario: Local/CI run with a locally-supplied key value
- **WHEN** the backend starts with `CONNECTOR_MASTER_KEY` set to a non-production value chosen by
  the developer or CI environment
- **THEN** it boots successfully and credential encryption/decryption works using that value, with
  no different code path than production would take

#### Scenario: No environment-conditional key logic exists
- **WHEN** the codebase is inspected for any environment-conditional (dev vs. prod) master-key
  selection logic
- **THEN** none exists — `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` (and, during a rotation
  window, `CONNECTOR_MASTER_KEY_PREVIOUS`/`CONNECTOR_MASTER_KEY_PREVIOUS_ID`) are the only inputs,
  resolved the same way regardless of environment

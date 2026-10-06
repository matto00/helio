## Why

`ConnectorRepository.rotateCredential` fires the old credential's delete as a discarded `Future` and returns success
immediately. Rotation can therefore return while the old encrypted credential row still exists and is still
decryptable by id; if that delete fails it is swallowed and the old credential survives forever. The spec's
immediate `None` assertion races that delete, which is how `backend (0)` failed once in CI (HEL-1296 lane).
This is a product defect, not only a test flake: a rotated-away secret must be gone when rotation reports success.

## What Changes

- Rotation inserts the new credential, repoints the Connector, and deletes the old credential in ONE database
  transaction under the caller's user context. Rotation returns only after that transaction commits; any failure
  (including the old-credential delete) rolls the whole rotation back, leaving the Connector on its original
  credential.
- The "best-effort, never block success" old-credential delete and the separate compensation deletes go away
  (a single transaction makes them unnecessary).
- A regression test that is deterministically red against the old fire-and-forget shape and green with the fix.

## Capabilities

### New Capabilities

### Modified Capabilities
- `connectors/connector-management`: adds a requirement that a rotated-away credential is gone (not resolvable) by
  the time rotation reports success, and that rotation is all-or-nothing.

## Impact

- `backend/.../persistence/sources/ConnectorRepository.scala` (`rotateCredential`).
- `backend/.../persistence/auth/ConnectorCredentialRepository.scala` (expose DBIO-level insert/delete builders
  so the rotation can compose them into one transaction; existing Future methods unchanged).
- `ConnectorRepositorySpec` (new deterministic regression test). No migration, no API shape change.

## Non-goals

- No change to `delete` (Connector deletion) or the completion path, beyond what sharing a DBIO builder implies.
- No change to master-key rotation (`rewrapAllBelow`) or envelope-encryption format.
- No CI workflow changes.

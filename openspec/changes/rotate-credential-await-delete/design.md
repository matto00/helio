## Context

See proposal.md (Why). Today `ConnectorRepository.rotateCredential` (HEL-824 Decision 1) runs three separate
transactions: `credentialRepo.create` (its own `withUserContext`), the `connectors.credential_id` repoint (its own
`withUserContext`), then `existing.credentialId.foreach(old => credentialRepo.delete(old, ...).recover{...})` whose
Future is discarded before `Future.successful(Right(...))`. `DbContext.withUserContext` wraps each `db.run` in
`.transactionally` with `SET LOCAL app.current_user_id`, so composing DBIOs into ONE `withUserContext` call yields one
transaction under the caller's RLS identity. `connectors.credential_id` REFERENCES `connector_credentials(id)` ON
DELETE RESTRICT (V93), so the old row can only be deleted after the repoint -- ordering inside the transaction is
insert-new -> repoint -> delete-old. Encryption (`EncryptedSecretBackend.encrypt`) is pure CPU and must stay BEFORE
any DB work so the no-master-key path still fails with zero writes (existing scenario). Read before implementing:
`docs/secrets-inventory.md`, `openspec/changes/archive/2026-08-26-connector-credential-encryption/design.md`.

`ConnectorRepositorySpec`'s app pool runs `SET ROLE helio_app_test` (NOSUPERUSER, no BYPASSRLS), so RLS policies are
actually enforced for `withUserContext` calls in this spec -- unlike most dev/CI paths (MISTAKES.md "RLS policies
never run in dev or CI"). The privileged pool (`withSystemContext`, BYPASSRLS) MUST NOT be used for rotation.

## Goals / Non-Goals

**Goals:** old credential unresolvable the instant rotate returns success; rotation all-or-nothing; a regression test
that is deterministically red on the fire-and-forget shape (not "red sometimes under load").

**Non-Goals:** Connector `delete`, the completion path, master-key rewrap, API/route/response shape, CI config.

## Decisions

**D1 -- One transaction under the caller's user context.** Add DBIO-level builders to
`ConnectorCredentialRepository` (e.g. `insertAction(userId, name, plaintext): Either[err, (DBIO[Int], Meta)]` or an
encrypt-then-build split, and `deleteAction(id): DBIO[Int]`), keeping the existing Future-returning `create`/`delete`
as thin wrappers over them so every other caller is behaviour-identical. `rotateCredential` encrypts first (fail
closed, no write), then runs `insert new >> repoint >> delete old` in a single `ctx.withUserContext(user.id.value)`.
Alternative rejected: keep three transactions and just `flatMap` on the delete -- closes the observed race but leaves
a non-atomic window (crash/failure after repoint, before delete leaves the old secret stored forever, and the
compensation deletes stay as best-effort code). The driver explicitly asked for one transaction if possible; it is.

**D2 -- Old credential id is read under lock inside the transaction.** Inside the same transaction, read the
connector's current `credential_id` with `SELECT ... FOR UPDATE` (Slick `.forUpdate`) scoped to the owner, and delete
THAT id (not the value from the earlier unlocked `findByIdOwned`). This keeps two concurrent rotations from each
repointing and leaving one freshly minted credential orphaned. `findByIdOwned` stays as the up-front gate for the
not-found / pending refusal branches (unchanged refusal semantics). If the locked re-read finds the row gone or
pending (concurrent delete), the transaction fails/rolls back to `Left(ConnectorRotationNotFound)` with no writes.

**D3 -- Failure semantics.** Any failure inside the transaction (insert, repoint, delete-old) rolls everything back
and propagates as a failed Future (or `Left(ConnectorRotationNotFound)` for a zero-row repoint), so the Connector keeps
its original, still-decryptable credential and no new credential row remains. The old "best-effort, never block
success" delete is intentionally removed: a rotation whose old secret could not be removed is not a successful
rotation. This is within the driver's threshold ("old credential is gone when rotate returns") -- it narrows, never
widens, when a credential is usable; no escalation needed.

**D4 -- Deterministic red/green regression test, implementation-agnostic.** In `ConnectorRepositorySpec`, before
rotating, open a separate JDBC connection (EmbeddedPostgres superuser datasource, already in the spec) and in an open
transaction `SELECT ... FROM connector_credentials WHERE id = <old> FOR UPDATE`, holding the row lock. Start the
rotation; release the lock (commit/rollback the holder) only after a fixed delay (e.g. 750 ms) or after observing the
rotation is waiting. Assert: the rotation Future is NOT completed before the lock is released, and after it completes,
`credentialRepo.get(old)` and `decryptForUse(old)` are `None` immediately. On the old code, rotate completes while the
delete is blocked and `get(old)` returns `Some` (MVCC reads do not block on row locks) -> deterministically red.
Must record the red run against the unfixed code as evidence. Locks are released in a `finally`.
Second test for D3: a test-only subclass of `ConnectorCredentialRepository` overriding the delete DBIO builder with
`DBIO.failed(...)`; assert rotation fails, Connector still points at the original credential which still decrypts,
and the minted credential does not exist (`credentialRepo.list(owner)` contains only the original id).

**D5 -- Root-cause probe and contention evidence.** Before the fix, the executor demonstrates the window with a probe
(the D4 lock test run against the unfixed code IS the probe; optionally also a delayed-delete subclass on the old
code) and records it in `probe.md`. Contention evidence: run `ConnectorRepositorySpec` (`testOnly`) >= 20
consecutive times with fix while a second concurrent JVM test load runs (2-fork contention; total <= 4 workers,
`nice -n 19`, load PIDs recorded and killed by PID only). Also record the before-fix rate of the ORIGINAL assertion
under the same contention (expected low/zero -- the race is narrow, which is why D4's deterministic test matters).

## Risks / Trade-offs

- [Rotation now fails where it used to "succeed" if the old delete fails] -> intended (D3); covered by the D4 test.
- [Lock-based test hangs if rotation deadlocks] -> bound every await (e.g. 10 s) and release the lock in `finally`.
- [Builder refactor changes other callers] -> `create`/`delete` keep exact signatures and behaviour; existing specs
  (`ConnectorCredentialRepositorySpec`, completion specs) must stay green.
- [RLS: one txn with `SET LOCAL` covers all three statements] -> same owner for all rows; spec runs non-BYPASSRLS.

## Planner Notes

- Self-approved: product fix (not test-only) -- the fire-and-forget delete is visible in source and is a real
  retention defect; the driver pre-authorised fixing without escalation within the stated threshold.
- Self-approved: D2 lock re-read is a small, in-scope hardening of the same method; no API change.
- No migration, no new dependency, no gate-chain (.husky) files touched.

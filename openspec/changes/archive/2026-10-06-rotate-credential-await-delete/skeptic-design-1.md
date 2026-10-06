## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket/proposal/design/tasks/spec delta and live code: ConnectorRepository.rotateCredential (lines ~216-262), ConnectorCredentialRepository, DbContext.withUserContext (`db.run((setUserVar andThen action).transactionally)`, app pool), V92/V93 policies+FK, ConnectorRepositorySpec setup and rotate tests. Did not run sbt.
- Defect is real in source: the old-delete Future is discarded (`foreach(... .recover{...})`) before `Future.successful(Right)`. Product defect, correctly classified.
- (a) D4: Old code: repoint UPDATE's RI check locks only the NEW referenced row (key-share), not the old row, so rotate completes while the discarded DELETE blocks on the holder's FOR UPDATE; the "rotation not completed before lock release" assertion fails deterministically on old code. Fixed code: the delete is inside the awaited txn so it blocks until release. Pools: app pool max 5, lock holder uses a separate superDs connection, so no pool starvation. Await is 10s helper, holder released in finally.
- (b) D1/D2: single withUserContext = one txn with SET LOCAL; connectors/connector_credentials policies are owner-only (user_id/owner_id = current_setting), same owner for all rows; spec's app pool is SET ROLE helio_app_test (non-BYPASSRLS). Privileged pool explicitly forbidden. FK RESTRICT ordering insert->repoint->delete is correct; only FK to connector_credentials is V93 connectors.credential_id (grep), so no other blocker.
- (c) No-key: encrypt before any DB work, Left -> Future.failed(ConnectorCredentialEncryptionFailed); existing spec expects exactly that exception and no writes. Preserved.
- (d) Scope: change narrows when a credential is usable ("old gone when rotate returns"); no schema/API/semantic widening, no migration. No owner escalation needed. All ACs covered (probe 1.1/1.2, fix, red test, 20x runs 3.4).

### Verdict: CONFIRM

### Non-blocking notes (implementer should heed)
1. D4 ordering: the red-on-old-code claim "get(old) returns Some" only holds if get(old) is read BEFORE the lock is released; after release the old discarded delete completes. The deterministic red is really the "Future not completed while lock held" assertion (e.g. `Await.ready` with short timeout must time out, or `isCompleted shouldBe false` after a delay). Make that the primary assertion and put any get(old)=Some check pre-release if used.
2. Fixed-code wait: assert not-completed after a delay, but also ensure the delay is long enough that old code has surely completed (poll for completion up to a bound rather than a bare sleep) so red is not timing-dependent on a loaded CI box.
3. D2: put the locked FOR UPDATE connector read first in the txn (before insert) to avoid minting a row in a lost race; handle credential_id None/row-gone as Left(ConnectorRotationNotFound) via rollback without throwing past the txn incorrectly (use a sentinel/Either result, not exception, so the Left is returned).
4. D3 test subclass requires ConnectorCredentialRepository's builder to be overridable (non-final, non-private).

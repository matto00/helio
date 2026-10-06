## Standing Constraints

- [C1] The D4 regression test's deterministic red is the assertion that the rotation Future is NOT completed while the old-credential row lock is held; detect old-code completion by bounded polling, not a bare sleep; any get(old)==Some check must be read before lock release.
- [C2] The FOR UPDATE connector read is the FIRST statement in the rotation transaction; row-gone/pending maps to Left(ConnectorRotationNotFound) via an Either/sentinel result with rollback, not a thrown exception; the delete DBIO builder is overridable (non-final, non-private) for the D3 test.

## 1. Probe (before any fix)

- [x] 1.1 Write the D4 lock-holding regression test against UNFIXED code; run it and record the red output in probe.md
- [x] 1.2 Record before-fix behaviour of the original rotate test under 2-fork contention (N runs, failure count) in probe.md

### Backend

## 2. Backend

- [x] 2.1 Add DBIO-level insert/delete builders to ConnectorCredentialRepository; keep create/delete as wrappers; existing specs green
- [x] 2.2 Rewrite rotateCredential: encrypt first, then insert/locked re-read/repoint/delete-old in one withUserContext txn; remove best-effort deletes
- [x] 2.3 Update rotateCredential doc comment to state the atomic contract (no stale "best-effort" wording)

### Tests

## 3. Tests

- [x] 3.1 D4 lock test green with fix (and was red in 1.1); awaits bounded, lock released in finally
- [x] 3.2 D3 failing-delete test: rotation fails, original credential still bound and decryptable, no minted row left
- [x] 3.3 Existing ConnectorRepositorySpec / ConnectorCredentialRepositorySpec / ConnectorCompletionServiceSpec / route specs green
- [x] 3.4 >= 20 consecutive green ConnectorRepositorySpec runs under 2-fork contention, recorded in probe.md with load PIDs
- [x] 3.5 Full `nice -n 19 sbt testFull` green (timeout 600000, <= 2 workers); note any FirstRunRoutesSpec timeout / heap error

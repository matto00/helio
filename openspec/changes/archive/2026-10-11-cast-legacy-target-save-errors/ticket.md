# HEL-1514: Cast step with a stored legacy target silently loses edits: the server 422s the full-map PATCH and the UI swallows the error

## Description

HEL-1476's final skeptic reproduced this; it predates HEL-1476 (matto00/helio#965).

**Repro:** take a cast step whose stored config holds a legacy target that HEL-1436 now rejects at write time, and edit any OTHER row of that cast. The client sends the whole map, the server rejects it with a 422, and `useStepCardPersist` swallows the error for cast because `captureErrors` isn't set. The UI looks saved, but nothing is persisted. That's silent data loss.

**Fix:** enable `captureErrors` for cast, as HEL-1416 did for fillnull/window/pivot, so the 422 shows on the card. Then decide (product call) whether the editor should offer to migrate the legacy target. HEL-1476 now shows a stored unsupported target as a disabled "`<value>` (unsupported)" option. Write the test so it fails first.

**Also from HEL-1476:** duplicate doesn't run create's secondary-source access check, lane check, or upsert-ownership check. HEL-1476 neither caused nor widened this. Audit and pin it.

## Acceptance Criteria

- A cast step PATCH rejected by the server (e.g. 422 for a stored legacy target) surfaces its message on the step card; nothing looks saved when it wasn't. Proven by a test that fails before the fix.
- The legacy-target product call (show error only vs. offer migration/replacement) is escalated to the owner and implemented per the answer.
- Duplicate's missing create-time checks (secondary-source access, lane check, upsert-ownership) are each audited; every real gap is pinned by a test that fails first. Any authorization gap is escalated with an exact repro, never fixed silently.

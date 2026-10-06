# HEL-1338: ConnectorRepositorySpec: rotateCredential does not await old-credential delete (race; failed backend(0) once)

## Description

origin_kind: followup
origin_ticket: HEL-1296

The HEL-1296 lane saw `backend (0)` fail once, on run 37432926643. The backend code was identical to a head where the
same test passed. The lane's diagnosis: `ConnectorRepository.rotateCredential` does not wait for the old credential's
delete to finish, while the spec asserts `None` straight away. This race exists on main.

## Acceptance Criteria

- Root-cause it with a probe: make the window deterministic, for example by delaying the delete.
- Decide whether this is a product bug or a test defect. If rotation can return before the old credential is gone,
  that is a product correctness and security question, because an old credential would stay usable for a short
  window. Escalate if so.
- Fix the actual cause, and add a test that is red without the fix.
- Run it 20 or more times consecutively under 2-fork contention, all green.

## Driver instructions (binding for this run)

- Escalation threshold (driver ruling): if rotation can return before the old credential is gone, fix the product so
  rotation is atomic / awaits the delete, in one transaction if possible, with a test red without the fix. Escalate
  ONLY if the fix changes credential semantics beyond "the old credential is gone when rotate returns".
- If it turns out to be only a test defect, state why the product is correct.
- Show >= 20 consecutive green runs under 2-fork contention.
- Read `docs/secrets-inventory.md` and the HEL-536 envelope-encryption design before touching credential code. The
  RLS and privileged-pool hazards in MISTAKES.md apply.
- Run `nice -n 19 sbt testFull` with Bash timeout 600000 and at most 2 workers; contention repros at most 3-4 workers
  total; kill load processes only by recorded PIDs. `sbt --client shutdown` as its own Bash call.
- Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`. At most one CI run at a time.
- EmbeddedPostgres only; never the owner's `matt@helio.dev` account. Never pick deletion targets by pattern/name/time.
- Report any FirstRunRoutesSpec timeout or "Java heap space".
- Scratch logs go in the worktree's openspec change dir or a scratch dir inside the worktree, never under ~ elsewhere.

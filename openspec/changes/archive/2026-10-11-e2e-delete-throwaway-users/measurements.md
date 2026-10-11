# HEL-1301 measurements

All figures read-only from the shared dev DB (`users` table), full e2e suite (219 tests, 47 files), 2 workers,
`nice -n 19`, this lane's ports (DEV_PORT=6733, BACKEND_PORT=9640). Raw snapshots: the run evidence dir
`.concertino/runs/HEL-1301/hel1301/`.

## Before (base commit 38acc6083, no registry)

| | users |
|---|---|
| snapshot before the run | 13120 |
| snapshot after the run (219 passed, 11.6 min) | 13342 |
| exact set difference (ids present after, absent before) | **222 added, 0 removed** |

Attribution: all 222 new rows carry an email whose epoch-ms stamp lies inside the run's start/end window, each
prefix maps to a spec file in e2e/ (hel287 = auth-cookie-migration, hel866 = state-surface-contrast-guard,
hel1392/hel1398 = the remount/chart specs), 189 of the 222 are exactly the emails the run logged
("throwaway user: ...") and the other 33 come from the call sites that never logged (e.g. the direct
`POST /api/auth/register` sites). No row outside this set appeared: no concurrent-lane noise was observed.
The 222 users were then deleted by exact (id, email) pair through the new builder (C4); the table returned to
exactly the original 13120 ids (diff of the id snapshots empty).

## After (branch, commit 3506d5ae3)

| | users |
|---|---|
| snapshot before the run | 13120 |
| snapshot after the run (219 passed, 11.2 min) | 13120 |
| exact set difference | **0 added, 0 removed** |

The teardown logged `deleted 222 recorded throwaway user(s)`: the same 222 users the base run left, created and
removed in one run; the run's registry directory was gone afterwards (`.e2e-user-registry/` empty). Wall time
672 s vs 698 s on the base: no measurable slowdown (one psql call at teardown; the difference is run-to-run noise).
Red-first: N=222 left before, 0 after.

## Other real-DB proofs

- One-spec runs (auth-cookie-migration + hel510: 14 users; regression config, 2 users): users before = after,
  registry directory removed, so the regression config inherits the hooks.
- DB-level guard (task 4.2, `dbproof.cjs`, two users created for the proof): a transaction with one correct
  pair and one id/email mismatch threw `1 of 2 recorded users match their exact id and email; nothing deleted`,
  both users still present; the correct pairs then deleted both (0 present).
  ```
  created 2 proof users; present: 2
  mismatched-email transaction threw: true | userCleanup: psql failed (is psql installed and the DB reachable?): ERROR:  userCleanup: 1 of 2 recorded users match their exact id and email; nothing deleted
  present after aborted txn (expect 2): 2
  present after exact delete (expect 0): 0
  ```

## Red first (task 1.2)

The selftest against a stub core (`DELETE ... LIKE '%@example.test'`, no refusals): **8 passed, 28 failed**, exit 1.
Against the real core: all green (39 checks incl. the credential-leak probe).

## Mutation proof (tasks 4.1, 4.5)

Each guard disabled one at a time in a copy of the core/db module; the selftest must go red:

| mutation | verdict | totals | first failing check |
|---|---|---|---|
| UUID check | RED | 38 passed, 2 failed | FAIL - non-UUID id refused: expected a throw, got SQL |
| system-user refusal (builder) | RED | 39 passed, 1 failed | FAIL - system user id refused: expected a throw, got SQL |
| plain-email check | RED | 36 passed, 4 failed | FAIL - quote in email refused: expected a throw, got SQL |
| owner refusal (builder) | RED | 39 passed, 1 failed | FAIL - owner account refused: threw "userCleanup: record 0 email is outside the e2e throwaway domains", expect |
| domain refusal (builder) | RED | 38 passed, 2 failed | FAIL - real-domain account refused: expected a throw, got SQL |
| email equality in guard JOIN | RED | 39 passed, 1 failed | FAIL - guard matches on exact id AND exact email |
| duplicate-id refusal | RED | 39 passed, 1 failed | FAIL - duplicate id refused: expected a throw, got SQL |
| empty-input refusal | RED | 39 passed, 1 failed | FAIL - empty input refused: expected a throw, got SQL |
| domain exclusion (SQL) | RED | 39 passed, 1 failed | FAIL - SQL repeats the e2e-domain refusal |
| owner exclusion (SQL) | RED | 39 passed, 1 failed | FAIL - SQL repeats the owner-account exclusion |
| system-user exclusion (SQL) | RED | 39 passed, 1 failed | FAIL - SQL repeats the system-user exclusion |
| FOR UPDATE lock | RED | 39 passed, 1 failed | FAIL - SQL locks the doomed rows FOR UPDATE |
| lock_timeout | RED | 39 passed, 1 failed | FAIL - SQL sets a lock_timeout |
| matched-count assertion | RED | 39 passed, 1 failed | FAIL - SQL asserts the matched count equals the recorded count |
| deleted-count assertion | RED | 39 passed, 1 failed | FAIL - SQL asserts the deleted count equals the recorded count |
| user delete by pattern (LIKE) | RED | 36 passed, 4 failed | FAIL - SQL has no email literal other than the recorded ones and the owner exclusion: '%@example.test' |
| child delete unscoped | RED | 39 passed, 1 failed | FAIL - every DELETE is scoped to the doomed set: DELETE FROM users WHERE id IN (SELECT id FROM hel1301_doomed) |
| own-run-dir isolation (reads sibling run dirs) | RED | 38 passed, 2 failed | FAIL - registry read returns both of this run's records |
| credential scrub (raw ${e} interpolation restored) | RED | 39 passed, 1 failed | FAIL - the thrown message carries no URL, user or password: selftest: psql failed (is psql installed and the D |
| credential scrub (scrubSecrets disabled) | RED | 39 passed, 1 failed | FAIL - scrubSecrets removes the URL, user and password: could not connect to postgresql://hel1301sentineluser: |

(The owner-account builder refusal is additionally backstopped by the domain refusal, which is why that mutation's
failure names the domain message; the check asserts the owner-specific message.)

## Gate-chain isolation (task 6a)

`test-gate-in-isolation.sh` PASS for scripts/check-e2e-user-cleanup.mjs, scripts/check-e2e-user-cleanup.selftest.mjs and
e2e/support/userCleanup.selftest.mjs.

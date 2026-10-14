## Standing Constraints

- [C1] Any process stop (fix or tests) addresses ONLY the attempt's own data directory via `pg_ctl -D <that dir>`. Never by port, process name, or PID search; never pkill/pgrep/killall/kill; tests never signal anything (observe via `ps -p <pid>` / `ProcessHandle.of(pid)` with the PID read from the attempt's own postmaster.pid).
- [C2] The red-first proof uses the deterministic post-launch fault hook (D4), never timing; a pre-fix leak is left to self-terminate, never killed by hand.
- [C3] No change to EmbeddedPostgresStartGuard rules or its exemption marker; no new direct `.start()` in specs.
- [C5] A fake postmaster.pid in tests holds non-numeric content, never a PID; the D3 test path runs no pg_ctl.
- [C4] Local caps: Bash timeout 600000; `nice -n 19`; at most 3 parallel workers; sbt in the foreground with `-J-Xmx3g`; never touch a Postgres cluster this run did not create.

**Execution order (red-first):** 1.1 -> 3.1 red run against the pre-fix cleanup (record failure + `ps -p` evidence) -> 1.2, 1.3, 1.4 -> 3.1 green -> 3.2-3.6.

### Backend

- [x] 1.1 Add `afterLibraryStart` and `postLaunchWait` parameters to `VerifiedEmbeddedPostgres.startWith` (defaults: no-op, 30 s); `start` unchanged; verify it compiles and existing callers are untouched.
- [x] 1.2 Implement the D2 throwing-start cleanup (epg-lock check, bounded opts poll, pg_ctl from postmaster.opts, `stop -m immediate -w`, `status` == 3, bounded child waits); verify by the 3.x tests.
- [x] 1.3 Implement D3 (unconfirmed stop keeps the dir, suppressed reason, original throwable rethrown unchanged); verify by test 3.3.
- [x] 1.4 Update the helper's doc comment to describe the post-launch case and the by-directory-only stop.

### Tests

- [x] 3.1 Red-first deterministic post-launch test (D5); run it against the pre-fix helper first and record the failure + `ps -p` evidence in `proof/red-green.txt`, then green.
- [x] 3.2 Realism guard via `setPGStartupWait(Duration.ZERO)` (D5); verify green 3 consecutive runs.
- [x] 3.3 Unconfirmed-stop test (D5: pre-filled epg-lock + non-numeric fake postmaster.pid, initdb failure, no server); verify green.
- [x] 3.3a Foreign-cluster post-launch test (D5: pinned to clusterA's port, ZERO startup wait); verify clusterA intact and green.
- [x] 3.4 Run VerifiedEmbeddedPostgresSpec, EmbeddedPostgresStartGuardSpec, EmbeddedPostgresGuardLexerSpec and one DB-backed route spec (e.g. ProductEventRoutesSpec); all green.
- [x] 3.5 Write `proof/zonky-citations.txt` (re-verified 2.0.7 line numbers + jar path) and finish `proof/red-green.txt` (D6).
- [x] 3.6 Update the stale `.epg-lock` reference only in new artifacts (archived HEL-1474 proof stays as-is); verify `grep -rn "epg-lock" backend/` matches only the correct name.

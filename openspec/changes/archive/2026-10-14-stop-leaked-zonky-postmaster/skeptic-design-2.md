## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/stop-leaked-zonky-postmaster/HEL-1586`.
  Reviewed HEAD `f230104627d640e4fea53c60073dab025a90c018` (no code changes yet; change dir untracked).
- **Artifacts read fresh**: ticket.md, proposal.md, design.md, tasks.md, specs/backend-embedded-postgres-isolation/spec.md,
  workflow-state.md, skeptic-design-1.md; current `VerifiedEmbeddedPostgres.scala` (catch at :64-66 is
  `deleteQuietly(dir); throw t`) and `VerifiedEmbeddedPostgresSpec.scala` (clusterA :24-28, `assertForeignClusterIntact`
  :43-46, HEL-1474 initdb-time test :173-195 using `setLocaleConfig("locale", "hel1474-no-such-locale")`).
- **zonky 2.0.7 sources** (extracted into my scratchpad): `Builder.builderCleanDataDirectory = true` by default (:493);
  constructor runs initdb when `cleanDataDirectory || !postgresql.conf` (:156-158), so initdb always runs for the
  unconfirmed-path test; `system()` throws `IllegalStateException` on a non-zero exit (:632-633); `lock()` (:233-239)
  runs only after initdb, so `epg-lock` absence is a sound "never reached startPostmaster" signal (D2.1);
  `waitForServerStartup` with `Duration.ZERO` skips the loop and throws at :335; `close()` swallows a failing
  `pg_ctl stop` (:380-395), so the red-first test's `finally captured.close()` is harmless on both paths.
  `parentDirectory` is `getWorkingDirectory()` (/tmp/embedded-pg), whose `cleanOldDataDirectories` only scans its own
  children, not our `Files.createTempDirectory("epg")` dirs - no interaction with this change.
- **Unconfirmed-path test premise, measured (no server)**: ran the bundled PG 14.10 `initdb` against a scratch dir
  pre-filled with `epg-lock` + `postmaster.pid` = `hel1586-not-a-pid`: with the invalid locale -> `invalid locale name`,
  exit 1; with the default locale -> `exists but is not empty`, exit 1. In both runs the directory contents were left
  intact (`ls`, `cat postmaster.pid`). So D5's D3 test reaches D2.2 with pid present and no opts, exactly as designed,
  and runs no pg_ctl (C5).
- **pg_ctl status semantics, measured (no server)**: initdb'd scratch cluster with no pid file -> `no server running`,
  exit 3 (D2 "confirmed"); a non-cluster dir or missing dir -> exit 4 (D2 "cannot confirm"). The stop branch only runs
  once `postmaster.opts` exists, which implies an initdb'd dir, so exit 3 is reachable on the real path.
- **pg_ctl sibling**: `/tmp/embedded-pg/PG-1a75b2fdb57c5cfc8674f29ebb0d831b/bin/` contains `initdb pg_ctl postgres`.
- **postmaster.opts ordering (foreign-cluster test)**: not measurable without starting a server (forbidden). From PG14
  `PostmasterMain`, `CreateOptsFile` follows socket creation ("delay this till now to avoid recording bogus options
  (eg, unusable port number)"); the 14.10 binary contains both `could not create any TCP/IP sockets` and
  `postmaster.opts`. So on A's port our postmaster FATALs before writing opts and its `UnlinkLockFiles` exit callback
  removes `postmaster.pid` -> D2 "never appears, pid absent" -> delete, no pg_ctl. The design is robust even if that
  ordering were wrong: a stop would address only our dir and `status` exit 3 would confirm.
- **Round-1 CRs**: CR1 (spec body carve-out) done; CR2 (unconfirmed path mechanism, epg-lock pre-fill, non-numeric pid,
  C5) done and verified above; CR3 (foreign-cluster post-launch test, task 3.3a) done; CR4 (red-first order
  1.1 -> 3.1 red -> 1.2-1.4 -> green) stated in tasks.md. Round-1 non-blocking notes (lock()-throw wait, interrupt,
  `-t`/child bounds, exit 4) are all addressed in D2.
- **AC trace**: AC1 -> D1/D2 + 1.2; AC2 -> D1 + 3.3a + C1; AC3 -> D4/D5 red-first + 3.1 (pre-fix red is the
  port-still-listening / process-alive assertion, deterministic); AC4 -> D6 + 3.1/3.5; AC5 -> 3.4. Scope stays within
  test infra; guard and exemption marker untouched (C3) - new tests use `startWith`, no direct `.start()`.

### Verdict: CONFIRM

### Non-blocking notes

1. **D2.4 interrupt ordering.** Restoring the interrupt flag *before* the pg_ctl child waits makes
   `Process.waitFor(timeout)` throw `InterruptedException` immediately, which would either skip cleanup or replace the
   original throwable - contradicting "cleanup is never skipped" and "rethrow the original unchanged". Restore the flag
   after the cleanup decision completes (or treat an interrupted child wait as "cannot confirm" -> D3, caught locally).
2. **Spec body second clause.** "...and SHALL NOT leave a server running on its own data directory" is absolute, while
   the D3 scenario describes exactly the case where that cannot be guaranteed. Consider "SHALL stop any server launched
   on its own data directory, and SHALL report it when that stop cannot be confirmed".
3. **Realism guard observation.** "No process remains for the dir" has no stated mechanism (the dir is deleted, so the
   PID cannot be read afterwards, and no hook runs). Port refused + dir deleted is sufficient; if a process check is
   added it must stay read-only and must not become a name/args search used for anything but observation.
4. **Zombie window.** After `pg_ctl stop -w` returns, the exited postmaster can be briefly unreaped; assert
   `ProcessHandle.of(pid)` not alive with a short bounded poll rather than a single read.
5. New scratch dirs in tests will need the `temp-dir-hygiene: reviewed` comment the existing tests carry.

### Gate defects

- None.

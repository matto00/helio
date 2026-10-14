## Context

See proposal.md (Why). Re-verified against `embedded-postgres-2.0.7-sources.jar` (coursier cache):
`Builder.start()` (:576-587) -> constructor: initdb (:156-158), `lock()` creates `<dir>/epg-lock` (:154, :160; the
HEL-1474 proof's `.epg-lock` is a typo), `startPostmaster()` (:161): `pg_ctl -D <dir> -o ... -w start` launched via
`ProcessBuilder.start()` (:275, not waited on), shutdown hook (:283), `waitForServerStartup` (:285) throws
`IOException("Gave up waiting ...")` at :335. zonky exposes no pg_ctl path (`prepareBinaries` is private, :770) and no
handle to the pg_ctl process. Postgres itself writes `<dir>/postmaster.pid` and `<dir>/postmaster.opts` (the latter's
first token is the absolute path of the `postgres` binary, whose sibling is `pg_ctl`). zonky's own `close()` stops by
`pg_ctl -D <dir> stop -m fast -t 5 -w` (:415-424) - addressing the data directory, as here.

Today `VerifiedEmbeddedPostgres.startWith` does `try b.start() catch { case t => deleteQuietly(dir); throw t }`.

## Goals / Non-Goals

**Goals:** a throwing start never leaves a server running on the attempt's own (deleted) directory; every stop
addresses only that directory; deterministic red-first proof.

**Non-Goals:** zonky's leaked `lockStream` FD and registered shutdown hook (unreachable without the instance; at JVM
exit the hook's `pg_ctl stop` on a deleted dir just logs an error); patching/upgrading zonky; production code.

## Decisions

**D1 - Stop by data directory, then delete (chosen over "leave the dir in place").** Leaving the dir keeps a live
postmaster holding a port for the rest of the forked JVM, which is the defect. Stopping with
`<bin>/pg_ctl -D <dir> stop -m immediate -w -t <n>` addresses only the server whose `postmaster.pid` lives in our own
directory, which is exactly the HEL-1445 rule (`close()` already relies on the same property). `immediate` because the
cluster is being discarded and has no state worth a checkpoint. Never a port, process name, or searched PID.

**D2 - When to attempt the stop.** On a throwing `b.start()`:
1. `<dir>/epg-lock` absent -> the constructor never reached `startPostmaster` (initdb-time failure, the HEL-1474 test):
   delete as today, no polling, no pg_ctl.
2. Otherwise a launch may be in flight (pg_ctl runs asynchronously to zonky's throw). Poll, bounded by a
   `postLaunchWait` parameter (default 30 s, a `startWith` parameter so tests can shorten it), every 100 ms, for
   `<dir>/postmaster.opts`.
   - It appears: resolve `pg_ctl` as the sibling of the binary named by its first token (must exist and be a regular
     executable file; else treat as "cannot confirm"). Run the stop (D1), then `<bin>/pg_ctl -D <dir> status`; exit
     code 3 ("no server running") confirms; any other code (0 running, 4 no accessible dir, or a timeout) is "cannot
     confirm". Stop uses `-t 30`; each pg_ctl child is waited at most 60 s and, if it overruns, destroyed via its own
     `Process` handle (the pg_ctl child itself only).
   - It never appears and `<dir>/postmaster.pid` is absent: no server is running on the dir -> delete. A launch that
     starts later cannot run on a deleted directory.
   - It never appears but `postmaster.pid` is present: cannot confirm -> D3.
3. Confirmed -> `deleteQuietly(dir)`, rethrow the original throwable unchanged (same instance).
4. Interruption: if the poll's sleep or a pg_ctl child wait is interrupted, stop waiting, remember it, and continue
   the decision with whatever the directory shows now (an interrupted stop/status wait counts as "cannot confirm" ->
   D3); restore the interrupt flag only after cleanup, just before rethrowing (cleanup is never skipped and the
   original throwable is never replaced). A throw from zonky's `lock()` itself
   (epg-lock created, no launch) waits the full `postLaunchWait` before deleting - accepted, failing path only.

**D3 - Unconfirmed stop leaves the directory.** Rather than delete from under a possibly-live server, keep the dir
and `addSuppressed` an `IllegalStateException` naming the dir and the stop/status outcome; rethrow the original.
Postgres's own lock-file recheck cannot help a server whose directory still exists, so this is visible, not silent.

**D4 - Fault seam `afterLibraryStart: EmbeddedPostgres => Unit` (default no-op), not a replacement start function.**
Called inside the same `try` as `b.start()`, so a throwing hook is indistinguishable, to the helper, from zonky
throwing after :275 with no handle returned. A real postmaster is then fully up - deterministic, no timing. A
start-replacing seam was rejected: the spec would need a direct `.start()` (an `EmbeddedPostgresStartGuard` offender)
or a new package-private start entry point (a guard loophole). The guard and its exemption marker are untouched.

**D5 - Tests (VerifiedEmbeddedPostgresSpec).**
- *Red-first (deterministic):* `startWith(..., newDataDirectory = () => dir, afterLibraryStart = pg => { record
  pg.getPort, the PID from line 1 of <dir>/postmaster.pid, captured pg; throw new IOException("hel1586 injected") })`.
  Assert: the same IOException instance propagates; `calls == 1` (no retry - a library throw is not retried, as today);
  dir deleted; port refused; `ProcessHandle.of(pid)` absent or not alive (observation only - the test never signals).
  Against the pre-fix helper this fails (port still listening, process alive).
- *Realism guard (not red-first):* zonky's own :335 throw via `setPGStartupWait(Duration.ZERO)` on a fresh free port:
  the "Gave up waiting" IOException propagates, dir deleted, port refused (observation only; any `isAlive` check uses a
  short bounded poll, since an exited postmaster can briefly be an unreaped zombie). New temp dirs carry the
  `temp-dir-hygiene: reviewed` comment.
- *Unconfirmed path:* `newDataDirectory` returns a scratch dir pre-filled with `epg-lock` and a fake `postmaster.pid`
  whose content is non-numeric (`hel1586-not-a-pid`, never a real PID - C5), no `postmaster.opts`; the builder uses the
  invalid-locale initdb failure (initdb also refuses a non-empty dir), so zonky throws before any launch and no server
  process exists. With `postLaunchWait` ~1 s: opts never appears, pid present -> D3: dir kept, suppressed reason names
  it, original exception instance propagates; no pg_ctl runs on this branch. The test removes the dir in `finally`.
- *Foreign cluster on the post-launch path:* with the spec's existing `clusterA` running, `startWith` pinned to A's
  port with `setPGStartupWait(Duration.ZERO)` and `postLaunchWait` ~5 s: our postmaster cannot bind A's port, zonky
  throws at :335, the helper's cleanup addresses only our dir. Assert the IOException propagates, our dir is deleted,
  and `assertForeignClusterIntact()` + A's `data_directory` unchanged. (The existing :81-112 tests cover the
  ownership-check path only, not this one.)
- Existing initdb-time test keeps passing unchanged (epg-lock absent -> no polling).
- Every test cleans up only what it created; a leftover handle is closed via the captured instance's `close()`
  (`pg_ctl -D` its own dir), never by signal.

**D6 - Proof.** `proof/red-green.txt`: the red run against the pre-fix helper (test failure output, plus
`ps -o pid,args -p <pid>` for the recorded PID only, showing `-D <attempt dir>`), the leaked postmaster's
self-termination observed without any signal from us (Postgres rechecks its lock file about once a minute and shuts
down when it is gone - record whether this actually happens and how long it took), and the green run (test output,
`pg_ctl -D <dir> status` before the stop showing the PID, `ps -p <pid>` empty after). `proof/zonky-citations.txt`: the
re-verified line numbers above with the jar path.

## Risks / Trade-offs

- [A stale `postmaster.pid` whose PID was reused] -> same theoretical exposure as zonky's own `close()`; pg_ctl checks
  the pid file of *our* directory only, never a foreign cluster's; immediate stop of a freshly launched server makes a
  stale file practically impossible here.
- [Bounded polling adds up to `postLaunchWait` to a failing start where a launch never happened after `epg-lock`] ->
  only on an already-failing path; default 30 s.
- [`postmaster.opts` format] -> first token is the binary path, unquoted (Postgres `CreateOptsFile`); parse up to the
  first ` "`; any parse/exists failure falls to D3 (fail visible, never guess a binary).

## Planner Notes

- Self-approved: direction D1 over "leave in place"; no product/UI surface; test-infra only, Low priority.
- Lane safety (driver, binding): see tasks.md Standing Constraints.

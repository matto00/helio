## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/stop-leaked-zonky-postmaster/HEL-1586`.
- **Artifacts read**: ticket.md, proposal.md, design.md, tasks.md, specs/backend-embedded-postgres-isolation/spec.md,
  workflow-state.md; current helper `backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgres.scala`
  (`try b.start() catch { case t: Throwable => deleteQuietly(dir); throw t }` at :64-66, confirmed) and
  `VerifiedEmbeddedPostgresSpec.scala` (196 lines; HEL-1474 initdb-time test at :173-195).
- **zonky citations** (extracted `embedded-postgres-2.0.7-sources.jar` into my scratch dir, read
  `EmbeddedPostgres.java`): every design citation is correct: `LOCK_FILE_NAME = "epg-lock"` (:90), `lockFile` (:154),
  initdb gate (:156-158), `lock()` (:160; body :233-239 opens a `FileOutputStream` = creates the file, then `tryLock`),
  `startPostmaster()` (:161), `builder.start()` (:275, not waited), shutdown hook (:283), `waitForServerStartup` (:285),
  throw (:335), `pgCtl` stop `-m fast -t 5 -w` (:415-424, `PG_STOP_MODE="fast"` :86), private `prepareBinaries` (:770),
  `Builder.start()` (:576-587). The `.epg-lock` typo in the archived HEL-1474 proof is real
  (`zonky-start-failure.txt:10`).
- **Realism-guard mechanism**: `setPGStartupWait(Duration.ZERO)` is accepted (only negative rejected, :508-514); with
  `maxWaitNs == 0` the loop at :318 never runs, so :335 throws immediately after the launch. Sound.
- **Postgres behaviour claims**: bundled binaries are PostgreSQL 14.10 (`/tmp/embedded-pg/PG-1a75.../bin`, with
  `pg_ctl` sibling of `postgres`; I ran `postgres --version` only, no server). The binary contains
  `"performing immediate shutdown because data directory lock file is invalid"` and `"postmaster.opts"` (strings),
  consistent with the ~1 min lock-file recheck claim; the design correctly hedges it as "record whether this actually
  happens". `postmaster.opts` format (unquoted `fullprogname`, then ` "argv[i]"`) matches PG14 `CreateOptsFile` from my
  knowledge of the source; not verifiable from a source tree here (none on disk). Note: PG writes `postmaster.opts` only
  after sockets/shared memory are set up ("delay this till now to avoid recording bogus options"), i.e. after
  `postmaster.pid`. The D2 decision table handles that ordering correctly (pid-without-opts -> D3).
- **Spec delta vs main spec**: diffed against `openspec/specs/backend-embedded-postgres-isolation/spec.md` requirement
  1. Header matches; all existing scenarios preserved; three new scenarios added; requirement body extended.
- **AC coverage**: AC1 -> D1/D2 + task 1.2; AC3 -> D4/D5 red-first + 3.1; AC4 -> D6 + 3.1/3.5; AC5 -> 3.4. AC2 is
  covered by construction (pg_ctl -D own dir) but see CR3.

### Verdict: REFUTE

The direction (D1 stop-by-own-dir, D4 post-start fault seam) is sound and the zonky citations are accurate. The
revisions below are artifact fixes, not a redesign.

### Change Requests

1. **Spec requirement body contradicts its own new scenario** (spec.md, requirement paragraph). The body still says
   an attempt not handed to the test "SHALL NOT leave its own data directory behind", but the new scenario "The
   attempt's own server cannot be confirmed stopped" (D3) requires the directory to be **left in place**. Carve the
   D3 case out of the SHALL (e.g. "...SHALL NOT leave its own data directory behind, except when a server launched on
   it cannot be confirmed stopped, in which case the directory is kept and the reason attached to the error").
2. **The unconfirmed-path test (D5 third bullet, task 3.3) is unspecified and its safety is unstated.**
   (a) `startWith` always runs a real zonky `start()`, so "no server, no process involved" is inaccurate; the design
   must name how the throw is produced (e.g. a pre-populated dir makes initdb fail on a non-empty directory) and that
   the pre-created files must include `epg-lock` (otherwise branch D2.1 deletes and the D3 path is never reached).
   (b) Binding safety: the fake `postmaster.pid` must not contain a PID that could belong to a live process (C1/AC2;
   `pg_ctl stop` signals whatever PID that file names with no process-identity check). Specify content that is not a
   live PID (e.g. a non-numeric first line, or a PID verified dead), so that even a regressed helper that reached
   `pg_ctl stop` could not signal a foreign process.
3. **New spec scenario "A discarded attempt never stops another cluster ... including one listening on the attempt's
   port" has no test mapped in D5/tasks.md.** It is new text on a new stop path. Either add a test for the post-launch
   throw path (e.g. a foreign cluster A this test starts, then `startWith` pinned to A's port with
   `setPGStartupWait(Duration.ZERO)` and a short `postLaunchWait`: our postmaster loses the port, the helper deletes
   only its own dir, A keeps running with its marker data), or state explicitly which existing test(s)
   (`VerifiedEmbeddedPostgresSpec` :81-112) satisfy it and why that is sufficient for the new path.
4. **Red-first sequencing is ambiguous in tasks.md.** Task 3.1 says run against "the pre-fix helper", but the test
   needs the `afterLibraryStart` seam (task 1.1) while the fix (1.2/1.3) is listed before 3.1. State the order: 1.1
   (seam only, catch still `deleteQuietly; throw`) -> 3.1 red run + `ps -p <pid>` evidence -> 1.2/1.3 -> green.
   Otherwise the "red" can only be produced by reverting the fix after the fact, which is easy to fake.

### Non-blocking notes

- A throw at zonky `lock()` (:236-237, epg-lock exists, no launch) now costs the full `postLaunchWait` (30 s) before
  delete; acceptable on an already-failing path, but consider stopping the poll early if neither `postmaster.pid`
  nor a live pg_ctl could exist — or just document it.
- If the calling thread carries an interrupt flag (or the original throwable is an `InterruptedException`), the
  100 ms `Thread.sleep` poll will throw immediately and skip cleanup. Decide: clear-and-restore the flag around the
  poll, or treat it as D3.
- `-t <n>` for `pg_ctl stop` and the per-child wait bounds are unspecified; pick numbers in the design.
- `pg_ctl status` exit 4 (data dir inaccessible) should be listed explicitly as "unconfirmed" -> D3.
- The ~1 min self-termination claim is corroborated only by the log string in the 14.10 binary; D6 already asks to
  measure it — keep that.
- Process note: I ran `/tmp/embedded-pg/.../postgres --version` (prints and exits; no server, no signal).

### Gate defects

- None.

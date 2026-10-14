## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: b24cbd7b5e929daa7fd7d7ff1d1acdfa4d9e8264. The diff base was resolved live with resolve-review-base.sh: f230104627d640e4fea53c60073dab025a90c018.
The change is test infrastructure only and has no UI surface, so step 4 (UI judgment) does not apply.

### What I verified (with evidence)

- **Cwd guard:** READY ambient=/home/matt/Development/helio branch=task/stop-leaked-zonky-postmaster/HEL-1586.
- **Diff:** the backend change is limited to `VerifiedEmbeddedPostgres.scala` (+78/-3) and `VerifiedEmbeddedPostgresSpec.scala` (+125). Everything else is openspec artifacts.
- **Zonky 2.0.7 citations:** I extracted the sources jar myself and read EmbeddedPostgres.java. The cited lines match:
  - :90 is `LOCK_FILE_NAME = "epg-lock"`.
  - :160 is `lock()` and :161 is `startPostmaster()`.
  - :275 is `builder.start()` of `pg_ctl -D ... -w start`. The Java side never waits on it.
  - :283 is the shutdown hook and :335 is the "Gave up waiting" IOException.
  - :576 is `Builder.start()` and :770 is the private `prepareBinaries`.
  - `close()` at :382 is `pg_ctl -D <dataDirectory> stop`, which confirms zonky stops its own server by directory too.
- **AC1 (stop by own dir, then delete, original propagates):** `cleanUpFailedStart` checks for `<dir>/epg-lock`. If it is absent, the failure was at initdb time and the directory is simply deleted. If it is present, the helper:
  1. polls (bounded) for `<dir>/postmaster.opts`;
  2. resolves `pg_ctl` as the sibling of the binary named in that file;
  3. runs `pg_ctl -D <dir> stop -m immediate -w -t 30`, then `pg_ctl -D <dir> status`;
  4. deletes the directory only when status exits 3.

  In every other case the directory is kept and a reason is added with `addSuppressed`. The `catch` rethrows `t` unchanged, and the test asserts `theSameInstanceAs(injected)`.
- **AC2 / HEL-1445:** the only processes started are `pg_ctl -D <attempt dir>` plus the test's own read-only `pg_ctl -D <own dir> status`. There is no port, name or PID search: a grep for pkill/pgrep/killall/kill in both files returns nothing. The only `destroyForcibly()` calls act on the code's own pg_ctl child `Process` handles. The test "post-launch failed start pinned to another cluster's port" asserts that `assertForeignClusterIntact()` holds and that A's `data_directory` is unchanged. I read the zonky source to establish the ownership edge: `pg_ctl -D <dir>` reads only `<dir>/postmaster.pid`.
- **AC3 (red-first, deterministic, after a real launch):** the fault hook `afterLibraryStart` runs inside the same `try` as `b.start()`, after the constructor returned. By then zonky's `verifyReady` has completed a real `SELECT 1`, so the postmaster is definitely up, and no timing is involved.
  - The pre-fix catch (`deleteQuietly(dir); throw t`) never stops the server. The `portRefused(...) shouldBe true` assertion runs inside the `try`, before the test's `finally` close, so the pre-fix helper fails it deterministically.
  - I did **not** re-run red myself. Doing so needs a temporary edit to the helper, and my role is read-only. I rely on the reasoning above plus two independent pasted red runs: proof/red-green.txt (PID 1999944 leaked and self-exited in about 2 min) and evaluation-1/2 (PID 2043612).
- **AC3/AC5 green, fresh run by me:** `nice -n 19 sbt -J-Xmx3g "testOnly ...VerifiedEmbeddedPostgresSpec ...EmbeddedPostgresStartGuardSpec"` gave Suites 2 completed, 0 aborted; Tests 20 succeeded, 0 failed.
  - The post-launch test recorded pid=2111661, port=36771, dir=/tmp/hel1586-postlaunch2293585661605571452.
  - Before the stop, `pg_ctl status` printed "server is running (PID: 2111661)".
  - Afterwards, `ps -o pid,args -p 2111661` printed only the header, and no `/tmp/hel1586-*` directories remained.
- **AC4:** proof/red-green.txt has the red run, the green run, and `ps`/`pg_ctl status` output for the attempt's own dir only. proof/zonky-citations.txt is accurate, per the check above.
- **Worktree:** after my run, `git status` shows only the pre-existing untracked evaluation-1/2.md. I modified no code.

### Verdict: CONFIRM

### Non-blocking notes
- The realism guard (`setPGStartupWait(Duration.ZERO)`) is correctly labelled "not red-first". With a zero wait, whether the postmaster had launched before the pre-fix delete is a race. The deterministic proof comes from the `afterLibraryStart` seam.
- Without a `pid` file and without `postmaster.opts`, the helper deletes the dir after `postLaunchWait`. If a postmaster launches after that, it fails on the missing dir. The reasoning is sound and the comment states it.
- The shutdown hook zonky registered at :283 still runs at JVM exit and calls `pg_ctl -D` on the deleted dir. That is harmless, because it addresses the same own dir.
- The stale line citation (:241 vs :245) in red-green.txt and the 322-line spec size are cosmetic, as the evaluator already noted.

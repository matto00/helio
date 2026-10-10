## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `feaa10b6e818d59bf3f7acc05ab09a6672b3da20`. The base was resolved live with `resolve-review-base.sh` as `6902b57f12a18042daf9b8e4984cc55b2011fc84`. The diff is 252 files: 224 under `backend/src/test/scala` (221 migrated plus 3 new) and the rest in the change dir. The change is test-only, so there is no UI and step 4 does not apply.

### What I verified (with evidence)

**The helper closes the CI failure mode (AC1, AC4).** I read zonky 2.0.7 from its source jar myself.
- `startPostmaster()` launches `pg_ctl -w start` through `ProcessBuilder` and never waits on it or checks its exit.
- `verifyReady()` connects to `InetAddress.getLoopbackAddress():port` and runs `SELECT 1`.
- `close()` runs `pgCtl(dataDirectory, "stop")`, which addresses the instance's own `-D` and never a port.
- `Builder()` is package-private, so `builder()` and the static `start()` are the only public entry points.

`VerifiedEmbeddedPostgres.scala:52-86` gives each attempt a unique `Files.createTempDirectory` dir. It runs `SHOW data_directory` before handing the instance back, so no caller SQL can reach an adopted cluster. Any non-match or any check exception leads to `close()` (own dir only) plus a delete and a retry on `setPort(0)`. Exhaustion throws with a per-attempt log.

Attacks I tried on the helper:
- **False path match.** Each attempt's dir is unique and still exists while a foreign cluster is live. `normalize` only collapses `.`/`..`. A foreign server cannot report a string equal to our `realDir` or `plainDir` unless it shares our live, uniquely-created dir. That would take a separate mount namespace with the same random name, which is not realistic on a CI runner.
- **Race between SHOW and use.** Once SHOW returns our own dir, our postmaster holds the port, and no later postmaster can bind it. A later loser that adopts *our* cluster runs only `SELECT 1` and `SHOW`, then discards its own dir.
- **Split-family bind.** Postgres binds `::1` and `127.0.0.1` separately (1.2 log lines 233/235), so two postmasters could in theory each hold one family. Even then, SHOW and every later JDBC connection resolve `localhost` the same way in the JVM. The holder of the other family fails verification and is stopped by `-D`. I found no hole.
- **Discard while our own postmaster is still starting.** In my run, `postmaster startup finished in 00:00:00.003` came before our bind attempt, followed by `Could not stop postmaster`. The postmaster then dies on bind. `ps -eo ... | grep 'bin/postgres -D'` after my run showed no leftover embedded postmasters and no `/tmp/epg*` dirs.

**The repro exercises the CI mechanism.** The old path pinned to A's port logs `could not bind IPv6/IPv4 ... Address already in use` and `FATAL: could not create any TCP/IP sockets` (`/tmp/hel1445-logs/1.2-red.log`). That is the same signature as the PR #891 and HEL-1470 logs, and it goes through the same zonky port-poll adoption path. The only thing it skips is the `detectPort` TOCTOU, which is irrelevant here because the helper verifies after start whatever caused the collision. The mutation that disables the comparison turns steps 3 and 4 red (`2.2-mut-red.log`: `*** 2 TESTS FAILED ***`).

**Fresh targeted run (mine).** I ran `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly VerifiedEmbeddedPostgresSpec EmbeddedPostgresStartGuardSpec *SqlConnectorTlsSpec OutputHistoryPayloadsAvailableSpec"`.
- The log names this worktree's project path and shows all 4 suite headers, `Suites: completed 4, aborted 0` and `Tests: succeeded 26, failed 0`.
- It contains 0 `TESTS FAILED` / `*** FAILED` / `RUN ABORTED` / `*** ABORTED` lines.
- The log shows the bind FATAL followed by the helper's discard and retry.
- `SqlConnectorTlsSpec` covers the multi-line SSL site with SHOW over an SSL server, and it is green.

**Mechanical migration (AC2, C1).**
- I re-ran `verify-embedded-postgres-migration.py 6902b57f1` myself. Its output: `base occurrences: 226 wrapped: 226 unwrapped: 0 inserted imports: 221`, `RESULT: PASS`, rc=0.
- My own independent check of `git diff -U0` over `backend/src/test/scala`, excluding the 3 new files: 0 removed lines other than `EmbeddedPostgres.builder()` / `.start()`, and 0 added lines other than the wrap, `import com.helio.testkit.VerifiedEmbeddedPostgres`, or a lone `)`.
- The negative control (`4.2-verifier-negative-control.txt`) shows the verifier can fail.

**RLS (AC5, C2).** `git diff -U0 base...HEAD -- backend`, grepped for BYPASSRLS / CREATE ROLE / GRANT / SET ROLE / IF NOT EXISTS, returns 0 hits. The BYPASSRLS mutation goes red at `assertAppPoolEnforcesRls` (`5.1-rls-mutation.txt`, 4 failed) and is green after the revert.

**Parity (AC6).** I grepped `/tmp/hel1445-logs/5.2-{base,branch}.log` myself.
- Base: `Suites: completed 472`, `Tests: succeeded 6529`.
- Branch: `Suites: completed 474`, `Tests: succeeded 6541`.
- Both logs have 0 failure strings.
- The branch log contains both new suites' headers.
- The difference is +12 tests, which equals 7 guard tests + 5 regression tests.
- Base was loaded from `/tmp/hel1445-base`, the branch from this worktree.

I did not re-run testFull because I had no concrete reason to doubt it.

**Loop (AC7).** All 47 `5.3-iter-*.log` files have 0 failure strings and a `Suites: completed 15, aborted 0` line, which I grepped myself. The 35-iteration cross-group overlap count is the executor's computation. I spot-checked its inputs but did not recompute it.

**AC8 (HEL-1470 in the PR body).** This is a delivery step, and no PR exists yet. The orchestrator must do it.

**Guard (AC3): the stated rename rule is only partly enforced. This is the REFUTE.** D7 lists "imports `EmbeddedPostgres` under a rename (`EmbeddedPostgres => X` in an import selector)" as an offender, and AC3 requires the guard to fail on *any* direct start. `EmbeddedPostgresStartGuardSpec.scala:28` captures only the rest of the import's first line (`[^\n]*`), and `:57` checks `selectors.contains(Epg + " =>")`, which needs exactly one space. Once a rename gets past those lines, `Pg.builder().start()` matches neither `builderRef` (which needs the literal `EmbeddedPostgres`) nor `staticStart`.

I compiled the guard object verbatim (lines 1-74 at `feaa10b6e`, scalatest imports dropped) with scalac 2.13.15 and ran `violations()` on each spelling. Result: `{EmbeddedPostgres => Pg}` was flagged; `{EmbeddedPostgres=>Pg}`, `{EmbeddedPostgres  =>  Pg}` and a multi-line `{\n  EmbeddedPostgres => Pg\n}` each returned `Vector()`, i.e. clean. A direct `EmbeddedPostgres.builder().start()` control was flagged. Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1445/evidence/.concertino/runs/HEL-1445/evidence/skeptic-final-1-guard-rename-probe.txt`.

All three are valid Scala 2.13 import spellings, and the repo has no scalafmt to normalise them. Multi-line `{` selector imports already occur in `backend/src` (5 sites, e.g. `AnalyzeSchemaWarnings.scala:4`). With any of these spellings, a suite can start an unverified cluster, and `bad shouldBe empty` stays green, so the guard's protection is silently void. `violations()` is a pure function, so this result is deterministic, not flaky. The evaluator's claim (evaluation-1.md:41) that the guard "implements every D7 rule (... renamed ... zonky import)" is therefore inaccurate.

### Verdict: REFUTE

### Change Requests
1. Make the rename and wildcard import rules in `EmbeddedPostgresStartGuardSpec.scala:28,52-58` independent of whitespace and newlines:
   - Capture the full selector block of an `import io.zonky.test.db.postgres.embedded.` import. For `{`, scan to the matching `}` across newlines.
   - Detect a rename with a regex like `EmbeddedPostgres\s*=>\s*(?!_)` (a rename to `_` is a hide, not an alias, so it can stay allowed). Apply the same whitespace and newline tolerance to the wildcard check.
2. Add the three bypassing spellings to `"reject every direct-start spelling"` (`:110-121`), each followed by `Pg.builder().start()`:
   - `{EmbeddedPostgres=>Pg}`;
   - `{EmbeddedPostgres  =>  Pg}`;
   - the multi-line `{\n  EmbeddedPostgres => Pg\n}`.

   Show them red against the current implementation first, then green after the fix, and record the transcript as a proof file.
3. Re-run the guard against the real tree, which must stay green and non-vacuous. Re-run `verify-embedded-postgres-migration.py`; it is unaffected but cheap to confirm. No testFull re-run is needed, because only the guard spec changes.

### Non-blocking notes
- `offendersIn` (`:71-73`) exempts by bare filename, so any file named `VerifiedEmbeddedPostgres.scala` or `VerifiedEmbeddedPostgresSpec.scala` anywhere under `src/test/scala` is exempt (the evaluator also noted this). Matching on the `com/helio/testkit/` path would cost one line, and it is worth doing in the same edit.
- zonky's `PreparedDbProvider` and the JUnit 4/5 rules/extensions also start embedded Postgres internally and are not guarded. Nothing uses them today, and they need JUnit wiring that ScalaTest specs do not have, so the risk is low. A one-line guard rule on `PreparedDbProvider`/`EmbeddedPostgresRules`/`*PostgresExtension` would close it.
- Residual: an orphan postmaster could keep running in the theoretical split-family case, where our discarded postmaster wins one address family after the pid-file-less `pg_ctl stop` fails. It would hold no live dir and receive no traffic. This is not a correctness issue and needs no action.
- AC8: the PR body must say HEL-1470 is fixed by this PR.

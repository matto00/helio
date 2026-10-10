## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `6902b57f12a18042daf9b8e4984cc55b2011fc84` (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Root cause (premise).** I fetched `gh run view 37969918401 --attempt 1 --log` myself. Job `backend (2)` contains `[postgres:pid(21828)] ... could not bind IPv6 address "::1": Address already in use`, the same for IPv4 `127.0.0.1`, then `FATAL: could not create any TCP/IP sockets`. One second later `[postgres:pid(21806)] ... ERROR: role "helio_app_test_output_history" already exists` appears. So the ERROR is logged by the *other* postmaster, as ticket.md says.
- **zonky 2.0.7 facts (design Context).** Unzipped the sources jar into scratch and read `EmbeddedPostgres.java`:
  - `Builder.start()` assigns `builderPort = detectPort()` when it is 0, and assigns `builderDataDirectory = Files.createTempDirectory("epg")` when it is null. Both are builder fields, so the builder is mutated. Confirmed.
  - `detectPort()` uses try-with-resources on `new ServerSocket(0)` and returns `getLocalPort()` after the socket is closed. This is the TOCTOU. Confirmed.
  - `startPostmaster()` calls `builder.start()` on `pg_ctl ... -w start` and never `waitFor`s it. `waitForServerStartup` → `verifyReady()` only does a socket connect to `localhost:port` plus `SELECT 1`. Confirmed.
  - There is no data-dir getter. `setDataDirectory(File|Path|String)` and `setPort(int)` exist, and `builderPort == 0` triggers detection. Confirmed.
  - `close()` runs `pgCtl(dataDirectory, "stop")`, which is `pg_ctl -D <own dir> stop -m <mode> -t <s> -w`. It is keyed on the data dir, never on the port. `system()` throws on a non-zero exit, and `close()` catches `Exception` and logs it. It then releases the lock and deletes the dir when `cleanDataDirectory` is set (default `true`). D3's claim holds: discarding cannot signal the foreign cluster.
  - The constructor calls `cleanOldDataDirectories(parentDirectory)` on `java.io.tmpdir/embedded-pg`. Data dirs from `createTempDirectory("epg")` live outside it, so the helper's own dirs are not swept. No conflict.
- **Call-site census.** In the worktree: `grep -rn "EmbeddedPostgres.builder()" backend/src` returns 226 hits in 221 files. 223 match the exact `setConnectConfig("stringtype", "unspecified").start()` form. The 3 others are `PipelineRunCrossInstanceSpec:44`, `LegacyOutputConfigKeysParitySpec:25` and `SqlConnectorTlsSpec:37` (multi-line). There are 0 uses of static `EmbeddedPostgres.start`, `setPort`, `setDataDirectory` or `setCleanDataDirectory`, and 0 in `backend/src/main`. All 221 files carry exactly one top-level `import io.zonky.test.db.postgres.embedded.EmbeddedPostgres` (222 imports in total; one file imports without building). No call site is in `com.helio.testkit`. The census matches.
- **Repo-check compatibility.** No `.scalafmt.conf` exists. `check-scala-quality.mjs` enforces inline-FQN and file-size rules, not line length, so the longest wrapped line (~152 chars) is not rejected. `check-test-temp-dir-hygiene.mjs` honours the `// temp-dir-hygiene: reviewed —` escape hatch on the same line or the line above. Archived change dirs already hold `.py`, `.mjs` and `.sh` helper scripts (for example `2026-10-08-split-panel-service/move-match.py`), so the codemod and verifier location has precedent.
- **Guard placement.** `RouteTestBaseGuardSpec` exists in `com.helio.testkit` and scans `Paths.get("src","test","scala")`, which confirms the cwd assumption.
- **RLS mutation target.** `OutputHistoryApiHarness.scala:76` has `CREATE ROLE $roleName NOSUPERUSER ... NOLOGIN`, and `assertAppPoolEnforcesRls` is defined at line 120. It is called from `OutputHistoryRoutesSpec:284` and `OutputHistoryPayloadRoutesSpec:106`. The D8 mutation is executable.
- **Local test concurrency (the basis for CR2).** In `backend/build.sbt` lines 187-199, `Global / concurrentRestrictions` is replaced only when `HEL924_TEST_GROUP_CONCURRENCY` is set. Unset, sbt's default `Limit forked-test-group to 1` stays, so forked groups run one at a time, and `Test / testForkedParallel := false` keeps suites sequential inside a group. CI sets `HEL924_TEST_GROUP_CONCURRENCY: 2` and `HEL924_TEST_GROUP_COUNT: 4` (`.github/workflows/ci.yml:173-174`). The observed steal happened under that CI concurrency.

### Verdict: REFUTE

The core design is sound and well-grounded: the by-name fresh builder, the data-dir ownership check, discard by own-dir `close()`, the deterministic pinned-port repro, and a codemod plus independent inverse verifier. Four gaps would let the executor ship evidence that looks like proof but proves nothing, or would leave the helper's behaviour undefined in exactly the failure mode it exists for.

### Change Requests

1. **Define the helper's behaviour when the ownership check itself fails (D2/D4).** D4 says "retry on mismatch only, every other exception from `start()` propagates". It does not say what happens when the *check* throws. Two cases are realistic in the steal scenario this ticket targets:
   - (a) `SHOW data_directory` throws because the adopted foreign cluster is shutting down. This is the HEL-1470 shape (`This connection has been closed` / `the database system is shutting down`).
   - (b) `toRealPath` on the *observed* path throws `NoSuchFileException`, because the foreign cluster's dir was already deleted by its `close()`. It could also throw because that path is not visible to this JVM.

   `toRealPath` is only safe on the helper's own dir. Revise D2/D4 to state:
   - Canonicalise only the own dir with `toRealPath`. Compare it to the observed string normalised without requiring the path to exist (for example `Paths.get(observed).toAbsolutePath.normalize`, or `toRealPath` with a fallback).
   - Classify a check-time SQL failure or unresolvable observed path as **unverified**: discard via own-dir `close()` and retry within the same bound, and include it in the exhaustion message.
   - On every path that does not return the instance, call the attempt's `close()` before continuing or throwing, so no live own postmaster leaks.

   Add a spec bullet or scenario covering this.
2. **Make the loop proof (D8 / task 5.3) run under real cross-JVM concurrency, and define "≤4 workers" concretely.** With the local default, forked groups run serially (build.sbt:187-199), so 30 `testOnly` iterations start embedded Postgres one at a time. They cannot exercise the port race at all. That is a vacuous green. "≤4 concurrent workers" can also be read as 4 concurrent sbt processes in one `backend/` dir, which would contend on the sbt server and `target/`. The revision must specify:
   - Each iteration runs with `HEL924_TEST_GROUP_CONCURRENCY` set (2 to mirror CI, at most 4) and an explicit `HEL924_TEST_GROUP_COUNT` ≥ the concurrency. This is the worker cap.
   - One sbt invocation per iteration, under `nice -n 19` with `-J-Xmx3g`.
   - Log evidence per iteration that groups actually overlapped, such as interleaved `postmaster started ... on port` lines from distinct forked JVMs, or overlapping suite start/finish timestamps.

   Apply the same env to the D8 parity runs, or state why parity deliberately uses the serial default.
3. **Close the verifier's partial-migration hole and pin the multi-line output rule (D5).** Inverse-transform byte-equality alone accepts a file where the codemod wrapped only some of several sites: inverse(new) == base still holds when an unwrapped `EmbeddedPostgres.builder()...start()` was simply left alone. The verifier must also assert two things:
   - Zero unwrapped `EmbeddedPostgres.builder()` occurrences remain in any changed file.
   - Per file, the wrap count equals the base occurrence count, summing to 226.

   D5 also does not state where the whitespace before a trailing line-leading `.start()` goes in the `SqlConnectorTlsSpec` chain (for example, is `\n          .start()` replaced by `)` on the previous line, or by `\n          )`?). The verifier is meant to be independent of the codemod, so the exact output rule must be written in design.md so both scripts implement it from the spec rather than from each other.
4. **Enumerate the loop and RLS suite sets explicitly (D8).** D8 refers to "the 11 `OutputHistoryApiHarness` specs + `OutputHistoryPayloadsAvailableSpec` and `JoinStepConfigSeamSpec`". `grep -rl OutputHistoryApiHarness backend/src/test` returns 12 files, and those include the harness itself and `NodePayloadFixtures`. `OutputHistoryPayloadRoutesSpec`, which calls `assertAppPoolEnforcesRls`, is not among those hits. List the suites by FQN in design.md so the loop is reproducible and its coverage is checkable. Also name the specific spec used for the RLS mutation (for example `OutputHistoryRoutesSpec`, line 284's assertion).

### Non-blocking notes

- D3: "whose postmaster already died" is not always true. `verifyReady()` can succeed against the foreign cluster before our postmaster has even attempted its bind. It can also come up half-bound (for example on `::1` only) while JDBC `localhost` resolves to `127.0.0.1`. Own-dir `close()` handles both cases correctly, so only the wording needs fixing.
- D4: "a builder that pins a port ... is re-pinned" should say *un-pinned* (`setPort(0)`). D2 sets a helper-owned data dir on every attempt, so "attempt 1 uses the builder exactly as configured" means "except the data dir".
- D7 guard: Scala 2.13 allows paren-less calls to Java nullary methods. A pattern like `EmbeddedPostgres\s*\.\s*(builder|start)\b` is more robust than the literal `EmbeddedPostgres.builder()` / `EmbeddedPostgres.start(`. Also consider flagging renaming imports of `EmbeddedPostgres`.
- D8 parity: say in advance how a base-side flake is handled (re-run that suite in isolation and record both). Otherwise "diff empty except the two new specs" invites post-hoc judgment.
- D6 step 4: specify the injected seam's shape, for example `start(builder, maxAttempts, portForAttempt: Int => Int)`, so the exhaustion test cannot be satisfied by an overload that skips the real comparison.

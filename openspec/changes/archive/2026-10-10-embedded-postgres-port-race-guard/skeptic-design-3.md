## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `6902b57f12a18042daf9b8e4984cc55b2011fc84`. The planning artifacts in the change dir are untracked.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/embedded-postgres-port-race/HEL-1445`.
- **zonky 2.0.7 source.** I unzipped `~/.cache/coursier/.../embedded-postgres-2.0.7-sources.jar` into scratchpad `hel1445-zonky3` and read `EmbeddedPostgres.java`:
  - `Builder.start` (lines 577-586) mutates the builder: `builderPort = detectPort()` and `createTempDirectory("epg")` are both assigned when unset. `setPort` is at line 555 and `setDataDirectory` at lines 522-531. There is no data-dir getter: the only public getters are the DataSources, `getJdbcUrl` and `getPort`. `startPostmaster` never waits on pg_ctl (lines 255-286). It logs `{instanceId} postmaster started as {Process} on port {p}` at INFO.
  - `verifyReady` (lines 338-360) is a socket connect plus `SELECT 1`.
  - `close()` (lines 382-412) is idempotent (`closed.getAndSet`), runs `pgCtl(dataDirectory, "stop")`, catches the error, then deletes its own dir. It never addresses a port.
  - `cleanOldDataDirectories(parentDirectory)` only touches dirs whose `epg-lock` is lockable and more than 10 minutes old, so it cannot hit a live foreign cluster.
  - The D2 and D3 premises hold.
- **Round-2 CR1 (startWith prefix).** D7 line 87 now accepts exactly `VerifiedEmbeddedPostgres.start(` and `VerifiedEmbeddedPostgres.startWith(`. It exempts only the per-line step-2 marker, and its pattern cases include both accepted spellings and a bare builder as rejected. Addressed, but see CR2 for a residual spelling mismatch in D6.
- **Round-2 CR2 (failed check).** The spec now has "The ownership check itself fails". D6 step 5 adds the `observeDataDirectory` seam, the throw-then-retry case, the exhaustion error carrying the recorded `SQLException` text, and a mutation proof. Task 2.2 references it. Addressed.
- **D4 wording.** It now reads "except that the helper always supplies its own data directory", and "exactly as today" is gone. Addressed.
- **Stray postmaster line.** D8 says it is not a failure. Addressed.
- **Census, re-run.** `grep -rn "EmbeddedPostgres.builder()" backend/src` gives 226 occurrences in 221 files, which matches. `com.helio.testkit` currently holds only `HelioRouteTest`, `RouteTestBaseGuardSpec` and `TempDirectorySupport`. The `IF NOT EXISTS` / pg_roles harnesses exist as listed. `OutputHistoryApiHarness` is in `com.helio.testsupport`.
- **Overlap evidence (D8), checked against `backend/build.sbt`:**
  - `Test / testForkedParallel := false` (line 119): suites within a forked group run sequentially.
  - Forked groups are hash groups `floorMod(name.hashCode, HEL924_TEST_GROUP_COUNT)` (lines 211-241).
  - JUnit XML reports are written locally: `backend/target/test-reports` exists in the main checkout, and CI uploads `backend/target/**/test-reports/*.xml` (ci.yml:298). HEL-1287 already used these timestamps to prove whether groups overlapped (build.sbt:187).

### Verdict: REFUTE

Everything round 2 asked for is fixed. Two new, concrete defects remain:
- the C5 overlap-evidence criterion, as now worded, is satisfiable without any forked-group overlap;
- the D7 rule text, implemented literally, flags every migrated file.

Both are cheap text fixes.

### Change Requests

1. **D8's overlap evidence passes even when forked groups run serially, so it cannot detect the HEL-1287 failure mode that C5 exists to catch.** D8 (design.md:93) defines overlap as "distinct zonky instance ids / postmaster pids whose start→shutdown time spans overlap". The loop set includes `VerifiedEmbeddedPostgresSpec`, and that spec deliberately holds cluster A open while it starts the step-2 and step-3 instances in the same JVM. Every iteration will therefore log overlapping distinct-instance spans even if `HEL924_TEST_GROUP_CONCURRENCY` is silently ignored and the four groups run back to back. That is exactly what happened in HEL-1287, where the intended concurrency was really serial (build.sbt:187-191). Any other multi-instance suite would satisfy it vacuously in the same way.

   Redefine the criterion so that intra-suite overlap cannot satisfy it. For example:
   - (a) Use per-suite JUnit XML `timestamp` + `time` from `target/test-reports` (the HEL-1287 method). Compute each suite's group as `floorMod(fqcn.hashCode, 4)`, and require at least one pair of suites from **different** groups with overlapping spans per iteration (for parity, per run).
   - (b) Keep the log-based method, but count only overlapping instance pairs started by **different suites**, and explicitly exclude `VerifiedEmbeddedPostgresSpec`'s own instances.

   Update C5's evidence wording or task 5.2/5.3's verify line to match.
2. **D7's static-start rule as written matches every migrated call site.** D7 bullet 3 flags any file that "contains a static `EmbeddedPostgres.start(`". After migration, every one of the 221 files contains `VerifiedEmbeddedPostgres.start(`, which contains the substring `EmbeddedPostgres.start(`. A literal implementation therefore goes red at task 4.3, and the executor has to invent the boundary rule under pressure.
   - State it in design.md: the token must not be preceded by an identifier character, e.g. `(?<![A-Za-z0-9_$])EmbeddedPostgres\s*\.\s*start\s*\(`.
   - Add a negative pattern case to the guard spec: `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())` is not an offender.

   In the same edit, make D6 steps 4 and 5 call `VerifiedEmbeddedPostgres.startWith(...)` by its qualified name. As written they say `startWith(EmbeddedPostgres.builder()...`. If the spec imports `startWith` and calls it unqualified, D7's exact-prefix rule correctly flags it, which is the round-2 contradiction reappearing in a new spelling.

### Non-blocking notes

- D6 step 5 says the first attempt's data dir is "captured via the observer's argument". `EmbeddedPostgres` has no data-dir getter (verified above), so the observer has to run the real `SHOW data_directory` on its argument, record the result, and then throw. State that in step 5 so the executor does not reach for reflection.
- D4/D6: the "Attempts 2+ force `setPort(0)`" wording (D4) should say "force `setPort(nextPort())`, which is 0 in production" (D6). As written, the two descriptions of the same behaviour differ.
- The step-2 old-path instance is attached to A, so its `close()` runs `pg_ctl -D <own dir> stop`. That is harmless per the source, but say explicitly that the spec closes it, so a leaked shutdown hook is not the only cleanup.

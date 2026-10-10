## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD `6902b57f12a18042daf9b8e4984cc55b2011fc84`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/embedded-postgres-port-race/HEL-1445`.

- **Round-4 CR1 (overlap window).** All four parts landed.
  - The end-based window `[timestamp − time, timestamp]` is at design.md:97.
  - Cross-group overlap must exceed 1 s.
  - The same-group check must find 0 overlaps of more than 1 s, otherwise the iteration is invalidated.
  - The report dir is emptied before each run (design.md:96).
  - `show Global/concurrentRestrictions` must show `Limit forked-test-group to 2` (design.md:95, task 5.3). It runs once before the loop, not per run; see the notes.

  I checked the margin is sound:
  - **Same group:** whole-second truncation can only move a window earlier by less than 1 s. So two suites that ran one after the other can show at most <1 s of overlap. The >1 s threshold correctly rejects them.
  - **Different groups:** a computed overlap above 1 s implies the conservative windows `[end−time, end]` overlap. Both windows lie inside the real suite lifetimes, so it shows real concurrency.

  In `testing_3-2.0.9.jar`, `formatISO8601DateTime` truncates to `ChronoUnit.SECONDS` (javap, scratchpad `hel1445-sbt5`), which confirms the timestamps are whole seconds.

- **Round-4 CR2 (parity source).** Per-suite counts come from fresh JUnit XML. Aborts and the aggregate `Tests:`/`Suites:` lines come from the log (design.md:92, task 5.2).
  - javap shows `writeSuite()` writes one file per suite group, `TEST-<normalized name>.xml`.
  - `endGroup(String, Throwable)` also writes, so an aborted suite normally still produces XML.
  - That makes the "N files for N suites" check well defined. My explanation for round 4's 481-files count (stale files piling up in a dir that was never emptied) is an inference: that worktree has since been cleaned up, so I could not inspect it.

- **Round-4 CR3 (positive evidence).** Each iteration requires the following (design.md:98, task 5.3):
  - `Suites: completed <N>`;
  - every suite header;
  - exactly N XML files, each with `failures="0" errors="0"`;
  - zero failure strings.

  Each run is a fresh JVM via `sbt -batch -Dsbt.server.autostart=false` (design.md:95). This matches the invocation MISTAKES.md documents for sbt 2.0.9.

- **D2.** The SHOW connection is closed on every path: success, mismatch and throw (design.md:31).
- **D7 rule 4.** It is scoped to the builder argument. For `startWith(` that means the first argument, up to the first comma at paren depth 0 (design.md:87).
- **Step-2 close.** It now sits in D6 (design.md:80). D7 starts at :82.

- **zonky 2.0.7, re-read from the sources jar** (scratchpad `hel1445-zonky5`):
  - `close()` calls `pgCtl(dataDirectory, "stop")`, which runs `-D dir.getPath() stop`. It catches failures, releases the lock and deletes the dir. Nothing is addressed by port, so D3 holds.
  - `Builder.start()` auto-detects the port only when `builderPort == 0`. It creates `createTempDirectory("epg")` only when no data dir is set. Both are D1/D4 premises.
  - With an explicit data dir and `cleanDataDirectory=true`, the constructor runs initdb into the supplied dir, so the helper's empty temp dir works.

- **Census.**
  - `grep -rn "EmbeddedPostgres.builder()" backend/src` finds 226 occurrences in 221 files. 223 use the `stringtype` form.
  - The 3 others are `PipelineRunCrossInstanceSpec:44` (bare), `LegacyOutputConfigKeysParitySpec:25` (bare) and `SqlConnectorTlsSpec:37` (multi-line). This matches design.md:11.
  - No current `com.helio.testkit` file contains a builder call, so D5's "no import inside testkit" rule cannot misfire.

- **Line length and scala-quality.**
  - The longest line after wrapping is 154 characters, and 223 lines exceed 120.
  - There is no `.scalafmt.conf`.
  - `check-scala-quality.mjs` has no line-length rule, and its 250-line budget is a soft warning only.
  - So D5's mechanical output will not trip a hard gate.

- **Temp-dir hygiene.** `check-test-temp-dir-hygiene.mjs` accepts `// temp-dir-hygiene: reviewed — <reason>` (REVIEWED_RE, line 33), as D2 plans.

- **Loop suite set.** All 13 existing classes resolve to source files. 12 files reference `OutputHistoryApiHarness` (`com/helio/testsupport`).

- **RLS mutation target.**
  - The role is created at `OutputHistoryApiHarness.scala:76` as `CREATE ROLE $roleName NOSUPERUSER ...`.
  - `assertAppPoolEnforcesRls` is at :120.

- **Owner's binding proof requirements.** Each one maps to a step:

  | Requirement | Where it is covered |
  |---|---|
  | Deterministic repro | D6 steps 2–3, task 1.2 |
  | Migration verified by script | D5 verifier, task 4.2 |
  | Per-suite parity | D8, task 5.2 |
  | Niced ≤4-worker loop judged by log | C4/C5, D8, task 5.3 |
  | RLS mutation | task 5.1 |
  | IF NOT EXISTS kept | Non-Goals, C2 |

  The spec's scenarios match D2–D7.

### Verdict: CONFIRM

All of round 4's change requests and non-blocking notes are reflected in the artifacts. The zonky and sbt premises that matter hold against the jars. The remaining issues below are wording and evidence-hardening points that the executor and evaluator can carry. None of them changes what gets built.

### Non-blocking notes

1. **Concurrency evidence for parity runs.** The concurrency evidence differs between the loop and the parity runs:
   - The `concurrentRestrictions` check runs once, before the loop.
   - Loop iterations prove their own concurrency through the cross-group overlap check.
   - The two parity `testFull` runs have no such check.

   Record `show Global/concurrentRestrictions` under the C5 env before each parity run too, or apply the D8 overlap computation to each parity run's XML. That way parity is shown to have run with 2 concurrent groups.
2. **D7 bullet 1** only mentions `VerifiedEmbeddedPostgres.start(` as the allowed prefix. The following paragraph allows `startWith(` as well. The guard must implement both prefixes, or D6 steps 4–5 will be flagged.
3. **Odd wording at design.md:95.** "(or `--server`-free equivalent the executor confirms)" reads oddly. The two known-good fresh-JVM forms are `-batch -Dsbt.server.autostart=false` (MISTAKES.md) and `--server` (`scripts/ci-sbt.sh`). Use one of them, and check the project-path lines name this worktree.
4. **Parity cross-check.** In the parity runs, also check the XML suite set against the log's `<Suite>:` headers, as the loop does. That catches a suite that ran but wrote no XML.
5. **sbt 2 task caching.** If a fresh-JVM `testOnly` ever turns out to be a cache hit, the positive-evidence check will fail that iteration. That outcome is correct; do not work around it by dropping the check.
6. **AC8.** The PR body must reference HEL-1470 as fixed-by. No task carries this; the orchestrator's PR step must.

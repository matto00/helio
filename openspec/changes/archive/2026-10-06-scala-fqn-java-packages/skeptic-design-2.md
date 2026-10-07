## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: worktree HEAD 659eec3056a180d3accf83438a2c5e66de8152d6 (= main 659eec305), with the uncommitted
planning artifacts under `openspec/changes/scala-fqn-java-packages/`. Prior report (skeptic-design-1.md), design.md
and the driver hit list were treated as claims, and every number below was re-derived by this round.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/scala-fqn-java-packages/HEL-1332`.
- **Round-1 CRs are addressed in the text.** D6 now deletes reports before each run and cross-checks console vs XML
  counts. D6a plus task 1.4 name the two interpolation sites. Task 2.5 picks up the CONTRIBUTING note. But see CR1:
  the path D6 names is wrong under sbt 2.
- **AC2 premise.** `scripts/check-scala-quality.mjs:38-39,55`: the regex is `(<prefix>)\w`, so `java.util.UUID` and
  `java.util.Base64` can never match the `.` that follows them. Confirmed by reading the code.
- **Hit count reproduced independently.** I copied the script into the scratchpad as `hel1332-skeptic2-probe.mjs`,
  changed only the prefix list (to the four new prefixes) and repoRoot, and ran it on the tree. It found 131 hits:
  java.sql 72, java.time 37, java.util 21, scala.annotation 1. They are in 60 distinct files, 25 main and 35 test.
  Symbols inside the hits: Timestamp 69, Instant 29, UUID 20, LocalDate 8, Duration 5, DriverManager 3, ZoneOffset 2,
  ResultSet 1, SQLException 1, Set 1, tailrec 1. This matches design.md's symbol list exactly.
- **Raw grep vs the guard** (`hel1332-skeptic2-raw.txt`): there are 136 non-import/package lines. The 5 lines the guard
  does not see are 3 comments (AssertStep.scala:240, OutputRoutesSpec.scala:901, OutputHistoryRepositorySpec.scala:91)
  and the 2 D6a interpolation sites, PublicDashboardRoutesSpec.scala:127 and PanelBatchCreateSpec.scala:119. So D6a's
  list is complete.
- **Collision check (D5).**
  - Across all of `backend/src`, there is no class/object/trait/type/val/def/var/given defining any of the imported
    simple names.
  - No hit file has a non-`java.*` import of any of those names.
  - The wildcard imports in hit files (slick `api._`, `spray.json._`, `domain.model._`, the repository companions,
    `Directives._`, `model._`, `proto._`, and so on) cannot bring them in, because no definition of them exists in
    the repo. The pekko `model._` and spray wildcards do not export them either.
  - `PipelineRunRegistry.scala:41` uses Scala's `Set`, so the `JSet` rename at :81 is genuinely required.
  - `OutputHistoryRoutesSpec.scala:20` imports only `DurationInt`, so `JDuration` is a choice, as D5 now says
    correctly.
  - Scala version is 2.13.15 (`backend/build.sbt:4`), and there are no `scalacOptions`/fatal-warnings settings.
- **D3 precedent.** `scripts/check-test-temp-dir-hygiene.mjs:94` uses the same `import.meta.url === \`file://${process.argv[1]}\``
  guard.
- **D4 wiring.** `.husky/pre-commit:18` and `ci.yml:115` both run `npm run check:scala-quality`.
  `check-precommit-ci-parity.mjs:42` `NODE_PATH_RE = /\bnode\s+(\S+\.m?js)\b/g` is global, so an `a && b` chain
  resolves both `node` paths.
- **Scope vs owner ruling.**
  - AC1 -> D1/2.1, AC2 -> D1 + D4 red cases, AC3 -> D4/2.3, AC4 -> D5/D6a/1.3-1.6, AC5 -> D6/1.1/3.4.
  - Out-of-scope packages are excluded.
  - Removing `java.util.concurrent.` is a subsumption, not a widening. The `java.util.` prefix adds no hits from
    `java.util.concurrent`/`regex` (those appear only on import lines or in comments).
  - There are no TBDs or placeholders, and the tasks follow D7's order.
- **D6 report path. Reproduced from three independent sources (the defect behind CR1):**
  - `backend/build.sbt:69` and `:88`: "sbt 2 moved `target` to target/out/jvm/...". The build is on sbt 2.0.9
    (`backend/project/build.properties`), migrated by HEL-1018 (90ab7c105, 2026-10-01).
  - Live evidence: a sibling worktree's sbt-2 testFull from today wrote its XML to
    `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/`. That directory is
    `.claude/worktrees/bug/latency-spec-contention-flake/HEL-1344/...`, mtime 2026-10-06 05:02, with 428 TEST-*.xml
    files. The same layout exists in the HEL-1277 worktree (432 files). Neither worktree has a
    `backend/target/test-reports/`.
  - `ci.yml:199,223,231` glob `backend/target/out/**/test-reports` and `backend/target/**/test-reports/*.xml`.
  - The main checkout's `backend/target/test-reports/` is a pre-sbt-2 leftover. Its newest mtime is 2026-09-11, before
    the migration.

### Verdict: REFUTE

The design is sound, and every quantitative and collision claim holds up. One defect remains, and it is in the very
mechanism round 1 required: the AC5 proof deletes and reads a path that sbt 2 no longer writes to.

### Change Requests

1. **D6 and tasks 1.1/3.4: correct the test-report path to the sbt-2 location.**
   - **The problem.** D6 says to delete the worktree's `backend/target/test-reports/` (exact path) before each testFull
     and to read the sorted test names from that run's fresh XML. Under sbt 2.0.9 the reports are written to
     `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/` (evidence above). Followed literally, the
     delete removes nothing and the XML is read from a path that never receives any. Two things can go wrong:
     - The XML name lists come back empty for both runs, so they are vacuously identical.
     - The executor finds the real directory but never clears it, so the 3.4 run inherits 1.1's baseline XML.

     Either way you get the stale or vacuous comparison that round-1 CR1 existed to prevent.
   - **Required revision.** Name the sbt-2 path, `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/`,
     as the exact directory to delete before each run and to read XML from.
   - **Also add a non-vacuity check.** If that run's XML count is 0, or differs from the console `Tests: succeeded N`
     total, the proof is invalid and must not be reported as identical.

### Non-blocking notes

- **D3 CLI guard.** The string compare `import.meta.url === \`file://${process.argv[1]}\`` is false whenever the
  path needs URL-encoding (spaces, `%`) or argv[1] is a symlink. In that case the CLI body silently does nothing and
  exits 0, a green guard that checks nothing. The selftest only exercises `scanScalaText`, so it would not catch this.
  `check-precommit-ci-parity.mjs:208` uses the sturdier `fileURLToPath(import.meta.url) === process.argv[1]`. Prefer
  that form, or have the selftest spawn the CLI once against a red fixture root.
- **Task 3.1 is the only proof that the CLI path is live.** Make sure its log shows the actual 131-violation output,
  not just the exit code.
- **Char literals.** The `'"'` char-literal limit, now that `//` truncation exists, is documented in D2. A selftest
  case that pins the current behaviour would make it explicit.

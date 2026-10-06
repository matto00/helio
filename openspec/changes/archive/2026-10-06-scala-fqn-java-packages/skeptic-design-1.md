## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: worktree HEAD 659eec3056a180d3accf83438a2c5e66de8152d6 (= main 659eec305), with the uncommitted
planning artifacts under `openspec/changes/scala-fqn-java-packages/`.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/scala-fqn-java-packages/HEL-1332`.
- **AC2 dead-prefix premise is true.** `scripts/check-scala-quality.mjs:38-39,55`: the regex is `(<prefix>)\w`, and in
  `java.util.UUID.randomUUID()` / `java.util.Base64.getEncoder` the character after the prefix is `.`, so these entries
  can never match. Unmodified guard on the tree: `Scala code-quality check: clean (211 soft warning(s))`.
- **The hit count claim (131 / 60 files / 25 main + 35 test; sql 72, time 37, util 21, annotation 1) reproduced
  independently.** I copied the script into the scratchpad (`hel1332-skeptic-probe.mjs`) with only the prefix list
  replaced by the four new prefixes, and got 131 hits, the same per-prefix split, and 25/35 distinct files. I didn't
  rely on the driver's file. The distinct symbols match design.md's list: Timestamp 69, Instant 29, UUID 20,
  LocalDate 8, Duration 5, DriverManager 3, ZoneOffset 2, ResultSet 1, SQLException 1, Set 1, tailrec 1.
- **D2 does not change the 131.** I re-applied string blanking, single-line `/* */` removal and `//` truncation to each
  of the 131 hit lines. None dropped out, so no current hit is comment-only.
- **Collision claims.** I searched the whole repo for class/object/trait/type/val/def definitions of every imported
  simple name. There are none. No hit file imports another `Instant`/`Timestamp`/`UUID`/`LocalDate`/`Duration`, and
  the wildcard imports in hit files (pekko `model._`, `Directives._`, `spray.json._`, `domain.model._`, `proto._`)
  bring in none of these names. `PipelineRunRegistry.scala:41` uses Scala's `Set`, so a `java.util.Set` rename at
  :81 is genuinely required. Precedents checked: `JsSemantics.scala:5` uses `java.lang.{Double => JDouble}`, and
  `import scala.annotation.tailrec` already exists in the tree.
- **D3 precedent.** `scripts/check-test-temp-dir-hygiene.mjs:94` uses the same
  `import.meta.url === \`file://${process.argv[1]}\`` CLI guard.
- **D4 wiring and parity.** `.husky/pre-commit:18` and `ci.yml:115` both run `npm run check:scala-quality`. In
  `check-precommit-ci-parity.mjs`, `NODE_PATH_RE` resolves every `node <path>` in a script's command string, so an
  `a && b` chain stays at parity.
- **D6 mechanism.** sbt does write `backend/target/test-reports/TEST-*.xml` (present in the main checkout). In this
  worktree `backend/target` does not exist yet. See CR1.
- **Scope vs the owner ruling.** AC1 maps to D1, AC2 to D1 plus the D4 red cases, AC3 to D4, AC4 to D5/D7/tasks
  1.3-1.6, and AC5 to D6/tasks 1.1 and 3.4. Out-of-scope packages are excluded in the Non-Goals. I found no
  placeholders or TBDs, and tasks follow D7's commit order.
- **Inline in-package FQNs outside the 131.** A raw grep found 136 non-import lines. Three of the extra five are
  comments. Two are real code inside string interpolation, which the guard blanks:
  - `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala:127`:
    `sqlu"... ${java.sql.Timestamp.from(lastRunAt)} ..."`
  - `backend/src/test/scala/com/helio/api/routes/panels/PanelBatchCreateSpec.scala:119`:
    `"${java.util.UUID.randomUUID()}"`, inside an interpolated triple-quoted string

  Neither the design nor the tasks mention these two sites. See CR2.

### Verdict: REFUTE

The design is sound and its quantitative claims hold up. Two specific gaps need revising before execution: the
evidence for AC5, the ticket's central proof, cannot currently go red, and two known in-scope inline FQNs are silently
left out of AC4.

### Change Requests

1. **D6 / tasks 1.1 and 3.4: the before/after test-name proof can be falsely identical.** The name list comes from
   `backend/target/test-reports/*.xml`, and sbt only overwrites XML files for suites that actually run. Once the
   baseline run (task 1.1) has populated that directory, a suite that fails to compile, is skipped or stops being
   discovered after the fixes leaves its baseline XML in place. Task 3.4's sorted name list would then still match
   1.1, which is exactly the regression AC5 exists to catch. Revise D6 and tasks 1.1/3.4 as follows:
   - Delete `backend/target/test-reports/` (exact path, inside the worktree) immediately before each of the two
     testFull runs.
   - Take the total count from that run's own sbt console summary (`Tests: succeeded N, failed M ...`) and cross-check
     it against the XML-derived count.
   - Record both in the `hel1332-baseline-*` and after-run artifacts.
2. **D2 Known limits / AC4: name the two interpolation-embedded inline FQNs and decide them explicitly.** The sites
   are `PublicDashboardRoutesSpec.scala:127` (`${java.sql.Timestamp.from(...)}` in `sqlu"..."`) and
   `PanelBatchCreateSpec.scala:119` (`${java.util.UUID.randomUUID()}`). Both are inline FQNs in executable code, in
   exactly the in-scope packages. AC4 says "every existing hit in those packages". The 131 count only omits them
   because of the guard limitation the design already documents. Recommended: add them to task 1.4 and fix them with
   the same import-only rule, which neither widens the package scope nor changes behaviour. The alternative is to list
   them in design.md as known residuals that will be reported in the PR. Either way the decision has to be written
   down, not left implicit.

### Non-blocking notes

- D5 calls `Duration` a Scala-default name. It isn't: `scala.concurrent.duration.Duration` is not in default scope.
  The only `java.time.Duration` file, `OutputHistoryRoutesSpec.scala`, imports only `scala.concurrent.duration.DurationInt`,
  so a plain `import java.time.Duration` would not collide there. Mandating `JDuration` is still harmless and
  behaviour-preserving, so this is not a blocker. The claim should just not be cited as a verified collision.
- `CONTRIBUTING.md:236` describes what the guard covers. Consider adding `java.sql`/`java.time`/`java.util`/`scala.annotation`
  there so the doc matches the guard. This is optional and not an AC.
- The backend has 18 `'"'` char literals (`grep -rnF "'\"'" backend/src`). With D2's new `//` truncation, a line that
  holds both a char literal and a URL string can now produce a false negative. This is covered by the documented
  known limits, and the selftest could pin it with a case if desired.
- D8: the 4 `java.time.Duration` lines are in `OutputHistoryRoutesSpec.scala`, which HEL-1277 also edits. That makes
  it the likeliest rebase conflict.

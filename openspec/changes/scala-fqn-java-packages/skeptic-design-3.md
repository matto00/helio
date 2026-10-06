## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 659eec3056a180d3accf83438a2c5e66de8152d6 (branch task/scala-fqn-java-packages/HEL-1332). The only
change is the untracked planning dir. The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

- **Hit list, re-derived independently.** I wrote my own probe that reproduces the guard's line-skip and string-blanking
  logic with the four new prefixes (`scratchpad/hel1332-skr3/probe.mjs`), and ran it on the worktree base.
  - Result: 131 lines across 60 files (25 main, 35 test). By prefix: java.sql 72, java.time 37, java.util 21,
    scala.annotation 1.
  - This matches ticket AC4, design.md Context and proposal.md. The location set is identical (`diff` is empty) to the
    orchestrator's `hel1332-hits-main-659eec305.txt`.
  - Symbols found: Timestamp 69, Instant 29, UUID 20, LocalDate 8, Duration 5, DriverManager 3, ZoneOffset 2, and one
    each of Set, SQLException, ResultSet and tailrec. This matches design.md's symbol list.
- **Hits the guard cannot see (D6a).** I ran a raw grep for in-scope prefixes on non-import, non-comment lines. It
  returns 133 locations. The 2 beyond the guard's view are exactly `PublicDashboardRoutesSpec.scala:127` and
  `PanelBatchCreateSpec.scala:119`, as D6a states. Task 1.4 covers both, and task 3.5 re-checks.
- **D2 does not hide any current hit.** None of the 131 hit lines contains `//` or `/*`, so adding the comment stripping
  does not drop any of them. The `'"'` char literal appears in 6 main files, but none of those lines also contains `//`,
  `/*` or any FQN prefix. The documented limitation has no effect on today's tree.
- **Collisions (D5).**
  - No `class/object/trait/type/val/def` named Timestamp, Instant, LocalDate, Duration, ZoneOffset, UUID, Set,
    DriverManager, SQLException, ResultSet or tailrec is defined anywhere under `backend/src`.
  - `PipelineRunRegistry.scala:41` uses Scala `Set`, so the `java.util.Set` hit at :81 really does need a rename.
  - `OutputHistoryRoutesSpec.scala` imports only `scala.concurrent.duration.DurationInt` (line 20), as D5 says.
  - The `JsSemantics.scala:5` rename precedent and `PipelineService.scala:30` `import scala.annotation.tailrec` are both
    confirmed.
- **Wiring (D3/D4).**
  - The parity checker's `resolveUnderlyingPaths` runs `extractNodePaths` over the whole command string, so
    `node A && node B` yields both paths.
  - CI runs `npm run check:scala-quality` (ci.yml:115), and the hook runs it too (`.husky/pre-commit:18`). Both will
    execute the selftest with no ci.yml edit.
  - `check-precommit-ci-parity.mjs:208` uses `fileURLToPath(import.meta.url) === process.argv[1]`, as cited. D3's added
    `resolve()` handles the relative argv npm passes.
  - `check-test-temp-dir-hygiene.mjs` exports `checkFile`, so the cited precedent is real.
- **D6 report path.** `backend/project/build.properties` is sbt 2.0.9 and scalaVersion is 2.13.15. Sibling worktrees
  HEL-1344 and HEL-1277 both have `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports`. The main checkout's
  `backend/target/test-reports` is a stale pre-sbt-2 directory (last mtime 2026-09-11; used only as a "stale" indicator,
  not load-bearing).
  - D6 now names the correct path and adds a non-vacuity cross-check (XML count > 0 and equal to the console total).
    Round-2 CR1 is resolved.
- **AC to task traceability.**

  | AC | Covered by |
  | --- | --- |
  | AC1 | D1 / task 2.1 |
  | AC2 | D1 load-time assertion, task 2.1, and the 3.2 mutation that restores `java.util.UUID` |
  | AC3 | D4 / tasks 2.3, 3.1 and 3.2 (red, green, literals, whole-line and trailing `//`, scaladoc, import/package, plus a real-CLI spawn) |
  | AC4 | tasks 1.2–1.6 and 3.5 |
  | AC5 | D6 / tasks 1.1 and 3.4 |

  - Test hit directories (api 28, domain 3, infrastructure/persistence 40, services 13, spark 1) are fully covered by
    tasks 1.4–1.6.
  - The out-of-scope packages, mapper dedup and ci.yml changes are all excluded (C3, Non-goals).
- **Contract and spec.** No API or schema change. `openspec/specs/backend-file-size-compliance` mentions
  `check:scala-quality` only for file size, so adding the new `scala-inline-fqn-guard` capability with no MODIFIED delta
  is correct. CONTRIBUTING.md:236 is the coverage sentence task 2.5 updates. I confirmed it currently names
  `java.util.UUID`.
- **Hand-waving and contradictions.** No TODO/TBD. The proposal, design, tasks and spec agree with each other. Removing
  `java.util.concurrent.` is a safe simplification, because `java.util.` subsumes it under the same `(<prefix>)\w`
  regex.

### Verdict: CONFIRM

### Non-blocking notes

- **Fixture temp dir (task 2.3).** For the selftest's red fixture tree, use `mkdtemp` with a `finally` removal so no
  directory is left in `/tmp`. The repo has had tmpfs inode exhaustion (see `check-test-temp-dir-hygiene.mjs`'s header).
  Strictly, that guard scans only backend specs, so this is hygiene, not a gate.
- **testFull may outlast the 600000 ms Bash timeout (tasks 1.1/3.4).** If it does, the executor should run it in the
  background with output to a log, rather than taking a truncated console as the summary. The non-vacuity check in D6
  would catch a truncated run anyway.
- **D2 mid-line `/*` (pre-existing gap).** A line where `/*` opens mid-line and continues onto later lines still leaves
  those later lines scanned as code. That can only cause false positives, which are visible, and nothing on today's tree
  triggers it. Optionally pin it in the selftest alongside the `'"'` case.

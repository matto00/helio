## Context

`scripts/check-scala-quality.mjs` builds `fqnLineRegex = (<prefix>|...)\w` from `FQN_PREFIXES` and runs on every
`backend/src/{main,test}/scala` line that is not blank, not an import/package line, not starting with `//` or `*`, and
not inside a line-leading `/* */` block. Double-quoted string literals are blanked before the final match. It runs via
`npm run check:scala-quality` from `.husky/pre-commit:18` and `.github/workflows/ci.yml:115`. It has no selftest, and its
scan logic is not exported, so it cannot be tested on fixtures.

Re-derived on main 659eec305, with only the prefix list changed: there are 131 hit lines across 60 files (25 main,
35 test). By prefix: java.sql 72, java.time 37, java.util 21, scala.annotation 1. The distinct symbols are
`java.sql.{Timestamp, DriverManager, SQLException, ResultSet}`,
`java.time.{Instant, LocalDate, Duration, ZoneOffset}`, `java.util.{UUID, Set}`, and `scala.annotation.tailrec`. Twenty
main repositories share an identical `MappedColumnType.base[Instant, java.sql.Timestamp]` mapper. The full hit list is
`hel1332-hits-main-659eec305.txt` in the session scratchpad. The executor re-derives it with the new guard rather than
trusting this count.

## Goals / Non-Goals

**Goals:** cover the four prefixes. Make a dead prefix impossible. Add a failable selftest wired into the existing gate.
Fix every in-scope hit with a pure import refactor.

**Non-Goals:** other `java.*` sub-packages. Deduplicating the 20 Slick mappers (that is a structural refactor, so it
becomes a follow-up). Multi-line `"""` string tracking. Changing `ci.yml`, `.gitignore` or `playwright.config.ts`.

## Decisions

**D1. Prefix list.** Add `java.sql.`, `java.time.`, `java.util.` and `scala.annotation.`. Remove `java.util.UUID` and
`java.util.Base64`, which are dead, and `java.util.concurrent.`, which `java.util.` subsumes. Keep every other entry.
At module load, throw if any prefix does not end in `.`. This makes the AC2 class of bug structurally impossible, rather
than just fixing today's two instances. The regex shape `(<prefix>)\w` is unchanged. Alternative considered: only append
`\b`-tolerant variants for the dead entries. Rejected, because `java.util.` covers both and a load assertion prevents
recurrence.

**D2. Comment and string handling.** Per line, after the existing line-start skips and the string-literal blanking:
remove single-line `/* ... */` spans, then truncate at the first remaining `//`. Strings are blanked first, so a `//`
inside `"http://..."` is never mistaken for a comment. Then match. The effect is that `val x = 1 // java.time.Instant`
no longer fires, while `val t = java.time.Instant.now() // now` still does. Known guard limits, documented in a header
comment and not fixed in the guard: a `'"'` char literal can confuse the string blanking. Text inside a multi-line `"""` block and
`${...}` inside `"..."` are not scanned as code (false negatives, unchanged from today).

**D3. Testable shape.** Export a pure `scanScalaText(rel, text)` that returns the violation list. Guard the CLI body with
`fileURLToPath(import.meta.url) === resolve(process.argv[1])` (the sturdier form used by
`check-precommit-ci-parity.mjs:208`. A string `file://` compare silently skips the CLI for URL-encoded paths). The
pure-function precedent is `scripts/check-test-temp-dir-hygiene.mjs`, which exports `checkFile`. The CLI accepts an
optional repo-root argument (default: the script's parent dir), so the selftest can also spawn the real CLI once against
a red fixture tree in the scratch/OS temp dir and assert a non-zero exit with the violation printed. That proves the CLI
path is live, not just the pure function. The CLI's output format and exit codes are unchanged.

**D4. Selftest and wiring.** Add `scripts/check-scala-quality.selftest.mjs`, in the same record/pass/fail style as
`check-test-temp-dir-hygiene.selftest.mjs`, with cases for:
- red: one per new prefix, plus `java.util.UUID.randomUUID()` and `java.util.Base64` (proving AC2).
- red: code before a trailing `//`.
- green: import line, package line, scoped indented import, `"..."` literal, whole-line `//`, trailing `//` comment,
  scaladoc `/** */` and `*` lines, multi-line block comment, and a `"http://x"` literal followed by a real hit (it must
  still be red).
- a check that the load-time assertion rejects a dot-less prefix (export the validator).

`package.json`: `check:scala-quality` becomes `node scripts/check-scala-quality.selftest.mjs && node
scripts/check-scala-quality.mjs`, and a `check:scala-quality:selftest` alias is added. The hook and CI already run
`check:scala-quality`, so both run the selftest with no `ci.yml` edit, and `check:precommit-ci-parity` still holds because
it resolves `node <path>` references inside the script.

**D5. Fix method: imports only, collision-checked.** Each hit becomes a top-of-file import plus the bare symbol, placed in
the file's existing import group order. Before importing a simple name `N`, check the file for an existing import or
definition of `N`, including via wildcards (e.g. `scala.concurrent.duration._` brings in `Duration`), and for Scala-default
names (`Set`, `Map`, `List`, `Seq`, `Iterator`, `Duration` and so on). On any collision, use the repo's rename-import
convention (`import java.lang.{Double => JDouble}`, per `JsSemantics.scala:5`): `import java.time.{Duration =>
JDuration}` and `import java.util.{Set => JSet}`. The verified collision site is `PipelineRunRegistry.scala:81`
(`java.util.Set`, since Scala's `Set` is used at :41). The `java.time.Duration` sites in `OutputHistoryRoutesSpec.scala`
import only `DurationInt`, so a plain import does not collide there. `JDuration` is still used for readability, as a
choice, not because of a verified collision. `@scala.annotation.tailrec` becomes `import scala.annotation.tailrec`, as
`PipelineService.scala:30` already does. No expression, signature, or logic changes. There are no fatal-warning
scalacOptions, so an unused import is not a build error, but the change must leave no unused imports in the files it
touches.

**D6. Behaviour-preservation proof.** Run `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` twice, on the
untouched base before any edit and again after the fixes. Immediately before each run, delete the worktree's own sbt-2 report directory
`backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/` (exact path; `backend/target/test-reports/` is a pre-sbt-2 location that sbt 2.0.9 no longer
writes, see HEL-1018), so a suite that silently stops compiling or being discovered cannot leave a
stale baseline XML behind. For each run, record the sbt console summary (`Tests: succeeded N, failed M ...`) and the
sorted test-name list extracted from that run's fresh XML, and cross-check the XML count against the console count.
The pass/fail state, the total count and the sorted name list must all be identical between the two runs. Collision
safety is additionally demonstrated by compilation, and by reviewers re-checking each rename-import site.

**D6a. Interpolation-embedded hits are fixed too.** The guard's string blanking hides two in-scope inline FQNs in
executable `${...}` code. They are `PublicDashboardRoutesSpec.scala:127` (`${java.sql.Timestamp.from(...)}` in
`sqlu"..."`) and `PanelBatchCreateSpec.scala:119` (`${java.util.UUID.randomUUID()}`). AC4 says "every existing hit in
those packages", so both are fixed with the same import-only rule (task 1.4). After the fixes, the executor also runs a
raw grep for in-scope prefixes on non-import, non-comment lines, to confirm nothing else remains that the guard cannot
see.

**D7. Commit order (every commit must pass the hook).** (1) Fix main-source hits. (2) Fix test hits, split by area
(`api/routes`, `infrastructure/persistence`, `services` and others). (3) Guard plus selftest plus `package.json`. The guard
goes last because it would block every commit while hits remain. Red evidence for AC3 is: the new guard run against the
base tree (131 violations) and selftest mutations (drop a prefix, restore `java.util.UUID`) going red.

**D8. Concurrent lanes.** HEL-1277 also edits `OutputHistoryRoutesSpec.scala`, and HEL-1344 edits
`DatasetWriteSubmitLatencySpec.scala`. HEL-1326 has no committed overlap, but the driver expects some. Rebase onto main
late, just before Delivery. Re-run the guard after rebasing. Any new in-scope hit that landed on main in the meantime
gets fixed the same way (that is the same rule, not a scope widening). A textual conflict is reported to the driver, not
resolved by guessing.

## Gate-Chain Implications Checklist

Both changed scripts run from `.husky/pre-commit` (via `npm run check:scala-quality`) and from CI (`ci.yml:115`).

- **What does it execute?** `node scripts/check-scala-quality.selftest.mjs && node scripts/check-scala-quality.mjs`. The
  selftest calls the exported pure `scanScalaText` on in-memory fixtures, then spawns the real CLI exactly once, via
  `process.execPath`, against a temp fixture root. The CLI reads `.scala` files under `<root>/backend/src/{main,test}/scala`
  and prints violations. Neither script runs git, a shell, or any other binary.
- **What environment does it inherit, and from where?** The hook's environment, inherited from git. In a linked worktree
  that includes `GIT_DIR`/`GIT_INDEX_FILE`, and the spawned CLI inherits the same environment. Neither script reads any
  environment variable, and neither runs git. The repo root comes from the script's own path
  (`fileURLToPath(import.meta.url)`, default) or an explicit argv root, never from `GIT_DIR` or the cwd, so the inherited
  git variables have nothing to act on.
- **Does it write anything outside its own sandbox?** Only the selftest's `mkdtempSync(join(tmpdir(), "scala-quality-selftest-"))`
  fixture directory, which a `finally` block removes by its exact path. The guard CLI is read-only. Neither script
  writes to the repository, the git index, or `~`.
- **Does it behave differently from a linked worktree than from a main checkout?** No. With no git invocation and the
  root resolved from the script's own path, each checkout scans its own sources. One caveat: the CLI's entry guard
  compares the realpath-normalised `import.meta.url` with `resolve(argv[1])`. Invoking it through a symlinked absolute
  path would skip it silently (final-gate skeptic, note 2). Hook and CI invocations use a relative path from the
  physical cwd, which the final skeptic confirmed still exits 1 on a red tree.
- **What happens on its first run?** There is no state, cache or install step, so the first run is identical to every
  later one. On the merged tree the guard is clean. A lane whose branch still adds an inline `java.sql.`/`java.time.`/
  `java.util.`/`scala.annotation.` reference will fail its next commit with a message naming the line and the fix (a
  top-of-file import). This is the intended enforcement.

## Risks / Trade-offs

- [Silent shadowing changes resolution without a compile error]: D5's collision check, plus the identical test-name
  list from D6, plus reviewer re-check of each site.
- [Main gains new in-scope hits before merge]: D8 re-runs the guard after the late rebase.
- [The guard blocks unrelated lanes that add inline FQNs after merge]: this is intended. The error message names the fix.

## Planner Notes

- Self-approved: removing `java.util.concurrent.`, which `java.util.` subsumes (pure simplification).
- Self-approved: wiring the selftest through the existing `check:scala-quality` script, because `ci.yml` is off-limits
  per the driver.
- `scala.annotation.` has only 1 existing hit, which is below the driver's escalate-if-many threshold, so it is in scope.

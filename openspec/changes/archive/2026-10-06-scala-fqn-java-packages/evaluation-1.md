## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 4f902799f0d53afb620c0154bfe13fe9a8393950 (5 commits on live-resolved base 659eec3056a1, origin/main unmoved).
Working tree at review/test time: clean apart from the untracked change dir (the normal pre-archive state).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: `FQN_PREFIXES` gains `java.sql.`, `java.time.`, `java.util.`, `scala.annotation.`. The dead
  `java.util.UUID`/`java.util.Base64` entries and the subsumed `java.util.concurrent.` entry are removed (D1).
- AC2: `assertPrefixesEndInDot` runs at load time and is exported. The selftest covers it in both directions. My own
  mutation that re-adds `"java.util.UUID"` makes the selftest crash and exit 1.
- AC3: the selftest has 26 cases: one red case per prefix, the formerly-dead UUID/Base64 entries, trailing `//`, mid-line
  `/* */`, a `"http://x"` literal followed by a real hit, all the D4 green cases, a pin for the `'"'` limit, and one spawn
  of the real CLI against a red fixture root. It is wired through `check:scala-quality` (hook and CI unchanged, so C3
  holds), and the `:selftest` alias exists.
- AC4: I ran the new guard independently against `git archive 659eec305 backend/src`. Result: exit 1 with 131
  violations in 60 files (java.sql 72, java.time 37, java.util 21, scala.annotation 1), matching the ruling exactly.
  At HEAD the guard reports 0. A raw grep at HEAD for in-scope prefixes on non-import, non-comment lines, which also
  catches `${...}` interpolations, finds zero hits. The two D6a interpolation sites (PublicDashboardRoutesSpec:128,
  PanelBatchCreateSpec:121) are fixed. That makes 62 Scala files in total: 60 guard files plus the 2 interpolation-only files.
- AC5 / C1: see Phase 2. testFull is green at HEAD with the same count and a byte-identical sorted name list.
- Out-of-scope packages (net, nio.file, lang, io, awt, math) are untouched. No ci.yml, playwright.config.ts or .gitignore
  edits (C3). All tasks are marked done and match the diff. CONTRIBUTING:236 is updated per task 2.5.

### Phase 2: Code Review — PASS
Gates I ran myself in WORKTREE_PATH (backend/** and root tooling changed; no frontend/** files changed):
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` at HEAD 4f902799f, after deleting the exact sbt-2
  test-reports dir: exit 0. Result: `Tests: succeeded 6081, failed 0, canceled 1, ignored 0, pending 0`, with
  `Suites: completed 436, aborted 0`. The run wrote 436 fresh XML files (all newer than my pre-run marker) containing 6082
  testcases (6081 plus 1 canceled), with no `<failure>` or `<error>` elements. Log:
  scratchpad/hel1332-eval-testfull.log.
- Sorted test-name list (same extraction as the executor's `hel1332-names.sh`): scratchpad/hel1332-eval-names.txt is
  byte-identical (`cmp`) to the executor's hel1332-baseline-names.txt and hel1332-after-names.txt.
- **Resolution of the mtime concern.** The executor's after-run (15:23:59) did finish before commits b974f2d..4f90279
  (15:24–15:40), so its log alone does not prove what tree it tested. I don't rely on it: my own run is at the committed
  HEAD with a clean tree and passes with the same 6081/436 and an identical name list. The executor's baseline is
  load-bearing only for "count unchanged". It rests on mtime ordering (baseline 15:17:50 before apply.py 15:18:56), which
  I state explicitly here. It is independently corroborated, though. My hunk pairing (below) shows no test-title string
  literal changed. Every substitution is in code, and the guard blanks string literals, so an import-only diff cannot
  add, remove or rename a test. The name set is therefore unchanged by construction.
- `npm run check:scala-quality` (selftest 26 passed; guard clean), `check:scala-quality:selftest`,
  `check:precommit-ci-parity` (OK), `check:test-temp-dir-hygiene` (clean), `format:check`, `lint`: all exit 0.
- Selftest mutations I ran on scratch copies all went red: dropping `java.time.` gave 4 failed and exit 1; re-adding the
  dot-less `java.util.UUID` gave a load-time throw and exit 1; removing the trailing-`//` strip gave 1 failed and exit 1.

Import-only verification (scratchpad/hel1332-eval-pair.py). For every backend file, I took the removed non-import lines
with the in-scope prefixes stripped, and the added non-import lines with `JSet`→`Set` and `JDuration`→`Duration` mapped
back. The two sorted multisets are equal in all 62 files (0 mismatches). The only other added lines are 3 blank
import-group separators (PanelBatchCreateSpec, FormSubmissionSpec, FirstRunPlannerSpec). The only removed imports are
4 redundant scoped `import java.time.Instant` lines in ApiRoutesSpec (blocks at ~1064/1099/2624/2655). Those are now
covered by the new top-level import. No logic, signature or expression change.

Shadowing check:
- No `class/object/trait/type/val/def` named Timestamp, Instant, UUID, LocalDate, ZoneOffset, SQLException,
  DriverManager, ResultSet, tailrec, JSet or JDuration exists anywhere in backend/src.
- The wildcard imports in touched files are `com.helio.domain.model._`, `spray.json._`, `PostgresProfile.api._`,
  companion `X._`, `CollectionConverters._` and similar. None of them supplies those simple names.
- Rename sites: PipelineRunRegistry uses `java.util.{Set => JSet}`, because Scala `Set` is used in that file.
  OutputHistoryRoutesSpec uses `java.time.{Duration => JDuration}` (precautionary, per D5). Every other import is plain.
- The ApiRoutesSpec scoped-import removal is safe. The inner wildcards in those blocks (`com.helio.domain.model._`,
  `com.helio.domain._`) define no `Instant`, so resolution still lands on `java.time.Instant`.
- Compilation plus the identical test outcomes confirm this.

Guard code: `scanScalaText` is pure and exported. The CLI is guarded with `fileURLToPath(import.meta.url) ===
resolve(argv[1])` per D3, and accepts an optional root argument. Output format and exit codes are unchanged. Strings are
blanked before comments are stripped, so the `http://` case is handled and pinned. The known limits are documented in
the header. The selftest's OS-tmpdir fixture is removed in `finally`.

Issues: none blocking.

### Phase 3: UI Review — N/A
No UI-affecting files changed (no frontend/**, ApiRoutes.scala, schemas/**, or openspec/specs/** in the diff).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- ApiRoutesSpec: the scoped `import java.util.UUID` lines in the same four test blocks (e.g. ~1064, 1099, 2624, 2655)
  are now just as redundant as the removed scoped `Instant` imports, because `java.util.UUID` is imported at file top
  (line 37). They predate this change, so leaving them is fine. Removing them would make the consolidation consistent.
- Executor evidence hygiene: when an after-run precedes the commits, record `git rev-parse HEAD` plus
  `git status --porcelain` (or a `git stash create`/tree hash) next to the log, so tree identity is self-authenticating
  instead of mtime-inferred.

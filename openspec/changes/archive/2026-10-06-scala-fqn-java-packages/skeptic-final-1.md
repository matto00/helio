## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 4f902799f0d53afb620c0154bfe13fe9a8393950. The base was resolved live with `resolve-review-base.sh`
(exit 0) to 659eec3056a180d3accf83438a2c5e66de8152d6. That is 5 commits. The tree was clean apart from the untracked
change dir, both before and after my work.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned READY.
- **AC1 (prefixes):** `scripts/check-scala-quality.mjs:33-47` adds `java.sql.`, `java.time.`, `java.util.` and
  `scala.annotation.`. It drops the dead `java.util.UUID` and `java.util.Base64` entries and the subsumed
  `java.util.concurrent.` entry. The other prefixes are unchanged (confirmed with `git diff`).
- **AC1/AC4 red-on-base:** I ran the new guard (the CLI with a root argument) against
  `git archive 659eec305 backend/src`. It exited 1 with 131 violations in 60 files: java.sql 72, java.time 37,
  java.util 21, scala.annotation 1. This matches the owner ruling exactly. The old base guard on the same tree reports
  clean, so main was green before.
- **AC2 (dead prefix):** the red cases for `java.util.UUID.randomUUID()` and `java.util.Base64` fire. A red fixture
  containing `java.util.Base64.getEncoder`, run through the real npm path, was flagged (see below).
- **CLI entry guard really executes under `npm run check:scala-quality`:**
  - I wrote a temporary untracked `backend/src/test/scala/com/helio/Hel1332SkfRedFixture.scala` containing a
    `java.sql.Timestamp` line with a trailing `//`, `@scala.annotation.tailrec` and `java.util.Base64`.
  - `npm run check:scala-quality` ran the selftest (26 passed) and then the real CLI. The CLI reported exactly 3
    violations (lines 4, 5 and 6) and the npm script exited 1.
  - I removed the file by its exact path. `git status` was clean afterwards.
  - The hook (`.husky/pre-commit:18`) and CI (`ci.yml:115`) both call `npm run check:scala-quality`.
  - At HEAD, `npm run check:scala-quality` exits 0 with "clean (211 soft warnings)".
- **AC3 selftest is failable.** I mutated scratch copies of the guard and re-ran the selftest after each mutation:
  - These mutations all made the selftest exit 1: remove the `main()` call; drop `scala.annotation.`, `java.sql.` or
    `java.util.`; remove the `/* */` strip; remove string blanking; strip `//` before blanking strings; change the exit
    code to 0 on hits; make the import-skip regex swallow `val` lines; make `assertPrefixesEndInDot` a no-op.
  - One mutation survived: deleting the load-time call `assertPrefixesEndInDot(FQN_PREFIXES);` (line 59). See the
    non-blocking notes.
- **AC4 has no residue at HEAD.** A raw grep for `(java\.(sql|time|util)\.|scala\.annotation\.)[A-Za-z_]` over
  `backend/src/**/*.scala`, excluding only import, package and comment-leading lines, found 0 hits. This grep does not
  blank string literals, so it also covers the `${...}` interpolation sites the guard cannot see (D6a).
- **Import-only refactor:**
  - I read every non-import +/- line of the backend diff. Each is a mechanical `pkg.Name` → `Name` substitution,
    with `JSet` and `JDuration` at the two rename sites. There are no expression, signature or logic changes.
  - The only removed imports are 4 redundant scoped `import java.time.Instant` lines in ApiRoutesSpec, now covered by
    the top-level import.
  - Every added import is used in its file (checked by a scripted word search: 0 unused).
  - No `class/object/trait/type/val/def/var` named Timestamp, Instant, UUID, LocalDate, ZoneOffset, SQLException,
    DriverManager, ResultSet, Connection, tailrec, JSet or JDuration exists in `backend/src`, so there is no silent
    shadowing by a definition.
  - An inner wildcard that shadowed an outer explicit import would be a compile ambiguity, not a silent rebind, and
    the code compiles.
- **AC5 behaviour proof (independent and non-vacuous):**
  - **HEAD, my own run.** I recorded `git rev-parse HEAD` and porcelain status next to the log. I deleted the exact
    sbt-2 reports dir, then ran `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`. Exit 0:
    `Suites: completed 436, aborted 0` and `Tests: succeeded 6081, failed 0, canceled 1`. The run wrote 436 fresh XML
    files with 6082 `<testcase>` entries and 0 `<failure>`/`<error>` elements. Log:
    scratchpad/hel1332-skf-testfull.log.
  - **Base, independent of the executor's mtime-ordered baseline.** CI run 37537275082 (push to main at exactly
    659eec3056a1, conclusion success) summed across its 4 backend shards gives Suites 436, succeeded 6081,
    canceled 1. This is self-authenticating (it is keyed by SHA), so the count is identical before and after without
    relying on mtime.
  - **Name set.** My sorted test-name list (6082 lines, no duplicates) is byte-identical (`cmp`) to both
    `hel1332-baseline-names.txt` and `hel1332-eval-names.txt`. As corroboration, no changed diff line registers or
    renames a test (0 changed lines match `"..." in|should|must|when {`), so the name set is unchanged by construction.
  - **Non-vacuity.** The refactored code is exercised. The 20 Slick `Timestamp` mappers sit on every persistence path
    the suite hits, and the rename sites compile and run in the touched specs. Before the refactor these FQNs were
    invisible to the guard, so this is a genuine before/after pair rather than an assertion.
- **Other gates:**
  - `check:precommit-ci-parity` passes (OK).
  - prettier `--check` and eslint are clean on both scripts, `package.json` and CONTRIBUTING.md.
  - The selftest's tmpdir fixture is removed in `finally`.
- **Scope (C3):** no ci.yml, playwright.config.ts or .gitignore edits. Out-of-scope `java.*` sub-packages are untouched.
  CONTRIBUTING.md:236 is updated to match.
- **UI:** none. No `frontend/**` files changed, so step 4 does not apply.
- **Gate-defect check:** evaluation-1 disclosed its mtime dependency for the executor baseline and corroborated it by
  construction. I did not accept the mtime claim at face value: the base count comes from the SHA-keyed CI run above.
  No gate defect.

### Verdict: CONFIRM

### Non-blocking notes

- **The load-time dot assertion is not pinned by the selftest.** Deleting line 59
  (`assertPrefixesEndInDot(FQN_PREFIXES);`) leaves the selftest green. A stronger, list-wide pin would be to export
  `FQN_PREFIXES` and have the selftest assert that `scanScalaText` flags `` `val x = ${p}Foo` `` for every entry. That
  makes any dead prefix red, whatever its shape, and makes the load-time call redundant rather than load-bearing.
- **The CLI entry guard silently no-ops when invoked through a symlinked absolute path.** I ran
  `node <symlink-to-worktree>/scripts/check-scala-quality.mjs <red-root>` and got exit 0 with no output at all.
  Node resolves `import.meta.url` to the realpath, while `resolve(argv[1])` keeps the symlink. The real npm, hook and CI
  paths are unaffected: npm runs from the physical cwd with a relative argv, and a relative invocation from a cwd
  reached through a symlink still exits 1. So this does not block. The base script ran unconditionally, though, and
  the same pattern exists in `check-precommit-ci-parity.mjs:208`. Comparing `realpathSync` of both sides would close
  it. This is a candidate follow-up in Concertino-agnostic repo tooling.
- **Pre-existing guard false negatives, unchanged by this change and not pinned:** a line that starts with `/*` and has
  code after the closing `*/`, code after a `*/` that closes a multi-line block, a leading-operator continuation line
  starting with `*`, and a one-line `package object ... { ... }` body. There is also a pre-existing false positive:
  the prefix has no left word boundary, so `myjava.util.x` fires. None of these occurs in the tree today.
- ApiRoutesSpec still has redundant scoped `import java.util.UUID` lines in the same blocks (this predates the change,
  and the evaluator already noted it).

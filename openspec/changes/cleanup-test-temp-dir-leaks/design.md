## Context

See proposal.md - Why/What Changes. Re-verified inventory (design-gate skeptic round 1 caught the
original count was wrong): `backend/src/test/scala` has **59 temp-file/dir creation call sites
across 39 files**, in four spellings: 45 `Files.createTempDirectory(`, 10 `java.io.File.createTempFile`/
`File.createTempFile(`, 2 FQN `java.nio.file.Files.createTempDirectory(`, and 2 `Files.createTempFile(`.
Three files additionally call `deleteOnExit()` on a created file/dir — that only cleans up on a
graceful JVM exit, not the killed/OOM'd JVM path that actually caused the 2026-09-10/11 incident,
so it is tracked as its own classification, not treated as "already safe". This repo already has a
precedent for a static-hygiene guard wired into both `.husky/pre-commit` and CI:
`scripts/check-scala-quality.mjs` (registered as `npm run check:scala-quality`, called from
`.husky/pre-commit` and `.github/workflows/ci.yml`'s frontend job per HEL-1123, and covered by
`check:precommit-ci-parity`, which fails if a husky step isn't also a gating CI job). The new
guard follows that exact wiring pattern rather than inventing a new one, and — like the other five
guards already wired into `package.json` — ships its own `:selftest` script.

Concertino's own CON-181 fix for the identical bug class used (a) a shared helper every test
routes through, (b) a guard test that fails on new unrouted entries. This design copies that
shape for Scala/ScalaTest.

## Goals / Non-Goals

**Goals:**
- Every `createTempDirectory`/`createTempFile` call in `backend/src/test/scala` either routes
  through a shared, self-cleaning helper, or is an explicitly-reviewed exception (documented,
  not silently allowed).
- A guard that fails closed if a *new* direct `Files.createTempDirectory`/`createTempFile` call
  is added outside the helper, in CI and pre-commit (parity-checked).
- Zero net growth of `/tmp/helio-*` (or any temp-dir prefix used by these tests) across a full
  `sbt test` run.

**Non-Goals:**
- Rewriting fixtures that intentionally hold one temp dir open for a whole suite's lifetime
  (e.g. `BeforeAndAfterAll`-scoped resource pools) — these are audited case-by-case; not every
  call site needs to move, only those that currently never clean up.
- Frontend/Playwright temp-file handling — out of scope per the ticket AC's own framing
  (sweep-and-report for backend/frontend; premise check found no frontend leak pattern).
- Any production runtime change.

## Decisions

1. **Shared trait `TempDirectorySupport`** (`backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala`),
   mixing in `org.scalatest.BeforeAndAfterAll`. Exposes `def newTempDir(prefix: String): Path` and
   `def newTempFile(prefix: String, suffix: String): Path`, each registering the created path in a
   private buffer; `afterAll()` deletes every registered entry (recursive for directories via
   `Files.walk` deleting depth-first, direct delete for files). **Delete failures are collected and
   re-thrown as a single `afterAll` failure (via `withClue`/an aggregated exception), never merely
   logged** — a chmod-locked-down tree (see `LocalFileSystemSpec`'s permission tests, which
   deliberately strip write permission and restore it only in the test's own `finally`) must still
   surface as a real cleanup failure if that restore didn't run, not disappear behind a swallowed
   log line; this was the design-gate skeptic's load-bearing correction to round-1's "log and
   continue" plan, which would have re-created the exact silent-leak failure mode this ticket
   exists to close. One entry's delete failure does not stop the loop from attempting the rest —
   all failures are collected, then raised together. Chosen over a `try/finally` per test because
   several leaking call sites create the dir once at class-field scope (`LocalFileSystemSpec`'s
   `tempDir`), which `afterEach` can't reach — `afterAll` matches that lifetime. Specs needing
   per-test cleanup can call `newTempDir`/`newTempFile` inside the test body; the same `afterAll`
   still catches it.
2. **Migrate `LocalFileSystemSpec` fully**: the class-field `tempDir` and the three per-test
   dirs (`helio-from-env-abs`, `-create`, `-compat`) all move to `newTempDir(...)`. Confirm the
   existing permission-restore `finally` blocks (lines ~176-225) still run before `afterAll`'s
   delete attempt — they must, since `afterAll` fires after all per-test `finally`s in the class.
3. **Sweep the remaining 58 sites** (see Context for the four spellings), classified into:
   (a) migrate to `TempDirectorySupport` — creates a temp file/dir with no existing cleanup;
   (b) already safe — has its own working `try/finally`/`afterAll`/equivalent, left untouched;
   (c) `deleteOnExit()`-only (3 files: `InProcessPipelineEngineSpec`, `PipelineRunRoutesSpec`,
   `PipelineRunServiceSpec`) — treated as classification (a), not (b): `deleteOnExit` only fires on
   a graceful JVM exit, not the killed/OOM'd path that caused the actual incident, so these migrate
   too. Record every file in the PR body — the AC requires this list even for (b) no-ops, not just
   the ones changed.
4. **Guard**: `scripts/check-test-temp-dir-hygiene.mjs`, following `check-scala-quality.mjs`'s
   walk-and-regex-match shape, but matching **all four spellings** found in Context —
   `Files.createTempDirectory(`, `Files.createTempFile(`, the FQN `java.nio.file.Files.*` forms, and
   `java.io.File.createTempFile(`/`File.createTempFile(` (round-1 skeptic feedback: a regex
   matching only the first spelling misses 10 of 59 real sites, permanently). Flags any
   `backend/src/test/scala/**/*.scala` file matching any of the four, UNLESS the file is
   `TempDirectorySupport.scala` itself (the one place allowed to call the raw APIs) or the line is
   annotated with a `// temp-dir-hygiene: reviewed — <reason>` trailing comment (an explicit,
   grep-visible escape hatch for the classification-(b) exceptions from Decision 3). Ships its own
   `check:test-temp-dir-hygiene:selftest` script — mirroring every other guard already in
   `package.json` (`check:precommit-ci-parity:selftest` etc.) — that plants one instance of each of
   the four spellings in a fixture and asserts the guard flags all four, so the guard's own
   completeness is regression-tested, not just asserted in a PR body. Wired as
   `npm run check:test-temp-dir-hygiene`, added to `.husky/pre-commit` (after
   `check:scala-quality`) and to `.github/workflows/ci.yml`'s frontend job alongside the other
   HEL-1123 checks (`:selftest` added there too, same pattern as `check:precommit-ci-parity`),
   keeping `check:precommit-ci-parity` green.
5. **Evidence, not just the guard**: a one-off manual before/after inode count around a full
   `sbt test`, recorded in the PR body, covering **every distinct prefix actually observed** in the
   59 call sites (`helio-*`, `analyze-*`, `audit-*`, `csv-*`, `hel1076-*`, `hel914-*`, `hel974-*`,
   `output-*`, `patch-*`, `pipeline-*` — enumerated from the real `createTempDirectory`/
   `createTempFile` string-literal prefixes, not just `helio-*`, which the round-1 draft
   undercounted) — this is the AC's own explicit verification method and is complementary to, not
   replaced by, the static guard (the guard proves no *new* unrouted call site can be added; the
   count proves the *existing* ones no longer leak).
6. **Guard failability demonstration**: in a scratch commit (never merged), add one bare call of
   each of the four spellings to a test file, run the guard, confirm it fails on each, then revert.
   Cite the exact mutations and command output in the PR body per the driver's evidence
   requirement — do not merge the scratch commit itself. (This is in addition to, not a substitute
   for, the guard's own `:selftest` from Decision 4 — the scratch-commit demo proves it against a
   real file in this repo; the `:selftest` proves it durably on every future run.)

## Risks / Trade-offs

- [Recursive delete in `afterAll` throwing on a genuinely-locked file could mask a test's own
  assertion failure] → ScalaTest already runs `afterAll` after all test results are recorded, so
  an `afterAll` failure surfaces as its own separate failed test, not a replacement for an earlier
  one — both are visible in the report. This is why round-1's "swallow and log" was wrong to begin
  with: it hid exactly this signal instead of merely risking confusing it.
- [Some of the 58 remaining sites may already be safe (their own `finally`), so migrating them adds
  churn for no benefit] → only migrate sites that actually lack cleanup (classifications a/c);
  document (don't touch) classification-(b) sites, per Decision 3.
- [A grep-based guard can't perfectly distinguish "the helper's own internal call" from "a test
  calling the raw API"] → scope the exemption to `TempDirectorySupport.scala`'s own path plus
  the explicit reviewed-comment escape hatch, mirroring `check-scala-quality.mjs`'s existing
  precedent for handling intentional exceptions.
- [No DB migration expected; if a future finding requires one, next free version is V107] →
  flag to the driver before creating any migration file — not expected to be needed here.

## Migration Plan

No deploy/rollback concerns — test-only change, no runtime behavior affected. Land as one PR;
if the guard proves too strict in review (false positives on a legitimate exception), widen the
reviewed-comment escape hatch rather than removing the guard.

## Gate-Chain Implications Checklist

(CON-132 — `.husky/pre-commit` is touched: adding one `npm run check:test-temp-dir-hygiene` line.)

- **What does it execute?** A new Node script, `scripts/check-test-temp-dir-hygiene.mjs`, that
  walks `backend/src/test/scala` and regex-matches for direct `Files.createTempDirectory`/
  `createTempFile` calls outside the allowed helper/escape hatch. Read-only — no writes.
- **What environment does it inherit, and from where?** Whatever `.husky/pre-commit` itself
  runs under (the committer's shell env, Node from `PATH`) — identical to the existing
  `check:scala-quality` step it sits next to; no new env variables or secrets needed.
- **Does it write anything outside its own sandbox?** No — pure static analysis, exits non-zero
  on violation, writes nothing to disk.
- **Does it behave differently from a linked worktree than from a main checkout?** No — it only
  reads `backend/src/test/scala/**/*.scala` relative to the repo root it's invoked from, exactly
  like `check-scala-quality.mjs` already does in a worktree today.
- **What happens on its first run?** It should pass cleanly once this change's own migration is
  complete (every existing call site is either migrated or has a reviewed-comment exemption) —
  the check is written and validated as part of this same change, not landed ahead of the fix.

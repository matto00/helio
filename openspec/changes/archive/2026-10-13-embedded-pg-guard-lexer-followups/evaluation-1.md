## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `6fee572edf59953046cbfa0fccb62faeacf6ac4e` (branch `task/embedded-pg-guard-lexer-followups/HEL-1474`).
Diff base was resolved live with `resolve-review-base.sh`: `c830aa87588c21ca0a0e46ec9fddba48f41d6a1b`.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 (`$"` and raw `\"` reject cases red then green, each fix's revert red) | PASS. Re-derived independently (see Phase 2). |
| AC2 (GUARD relabel plus balanced failable variants) | PASS. See the note on the nested-splice variant below. |
| AC3 (archived D7 wording) | PASS on the three named edits. One adjacent false claim remains (Change Request 1). |
| AC4 (CONTRIBUTING note) | PASS. `CONTRIBUTING.md:254`. |
| AC5 (split, 250-line budget, whole-tree STATS) | PASS. Line counts are 111, 145, 101 and 124. `check:scala-quality` gives no testkit warning. STATS is `raw-fallback-files=0 offenders=0`. |
| AC6 (fatal path closes the instance and deletes the dir) | PASS. The test is red on the old helper, and separately red when only `close()` is removed. |
| AC7 (zonky start failure deletes the dir, behaviour recorded) | PASS. The test is red when line 66's `deleteQuietly` is removed. The zonky citations were checked against the 2.0.7 sources jar. |
| Tasks all done and matching | PASS |
| Scope creep | None |
| Regressions | None. The full backend suite is green (Phase 2). |
| Planning artifacts and spec delta reflect the result | PASS, apart from Change Request 2 (the Follow-up the design required has not been filed). |
| `workflow-state.md` CONSTRAINTS honoured | PASS. The list is empty. |

**Issues:**

1. **Archived D7 still says those three cases were shown red.** `openspec/changes/archive/2026-10-10-embedded-postgres-port-race-guard/design.md:97` still reads "the allowlist cases and the splice cases were each shown red against the previous guard (`proof/c3-guard-red-green.txt`, `proof/c5-guard-red-green.txt`)".
   - The cited archived proof contradicts this. `c5-guard-red-green.txt:17` lists only `slash-star-slash, glob, double slash, paren-less start` as missed.
   - The triple-quoted, nested-splice and char-literal splice cases were never red. That is exactly the fact this ticket exists to record (ticket item 1: "relabel ... as never-red GUARDS (they never failed on the pre-fix tree)").
   - The change relabels them in the test spec but leaves the same false claim in D7, the paragraph this change is correcting. AC3's three named edits are done, but the ticket's purpose is not.

2. **The Follow-up ticket for the zonky postmaster leak was not filed.** Design D5 and the Planner Notes require a Follow-up ticket (relatedTo HEL-1474) if zonky can leave a postmaster alive on a throwing start. `proof/zonky-start-failure.txt` confirms it can: a failure after `EmbeddedPostgres.java:275` leaves a live postmaster that only the JVM-exit hook stops. The proof says it was "Reported to the driver". Linear's HEL-1474 relations show only HEL-1445, so no Follow-up exists yet.

**The nested-splice variant spans two lines (driver's question).** This does not matter for AC2, but it should be documented.
- The variant is `s"a ${g(s"b ${"//"}")}" ; <direct>\n}" // "`. The direct start does sit on the same line as the construct, which is what "same-line" protects.
- The second line is not decoration, and no strictly one-line failable variant exists for this mutation:
  - Under "splice recursion only at depth 0", the `//` that hides the start also comments out the rest of the line.
  - That leaves the outer splice open, so a one-line form falls back to the RAW scan and stays flagged.
  - The splice can therefore only be closed on a later line.
- I confirmed the variant goes red under the mutation and that `usesRawFallback` is false for it.
- Two weaknesses:
  - The tail `}" // "` is not well-formed Scala.
  - Neither the spec comment nor `proof/guard-mutations.txt` says why the second line is needed, while the test name says "same-line".
- This is a documentation gap, not a test defect (see Non-blocking Suggestions).

### Phase 2: Code Review — PASS

**Gates (fresh runs in WORKTREE_PATH, `nice -n 19`, `sbt -batch -Dsbt.server.autostart=false -J-Xmx3g`):**

- **`testOnly com.helio.testkit.*`:** exit 0, 27 tests in 4 suites, all green, STATS `files-scanned=651 raw-fallback-files=0 offenders=0`.
- **Whole backend suite** (`testFull`), split into 8 foreground shards with `HELIO_TEST_SHARD_INDEX=0..7 HELIO_TEST_SHARD_COUNT=8`:
  - Every shard exited 0 with the hel1468-guard summary `failed=0 aborted=0 unreadable=0`.
  - Totals are 612 suites and 8,063 tests succeeded, 0 failed.
  - 4 tests were canceled; they are pre-existing `HELIO_MEASURE`-gated report-only and latency tests.
  - The three changed or new testkit suites ran in shards 0, 4 and 7.
- **Repo checks:** `check:repo-integrity`, `check:scala-quality` (no testkit warnings), `check:test-temp-dir-hygiene`, `check:openspec`, `check:spec-structure`, `format:check` and `check:no-credential-leak` all pass.
- **Frontend gates:** none apply (no `frontend/**` changes).

**Red-first claims, re-derived by my own temporary mutations** (each restored; `cmp` against a backup confirmed the restore, and `git status` is clean):

- **Pre-fix lexer:** I rebuilt it from the exact pre-change body of `c830aa875`'s spec, lines 54-157.
  - A diff confirmed the moved lexer differs from that body only by the two D1 fixes.
  - Result: red, with exactly `not flagged: dollar-quote escape, raw backslash-quote`. Every other test was green.
- **Revert D1(a) alone** (delete the `$"` line): red, `dollar-quote escape` only.
- **Revert D1(b) alone** (no `\x` pairing in raw strings): red, `raw backslash-quote` only.
- **Mutations on the three GUARD constructs:**
  - `val triple = false`: only the balanced `triple-quoted` case is red.
  - `charLiteral()` replaced by `emit()`: only the balanced `char literal` case is red.
  - Splice recursion at depth 0 only: only the balanced `nested splice` case is red.
  - Under all three, the three original GUARD cases stayed green, which matches the fail-closed label.
- **Helper:**
  - With the fatal `case` removed, the fatal test fails at `VerifiedEmbeddedPostgresSpec.scala:164` (the dir still exists).
  - With only `pg.close()` removed from that case, it fails at `:165` (`portRefused` is false), so the "instance closed" assertion fails on its own.
  - With `deleteQuietly` removed at `VerifiedEmbeddedPostgres.scala:66`, the start-failure test fails at `:191`.
- **scalac 2.13.15**, run independently from the coursier jars: `s"a $" b"` gives `a " b`, and `raw"a\"b // c"` gives `a\"b // c`. This confirms D1's premise.

**Case inventory:** I extracted every test name and every Seq or assertion literal from the old spec and the two new specs and compared them. Nothing was lost.
- Only-before entries are the two regex lines that moved into the `EmbeddedPostgresStartGuard` object, a trailing-comma difference, and the accept-case variable renamed from `wrapped` to `ok`. The `ok` value is identical to the old `wrapped`.
- Only-after entries are the new cases.
- ScalaTest test count went from 13 to 16, which accounts for the 3 new tests.

**Other checks:**
- **Rendered Concertino files:** none committed. The diff touches no `scripts/concertino/`, `.concertino/` or `concertino-*` agent or command path.
- **`files-modified.md`:** uses repo-relative paths throughout.
- **Code quality:**
  - No FQNs, no `any`-style escape hatches and no dead code.
  - The `newDataDirectory` seam is defaulted and `private[testkit]`, and `start` behaviour is unchanged.
  - The fatal path adds `close()` failures as suppressed and rethrows the same throwable, as D5 requires.
- **Leaks:** after my runs there are no leaked postmasters or `hel1474-*` dirs. The `/tmp/epg*` dirs that remain date from 00:26-02:57 today and predate this review.

### Phase 3: UI Review — N/A

Test-only backend change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` path is touched.

### Overall: FAIL

### Change Requests

1. In `openspec/changes/archive/2026-10-10-embedded-postgres-port-race-guard/design.md:97`, replace "the allowlist cases and the splice cases were each shown red against the previous guard" with an accurate statement. For example: "the allowlist cases and four splice cases (`*/*`, glob, `//`, paren-less start) were shown red against the previous guard; the triple-quoted, nested-splice and char-literal splice cases never failed and are fail-closed GUARDs (HEL-1474)". Keep the existing `_Corrected by HEL-1474 (2026-10-13)._` convention.
2. **(Orchestrator, if the executor cannot.)** File the Linear Follow-up that design D5 requires: zonky 2.0.7 `start()` failing after `EmbeddedPostgres.java:275` leaves a live postmaster that only the JVM-exit hook stops. Mark it relatedTo HEL-1474 with the Follow-up label, and cite `proof/zonky-start-failure.txt` fact 2. Then record the ticket id in that proof file.

### Non-blocking Suggestions

- `EmbeddedPostgresGuardLexerSpec.scala:213-214` and `proof/guard-mutations.txt`:
  - State why the nested-splice variant needs a second line: the hiding `//` consumes the rest of the line, so the splice the mutation leaves open can only close on a later line, and a one-line form falls back RAW.
  - Optionally use a well-formed tail, e.g. wrap it as `def f = { val t = s"..."; <direct>\n}; val q = '"'`, which I worked through by hand to stay balanced under the mutation.
- The STATS test (`EmbeddedPostgresGuardLexerSpec.scala:90-99`) only logs `raw-fallback-files`. Under the `triple` mutation it reported `raw-fallback-files=222` and still passed. Asserting `raw shouldBe empty` would make a lexer regression that pushes real files to the RAW fallback fail loudly. This gap predates HEL-1474.
- `EmbeddedPostgresStartGuard.scala:23` has a double parenthetical, "(by [[EmbeddedPostgresGuardLexer]]) (code in a comment ...". `:50-51` has a doubled blank line.

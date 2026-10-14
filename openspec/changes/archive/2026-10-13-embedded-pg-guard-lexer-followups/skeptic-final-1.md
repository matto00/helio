## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `18db453d3cbb07408c42f28d82288820f6629b15`, base resolved live via `resolve-review-base.sh` = `c830aa87588c21ca0a0e46ec9fddba48f41d6a1b` (2 commits). Spawn-cwd guard: `READY`. No UI changes (backend test code + docs), so step 4 (servers/screenshots) is not applicable.

### What I verified (with evidence)

All sbt runs: fresh `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly ..."` from `backend/`. Every temporary mutation was restored with `git checkout -- <file>`; `git status --short` afterwards showed only the untracked `evaluation-2.md` (and now this report).

- **Green baseline:** `testOnly com.helio.testkit.*` gave 4 suites, 27 tests, 0 failed. The embedded-PG logs carry the current timestamps, so the suites really ran and were not served from cache. Whole-tree STATS: `files-scanned=651 files-with-splice-literals=228 raw-fallback-files=0 offenders=0`. The whole-tree offender assertion (`have no test source that starts embedded Postgres without the verified helper`) passes.
- **AC1, mutation evidence (reproduced myself):**
  - With line 43 (the `$"` escape) deleted, only `dollar-quote escape` goes red (`EmbeddedPostgresGuardLexerSpec.scala:42`).
  - With the `!raw` pairing condition restored (the original 3-line shape), only `raw backslash-quote` goes red.
  - The pre-fix lexer is both reverts together, so red-first holds.
  - The accept cases (the same literals plus a wrapped start) stay green.
  - Scalac 2.13.15 semantics are recorded in `proof/scalac-escapes.txt` (`A=[a " b]`, `R=[a\"b // c]`), and `build.sbt:4` confirms 2.13.15.
- **AC2:**
  - The three original cases are byte-identical to the c830aa875 originals. They now sit in a separate test whose name and comment label them `fail-closed GUARD (never red)`.
  - I reproduced two of the three targeted mutations. With `charLiteral()` changed to `emit()`, only the `char literal` balanced variant goes red. With splice recursion disabled below depth 0, only `nested splice` goes red.
  - I did not re-run the `triple` mutation myself. It is shown in the sbt transcript in `proof/guard-mutations.txt:51-69`: `not flagged: triple-quoted`.
  - The variants assert `usesRawFallback == false`, so they stay balanced as designed.
- **AC3:**
  - The archived `2026-10-10-embedded-postgres-port-race-guard/design.md` D7 diff no longer says "raw without escapes".
  - "cover each construct" became "cover the constructs listed above".
  - Gap 3 names its residual members: backquoted identifiers, XML literals, and wrapped-builder-to-user-function as deliberate evasion.
  - The Red-first line is corrected so the three cases are no longer claimed red.
  - Each edited paragraph carries `_Corrected by HEL-1474 (2026-10-13)._`.
  - A grep of the archive and the live spec finds the old phrases only in the historical `skeptic-final-4.md`, which quotes them as findings. That is correct.
- **AC4:** `CONTRIBUTING.md:254` names `VerifiedEmbeddedPostgres.start` and `EmbeddedPostgresStartGuardSpec`.
- **AC5:**
  - File sizes (`wc -l`): Lexer 111, LexerSpec 106, StartGuard 144, StartGuardSpec 124. All are under 250, and `scripts/check-scala-quality.mjs` reports clean.
  - Case inventory: every old test name and Seq label is still present, and the additions are exactly the new tests and labels.
  - Moved code: a sorted-line diff of old vs. new shows only the two fixes, wrapper/object lines and doc comments.
  - STATS show 0 raw-fallback files and 0 offenders.
- **AC6:**
  - Reverting the fatal-path catch makes the fatal test red at `VerifiedEmbeddedPostgresSpec.scala:164` (directory left).
  - A separate mutation keeps `deleteQuietly` but skips `pg.close()`. The test then goes red at `:165` (port still accepting), so the "instance closed" assertion can actually fail.
  - The test also asserts the same throwable instance and `calls == 1` (no retry).
- **AC7:**
  - Removing `deleteQuietly(dir)` from the `b.start()` catch makes the failed-start test red at `:191`.
  - I checked every zonky 2.0.7 line cited in `proof/zonky-start-failure.txt` against the extracted coursier sources jar: :156-161, :275, :283, :285, :330-335, :632-633. All match.
  - Linear HEL-1586 exists: Backlog, labelled `Follow-up`, relatedTo HEL-1474 and HEL-1445, and it describes the post-`pg_ctl start` survival path.
- **Spec delta:** the MODIFIED requirement headers match `openspec/specs/backend-embedded-postgres-isolation/spec.md`, and `openspec validate embedded-pg-guard-lexer-followups --strict` reports valid.
- **Helper code review:**
  - The fatal branch closes the instance (best-effort; a close failure is added as suppressed), deletes the directory, then rethrows the same throwable.
  - NonFatal behaviour is unchanged.
  - The `newDataDirectory` seam is `private[testkit]`-scoped and defaulted, and the production `start` path is unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- The triple-quoted and char-literal balanced variants do not sit inside a `${...}` splice. They test the same `string()`/`charLiteral()` routine that splices reuse via `code(inSplice = true)`, and the targeted mutation hits that routine. This is a fair reading of AC2's "each construct", though not a splice-path proof as such.
- The nested-splice variant's second line (`}" // "`) is deliberately not valid Scala. This is disclosed in the spec comment and acceptable for a lexer test.
- Under the char and nested mutations the whole-tree scan stays green (offenders=0). Only the unit variants detect those regressions, which is exactly why they were added.
- The STATS test logs but does not assert raw-fallback=0. This is known and out of scope; it should be noted in the PR as planned.
- HEL-1586 cites the proof path under `openspec/changes/embedded-pg-guard-lexer-followups/`. That path moves on archive, so updating the ticket's pointer after the archive commit would be worth doing.
- Gate defect check: no mtime-ordering evidence is relied on here; all claims rest on reproduced test runs, diffs and line citations.

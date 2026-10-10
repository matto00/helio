## Skeptic Report — final gate (round 3, skeptic-final-3.md)

I reviewed HEAD `e4ed945e89fd6ce0ffc0f4a53f0a69370bb4a00e`. I resolved the base live with `resolve-review-base.sh` as `5ba82b39f5de50eb414b9f95f4f06bf4b89634cb`. That is `origin/main` (HEL-1468) and the merge-base. The change is test-only, so there is no UI and step 4 does not apply.

### What I verified (with evidence)

**Scope and merge.**
- `git diff --name-only 5ba82b39f...HEAD` touches only `backend/src/test/scala/**` (224 files = 221 migrated + 3 new) and this change dir.
- The merged HEL-1468 files (`backend/build.sbt`, `backend/project/*`, `ScalaTestSummaryGuardSpec.scala`, `scripts/ci-sbt*`) have an empty diff against base.
- Since round 2 (`2d49fc3e8`), the only backend file that differs from base is `EmbeddedPostgresStartGuardSpec.scala`. The helper, the regression spec and all migrated files are unchanged.

**Q1: can the helper hand a test a foreign cluster? No.** `VerifiedEmbeddedPostgres.scala` is unchanged since round 2, and I re-read lines 44-87 myself.
- Each attempt gets a fresh `createTempDirectory`, which is set via `setDataDirectory`.
- The instance is returned only if `SHOW data_directory` equals `realDir` or `plainDir`.
- On a mismatch or an observer throw, the helper calls `close()` (zonky's `pg_ctl -D <own dir> stop`, never addressed by port) and deletes its own dir.
- Attempts are bounded, and exhaustion raises an `IllegalStateException` carrying the per-attempt log.

A foreign postmaster cannot report a live, unique temp dir that belongs to us. Round 2's analysis still holds, and nothing in this area changed.

**AC2 / C1, migration.** I ran `verify-embedded-postgres-migration.py 5ba82b39f5de...` against the live merge-base:
- `files with builder at base: 221`
- `changed backend files ... 224 (expected 224 = 221 + 3 new)`
- `base occurrences: 226  wrapped: 226  unwrapped: 0  inserted imports: 221`
- `RESULT: PASS`

**C2 / AC5.** `git diff -U0 5ba82b39f...HEAD -- backend` has zero changed lines matching `ROLE|GRANT|BYPASSRLS|IF NOT EXISTS|REVOKE`.

**Commit hygiene.** I checked all 4 branch commits (`feaa10b6e`, `2d49fc3e8`, `d3f24c387`, `e4ed945e8`). None contains `claude.ai`, `Claude-Session` or a session link. Each has only the `Co-Authored-By` trailer.

**Fresh targeted sbt run (mine).** Command: `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly com.helio.testkit.VerifiedEmbeddedPostgresSpec com.helio.testkit.EmbeddedPostgresStartGuardSpec"`, run in `backend/`. The log shows:
- `loading project definition from .../HEL-1445/backend/project`
- both suite headers
- 14 `- should` lines
- `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
- `Suites: completed 2, aborted 0`
- `Tests: succeeded 14, failed 0`
- zero `TESTS FAILED` / `*** FAILED` / `RUN ABORTED` / `*** ABORTED`

So `[hel1468-guard]` does appear on this branch. I did not re-run testFull, because only the guard spec changed since the parity runs and the merged HEL-1468 files are byte-identical to base.

**Red-first for the cycle-3 cases.** `proof/c3-guard-red-green.txt` shows the new reject test red against the previous guard: `not flagged: B1 ... B6b, junit rule, junit5 extension, other-package import`, with `*** 2 TESTS FAILED ***`. It then goes green in a fresh JVM.

**Q2: realistic spellings and round-2's bypass classes are CLOSED.** I extracted guard lines 1-169, dropping only the two scalatest imports (checked with `diff`). I compiled it with scalac 2.13.15 against `embedded-postgres-2.0.7.jar`, together with real, compiling probe files, then ran `offendersIn` on each:

| Probe | Result |
|---|---|
| B1 `EmbeddedPostgres._` | flagged |
| B2 `.{builder => b}` | flagged |
| B3 `.start` | flagged |
| B4 nested `import EmbeddedPostgres._` | flagged |
| B5 backticks | flagged |
| B6 `PreparedDbProvider` in a selector | flagged |
| reflection via `classOf[EmbeddedPostgres]` | flagged (via `.Builder`) |
| `EmbeddedPostgres` | does not compile in 2.13.15, so it is not a route |

The allowlist design is sound: every non-reflective route to zonky's statics has to name the `EmbeddedPostgres` term or a banned class.

**Q3: the comment stripping opens a real bypass. This is a NEW class, not a leftover.** It was introduced in round 3 by `stripComments` (`EmbeddedPostgresStartGuardSpec.scala:55-87`).
- The stripper pairs `"` characters without understanding interpolation splices.
- For `s"...${ f("x") }..."`, it closes the outer string at the *inner* literal's opening quote. The inner literal's content is then lexed as code.
- If that content contains `//`, the rest of the line is blanked. If it contains `/*`, everything up to the next `*/` is blanked, which can be many lines (a following scaladoc's `*/` is enough).
- Inner `"""` in a splice is worse: it opens a triple-quoted string that runs to the next `"""` anywhere in the file, and quote pairing stays inverted after that.

These probes all compile and are well-formed Scala, and the guard returns them clean:
- **B9:** `def accept(h: Map[String,String]) = s"${h.getOrElse("accept", "*/*")}"`, then `val pg = EmbeddedPostgres.builder().start()`, then `/** x */`. Result: `Vector()`.
- **P1:** the same `"*/*"` Accept-header splice. The direct start on line 7 is blanked.
- **P3:** `s"${"jdbc:postgresql://"}$h"; val pg = EmbeddedPostgres.builder().start()`. The start is blanked.
- **P2:** `s"files: ${glob("**/*.csv")}"`. This also opens a block comment.

The trigger already exists in the real tree. `PublicDashboardRoutesSpec.scala:514` has `${encodeFilter("""{"quick":"10"}""")}` inside an `s"..."`. I diffed the guard's `stripComments` output against a splice-aware lexer across all 501 test files:
- PublicDashboardRoutesSpec diverges from line 514 to line 560, and pairing is inverted after that.
- Today the divergence only *keeps* comments (lines 533-534, 574-575, 610-611), so no code is hidden today and the green result on the real tree is genuine.
- The other two divergences are emoji surrogate-pair width artifacts of my lexer.

D7's accepted gap (2) says "the comment stripper trusts well-formed Scala (a mis-lexed literal could hide a span)". That framing is inaccurate: the stripper mis-lexes ordinary, well-formed Scala, and the repo already contains the construct. A future direct start in such a span leaves the guard green, so AC3's "fails on any direct embedded-Postgres start" does not hold. This is exactly the Q3 risk raised for this round.

Evidence (all probes, compile status, guard output, stripped text, real-tree comparison): `ref=/home/matt/Development/helio/.concertino/runs/HEL-1445/evidence/.concertino/runs/HEL-1445/evidence/skeptic-final-3-guard-comment-stripper-probe.txt`. `violations` is a pure function, so these results are deterministic. I ran every probe twice: P.scala, then B9.scala as a separate file, with the same result.

**Leftover of an already-reported class (deliberate, non-blocking).** `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().tap(_.start))` compiles and is not flagged, because `chainStart` requires `.start()` with parens. This is the existing "wrapped chain still calls start" class, spelled paren-less via `scala.util.chaining`. It is a deliberate evasion, not an accident.

### Verdict: REFUTE

This is a **new-class** finding: comment-stripper mis-lexing of interpolation splices, introduced in round 3. It is not a leftover of the B1-B6 or rename classes, all of which are closed.

### Change Requests
1. **`EmbeddedPostgresStartGuardSpec.scala:55-87` (`stripComments`): make the stripper splice-aware, or make it fail closed.** Pick one:
   - **(a) Splice-aware.** When a `"` or `"""` is immediately preceded by an identifier character (an interpolator), lex `${` ... `}` as code with brace depth, recursing into nested strings and comments, and treat `$$` as an escape. This is about 20 lines.
   - **(b) Fail closed.** Strip comments only in files with no `${` inside a string (or no string literal inside a splice), and scan any other file unstripped. That stays green today, because its only prose mentions are elsewhere. The executor must confirm this against the real tree.

   Whichever you choose, update D7 gap (2) to state the real boundary.
2. **Red-first cases.** Add the B9/P1/P2/P3 shapes (`"*/*"`, `"**/*.csv"`, `"...//..."` inside a splice, and a `"""..."""` inside a splice followed later by a direct start) to the reject list. Show them red against the current stripper and green after the fix, and record the transcript in `proof/`. Also add an accept case where a splice contains a string followed by a real comment that mentions the class, so the fix does not over-flag.
3. **Real-tree non-vacuity.** Re-run the guard in a fresh sbt JVM, judged by log, and confirm PublicDashboardRoutesSpec still passes under the corrected lexer. Re-run `verify-embedded-postgres-migration.py`. testFull is not needed (guard-only change).

### Non-blocking notes
- Optionally widen `chainStart` (`:42`) to also match a paren-less `.start` that is not followed by `(` or an identifier character, for example `_.start`. Otherwise list it in D7 as an accepted deliberate-evasion residual.
- AC8: the PR body must state that HEL-1470 is fixed by this PR.
- Gate-defect check (CON-160): none of my conclusions rest on mtime ordering. The probes are content-based and deterministic.

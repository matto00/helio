## Skeptic Report — final gate (round 4, skeptic-final-4.md)

I reviewed HEAD `63df5f765b97528080c76f537515c1145a50a7ca`. I resolved the base live with `resolve-review-base.sh` (main/origin, from workflow-state.md) as `5ba82b39f5de50eb414b9f95f4f06bf4b89634cb`, which equals `git merge-base HEAD origin/main`. The change is test-only, so there is no UI and step 4 does not apply.

Evidence for every probe, the compiler cross-check and the sbt run: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1445/evidence/.concertino/runs/HEL-1445/evidence/skeptic-final-4-lexer-probes.txt`.

### What I verified (with evidence)

**Scope.**
- `git diff --name-only e4ed945e8 HEAD` touches only `EmbeddedPostgresStartGuardSpec.scala` and the change dir.
- Against the base, the only changes are under `backend/src/test/scala/**` and the change dir.
- `VerifiedEmbeddedPostgres.scala` has been changed by only one commit, `feaa10b6e`.

**Q1: can the helper hand a test a foreign cluster? No.** I re-read `VerifiedEmbeddedPostgres.scala:44-87`:
- Each attempt creates a fresh unique temp dir and sets it via `setDataDirectory`.
- `pg` is returned only on `Right`, which requires the server-reported `data_directory` to equal that attempt's own `realDir` or `plainDir`.
- Every other outcome, including an observer throw (`NonFatal`), does three things: it closes the instance by its own data dir, deletes the dir, and retries up to the bound. At the bound it throws `IllegalStateException`.
- A foreign postmaster cannot report a dir that was created fresh by this attempt.

**AC2 / C1.** `verify-embedded-postgres-migration.py 5ba82b39f…` against the live merge-base reports:
- `files with builder at base: 221`
- `changed backend files 224 (expected 224 = 221 + 3 new)`
- `base occurrences: 226 wrapped: 226 unwrapped: 0 inserted imports: 221`
- `RESULT: PASS`

**AC5.** `git diff -U0 base...HEAD -- backend` has 0 changed lines matching `ROLE|GRANT|BYPASSRLS|IF NOT EXISTS|REVOKE`. I also checked `SET ROLE`, which `ROLE` covers.

**Commit hygiene.** I checked all 5 branch commits. None matches `claude.ai`, `Claude-Session` or a session link (grep exit 1). The only trailer is `Co-Authored-By`.

**Fresh sbt JVM.** Command: `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly com.helio.testkit.EmbeddedPostgresStartGuardSpec com.helio.testkit.VerifiedEmbeddedPostgresSpec"`. The log shows:
- `loading project definition from …/HEL-1445/backend/project`
- both suite headers and 17 `- should` lines, including all 7 splice cases
- `STATS files-scanned=500 files-with-splice-literals=173 raw-fallback-files=0 offenders=0`
- `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
- `Suites: completed 2, aborted 0` and `Tests: succeeded 17, failed 0`
- zero `TESTS FAILED` / `*** FAILED` / `RUN ABORTED` / `*** ABORTED` lines

The 500 vs 501 difference is explained. The spec excludes the helper. The dump (`proof/c5-whole-tree-dump.txt`, 501 lines) includes it, and also includes the guard spec in its splice count (174 vs 173). The whole-tree claim is consistent.

**Whole-tree lexer correctness, checked against the real Scala scanner (new, independent of the executor's python port).** I ran scalac 2.13.15's own `UnitScanner` over all 501 files under `backend/src/test/scala`. I then checked whether any compiler-visible token starts at a position the guard's `stripComments` blanked:
- Result: `SUMMARY scanned=501 raw=0 tokens=918210 filesWithHiddenTokens=0 scanErrors=0`.
- No length mismatches.
- I validated the method on the probes below: it flags Q1, Q3 and Q5 as hidden and correctly passes Q10.

So the stripper hides no real code anywhere in today's tree. The green result is genuine, and round 3's `PublicDashboardRoutesSpec:514` construct now lexes correctly.

**Red-first.** `proof/c5-guard-red-green.txt` shows the new case red against `e4ed945e8`: `not flagged: slash-star-slash, glob, double slash, paren-less start`, `*** 1 TEST FAILED ***`. It then goes green in a fresh JVM. The other three new cases (triple-quoted, nested splice, char literal) were already flagged by the old guard, so they are guards, not red-first proofs. I also ran a mutation that dropped the splice recursion at `:92`. Under it, "double slash" goes unflagged; three other cases are caught only by the raw fallback; and the triple-quoted and nested-splice cases stay flagged even without recursion. Fail-closed is doing real work here.

**Q2: adversarial lexer probes.** All of these compile with scalac 2.13.15 plus embedded-postgres 2.0.7 (and scala-xml for Q6). I ran each twice with identical results.

| Probe | Construct | Guard |
|---|---|---|
| Q1 | `s"{$"url$": $"http://$u/x$"}"; val pg = EmbeddedPostgres.builder().start()` (the Scala 2.13.6+ `$"` escape) | **`Vector()`**, so the rest of the line is hidden |
| Q3 | `raw"\"(https?://[^\"]+)\"".r; def f() = EmbeddedPostgres.builder().start().close()` | **`Vector()`**, so the rest of the line is hidden |
| Q5 | ``val `a//b` = 1; <direct start>`` (backquoted identifier) | **`Vector()`** |
| Q6 | `val x = <a>http://example.com</a>; <direct start>` (XML literal) | **`Vector()`** |
| Q7 | `def go[B <: { def start(): AnyRef }](b: B) = b.start()`, then `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().tap(go(_)))` | **`Vector()`** |
| Q2, Q11 | `$"` escape opening a `/*` block across lines | raw fallback, flagged |
| Q4, Q12 | raw `\"` opening a `/*` block across lines | flagged / raw fallback |
| Q10 | `s"a\"$h//\""`, `f"…\"//"` (non-raw escapes) | flagged (correct) |
| Q8 | infix `b start ()` | does not compile (not a route) |
| Q9 | `"` as a quote in code | does not compile (not a route) |

Classification of what slips through:
- **Q1 and Q3 are a leftover of round 3's class** ("the stripper mis-lexes well-formed string-literal syntax"), not a new class. The splice part is now correct. Two other escape rules are still wrong:
  - **raw `\"`.** Scala 2.13 lexes `\"` as non-terminating in every single-line interpolation, including `raw`. Q3 compiles and proves it. `string(… raw = true)` at `:90`, called from `:117`, closes the string there instead.
  - **`$"`.** The `$"` escape is not handled at `:91-92`.

  **Reachability: realistic syntax, but a narrow and so far unobserved trigger.** Multi-line hiding fails closed: nested-comment depth plus quote parity drive every block-comment variant I built to the raw fallback (Q2, Q4, Q11, Q12). So the hidden span ends at the end of the line. The guard is bypassed only when a direct start sits on the same line, after such a literal that contains `//`. There are zero instances in the tree: no `$"` escape inside an interpolation, and no `raw"` containing `\"`.
- **Q5 and Q6 are the same leftover class** (code positions the lexer doesn't model: backquoted identifiers and XML text). They need deliberate or very unusual code. There are none in the tree.
- **Q7 is a leftover of the "wrapped builder still starts" class** (round 3's `.tap(_.start)`), via a structurally typed helper. It is deliberate evasion only.

**Q3: is D7 honest? Mostly.**
- Gap 3 ("a lexer defect that the fail-closed fallback cannot see … an input it lexes confidently but wrongly would pass") discloses exactly the class Q1, Q3, Q5 and Q6 fall into. Gap 2's "deliberately obfuscated" covers the spirit of Q7.
- Two statements are inaccurate:
  - The comment-handling paragraph says the lexer handles "`raw"..."` without escapes". That is not Scala 2.13's lexing; it is the bug behind Q3.
  - Gap 3's mitigation, "the guard's own accept and reject cases cover each construct", overclaims. There is no `raw` case and no `$"` case.

  These are factual errors in a disclosure that is otherwise candid. They do not hide a gap: gap 3 still names the class.

**Gate-defect check (CON-160).** No conclusion here rests on mtime ordering. The probes, the compiler cross-check and the sbt log are content-based and deterministic.

### Verdict: CONFIRM

Every AC traces to evidence:
- AC1: helper `:44-87`.
- AC2: the verifier passes.
- AC3: the guard is red-first and green on the real tree, and the compiler cross-check proves no real code is hidden.
- AC4: `VerifiedEmbeddedPostgresSpec`'s 5 cases are green in my run.
- AC5: 0 role/grant lines changed. The RLS mutation is in `proof/5.1`, and the helper and harness are unchanged since then.
- AC6 and AC7: `proof/5.2` and `proof/5.3`. Only the guard spec changed since, and the HEL-1468 files equal the base, so I did not re-run testFull.

Round 3's REFUTE is closed. The splice constructs are lexed correctly, multi-line mis-lexes fail closed, and the whole tree has zero hidden tokens against the real scanner. What remains is end-of-line-scoped and needs either rare escape syntax plus `//` plus a same-line direct start, or deliberate evasion. It sits inside D7's disclosed gap 3. I do not judge it ship-blocking for a test-only backstop guard.

### Non-blocking notes
1. `EmbeddedPostgresStartGuardSpec.scala:90` and `:117`: drop the `raw` exemption from escape handling. Scala 2.13 lexes `\x` as a two-character unit in every single-line interpolated string, `raw` included. Also add `else if (interpolated && c == '$' && i + 1 < n && text.charAt(i + 1) == '"') { emit(); emit() }` beside `:91`. Add Q1 and Q3 as reject cases, and show them red first. Each fix is about one line.
2. design.md D7: correct the "`raw"..."` without escapes" wording. Name the `$"` escape, backquoted identifiers and XML literals as concrete members of gap 3, and soften "cover each construct". Name "a wrapped builder handed to a user function that starts it" (Q7) as an accepted deliberate-evasion residual.
3. The triple-quoted, nested-splice and char-literal cases were never red against the previous guard. Label them as guards, not red-first proofs.
4. AC8: the PR body must say HEL-1470 is fixed by this PR. There is no PR yet.

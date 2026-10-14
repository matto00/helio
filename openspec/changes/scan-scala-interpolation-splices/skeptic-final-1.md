## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `4ce5800260288edffa267ffbcfd2cfb80d8e9d42`. Base `609e62b6d917243355a179fa8a26318c04898c27` was resolved live with `resolve-review-base.sh`, which exited 0. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.

### What I verified (with evidence)

- **Diff scope.** `git diff --stat BASE...HEAD` covers `scripts/check-scala-quality.mjs`, its selftest and the change artifacts. No `backend/` file changed. `git log BASE..HEAD -- .../ShareTokenGenerationSpec.scala` is empty, so that file is untouched. Lines 45 and 56 are still plain `"..."` literals. The full-repo scan is clean, so neither line is flagged.
- **Gate.** I ran `npm run check:scala-quality` from the worktree. It printed `check-scala-quality selftest: 61 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, and exited 0. The 250 warning lines name this worktree's `backend/src` files.
- **AC3 (red first).** I ran the HEAD selftest against the base guard (`git show 609e62b6d:scripts/check-scala-quality.mjs`) in a scratch copy and got `12 failed, 49 passed`. All 9 core splice red cases fail, as do the C1 and C2 green cases and the column case. This matches the evaluator's claim.
- **AC1 and AC2.** Single-line splices are scanned for s, f, raw and custom interpolators, including nested braces, nested literals and `$ident`/`$$`/`$"`. The selftest pins each one. I added my own probes:
  - These are now correctly flagged: `s"${ "a" }${java.util.UUID...}"`, `f"$x%2d ${java.util...}"` and `s"$$${java.util...}"`.
  - `s"${x}" // ${java...}` stays clean.
- **C1, C2, C3.** Each is pinned or documented in the guard header, as the evaluator states. I confirmed them by reading the diff and running the selftest.
- **Robustness.** I ran `codeOnly` over all 152,489 non-comment, non-import lines of real repo Scala. It threw 0 times and changed the length of 0 lines.
- **False positives on real repo Scala.** There are none: the full-tree scan exits 0.
- **Differential false-negative probe.** I appended ` java.time.Instant.now()` to every real repo line and compared the base guard with the HEAD guard.
  - On 1,931 lines, the base guard flags the appended code and HEAD does not.
  - Some of these are correct, because the appended text really is inside an opening `"""` literal.
  - A large class is a **new false negative**: the closing line of a multi-line `"""` literal. HEAD's per-line scanner treats the closing `"""` as an *opening* delimiter and blanks everything after it. That includes the trailing code chain, such as `.as[...]`, `.parseJson.convertTo[...]` and `.stripMargin...`.
  - The base guard checked that code. It happened to do so because of how its regex paired quotes, but the effect was that a real inline FQN there was flagged.
  - The repo has 286 such closer lines with a method chain after them. Most are Slick `sql"""...""".as[T]` lines, for example `ProductUsageRepository.scala:36/43/57/64/74`, `DataSourceRepository.scala:310/966` and `PipelineAutoRunDebounceRepository.scala:111/115`. This is exactly where an inline `.as[java.util.UUID]` or `.as[java.time.Instant]` would be written.
- **CLI reproduction, a second measurement through a different path.** I built a fixture tree with `sql"""SELECT owner_id FROM t\n    WHERE id = $id""".as[java.util.UUID].headOption` and `"""{\n  "a": 1\n}""".parseJson.convertTo[com.helio.domain.Foo]`.
  - Base guard: 2 violations (`A.scala:3:26`, `A.scala:6:26`), exit=1.
  - HEAD guard: `clean`, exit=0.
  - The sha256 of each guard is recorded with the output. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1386/evidence/.skeptic-hel1386-closer-regression.txt`.
- **Spec.** `openspec/specs/scala-inline-fqn-guard/spec.md`, in its first requirement, says the check "SHALL fail on any non-exempt line ... that contains an inline qualified reference". Code after a closing `"""` is not exempt under any listed exemption, so this regression diverges from the live spec.
  - The design's Decision 5 says that blanking the rest of the line after an unclosed `"""` is "today's effective behaviour". That holds for an opening line. It is false for a closing line, and the design gate did not consider closing lines.
  - The new header limit, "text on later lines of a multi-line `"""` block is not tracked across lines", is about text, not code after the closer. So the regression is not disclosed either.

### Verdict: REFUTE

The ticket asks the guard to close one blind spot (`${...}` splices). The change closes it but opens a new blind spot on a more common real pattern: code after a multi-line `"""` closer. The base guard caught that pattern and HEAD does not. I reproduced this deterministically through both `scanScalaText` and the real CLI. A detection guard must not become blind to code that it caught before.

### Change Requests

1. **Restore checking of code after a multi-line `"""` closer** in `scripts/check-scala-quality.mjs` (`codeOnly` / `scanScalaText`, around the per-line loop at the `codeOnly(raw)` call).
   - Preferred fix: carry triple-quote state across lines in `scanScalaText`. Track whether a line ends inside an unclosed `"""` and whether that literal is interpolated. On the next line, start in literal mode, blank until the closing `"""`, then scan the rest as code.
   - This also lets later-line splices in interpolated multi-line literals be scanned. Today those are missed, for example the `|...${...}` lines in `PatchSetStaleCheckRoutesSpec.scala`. Whether to scan them is the executor's call, but the state must not *lose* code that the base guard checked.
   - If cross-line state stays out of scope, use any other approach that makes `    WHERE id = $id""".as[java.util.UUID]` and `}""".parseJson.convertTo[com.helio.domain.Foo]` flag again. Merely documenting the limit is not acceptable, because it is a regression against the live spec.
2. **Add selftest red cases** in `scripts/check-scala-quality.selftest.mjs` for both fixture shapes above, each a multi-line text fed to `hits(...)` and expected to be flagged exactly once.
   - Add a green case where the closing line holds only text before `"""`, for example `  java.time.Instant """.stripMargin`, which must not be flagged.
   - Show the new red cases fail on the current HEAD guard.
3. **Re-run the full-repo scan** and fix any newly flagged sites with imports, per AC4. Then re-run the differential probe: append a code FQN to each line and compare against the base guard. The base-only set should contain only lines where the appended text truly lies inside a literal, such as opening lines of `"""` blocks and the documented `'"'` char-literal limit.
4. **Update the guard header's "Known guard limits"** and design Decision 5 so they describe the behaviour accurately after the fix.

### Non-blocking notes

- The pre-existing `'"'` char-literal limit is wider now. `if (c == '"') java.time.Instant.now()` is flagged by the base guard and clean on HEAD, because the unpaired quote now blanks to end of line. The limit is documented and repo lines of this shape carry no FQN today. Consider pinning it with a selftest case so the behaviour change is deliberate.
- `check-scala-quality.mjs` is at about 252 lines, just over the 250 soft budget. Moving `codeOnly` into its own module would help if CR1 grows it.
- The selftest's CLI spawn still uses a non-splice fixture. A splice or closer fixture in that spawn would pin the CLI path.
- No gate defect: no report I relied on rests on mtime ordering.

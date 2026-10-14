## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `865b5a6f8c33d74f28aac9477ba984c0a436de3a`. The base `609e62b6d917243355a179fa8a26318c04898c27` was resolved live with `resolve-review-base.sh`, which exited 0. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.

### What I verified (with evidence)

- **Diff scope.** `git diff --stat BASE...HEAD` touches only `scripts/check-scala-quality.mjs`, its selftest, the new `scripts/scala-code-only.mjs` and the change artifacts.
  - `git diff --stat BASE...HEAD -- backend` is empty.
  - `git log BASE..HEAD -- .../ShareTokenGenerationSpec.scala` is empty, so that file is untouched.
  - Lines 45 and 56 are still plain `"..."` literals. The full-tree scan is clean, so neither line is flagged.
- **Gate.** I ran `npm run check:scala-quality` from the worktree. It printed `check-scala-quality selftest: 77 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, and exited 0. The warnings name this worktree's `backend/src/...` files, and the guard's default root is `scripts/..` = this worktree.
- **Round-1 CR1 (code after a multi-line closer).** Fixed. Both round-1 fixtures, `...$id""".as[java.util.UUID]` and `}""".parseJson.convertTo[com.helio.domain.Foo]`, are flagged by HEAD and pinned in the selftest (`multiRed`).
- **Selftest is failable.** The executor did not do this, so I mutated scratch copies of the three scripts myself:
  - Splice copying replaced by blanking the splice: `13 failed, 64 passed`.
  - Cross-line `"""` state dropped: `9 failed, 68 passed`.
  - Char-literal skip disabled: `2 failed, 75 passed`.
  - Unmutated copy: `77 passed`.
- **Executor's C4 appended-FQN differential.** I reproduced it independently with my own script. It appends ` ; java.time.Instant.now()` to every non-blank line of the 1,205 `backend/src` files and compares base `scanScalaText` with HEAD `scanScalaText`.
  - Results: base 151,978 flagged lines, HEAD 149,706, baseOnly 2,291, headOnly 19. These match the executor's evidence.
  - For 2,290 of the 2,291 baseOnly lines, HEAD's own state says the line ends inside an open `"""` literal. The remaining line, `EmbeddedPostgresGuardLexer.scala:43`, has the appended text after a trailing `//`, so HEAD is correct there.
  - HEAD's triple state ends closed in all 1,205 files, so there is no state desync on the real tree.
  - **Limit of this probe:** it only tests code at end of line, and the repo has no multi-line `${` splice (`grep -rnE '\$\{[^}]*$'` finds only 2 lines, both `"${"` string literals). So it cannot see the regression below.
- **ACs.**
  - AC1: s/f/raw/custom splices, nested braces and nested literals are scanned on a single line.
  - AC2: there are selftest cases for a splice FQN, for the same text in a plain literal, and for `$ident`/`$$`/`$"`.
  - AC3 (red first): the executor's transcript shows the selftest red on the unmodified guard. Round 1 confirmed this independently.
  - AC4: the tree is clean and no backend file changed.
  - C1, C2 and C3 are pinned in the selftest or documented in the header.
- **New C4 regression, found by fixture probes and reproduced through two paths.**
  - First path: `scanScalaText` on fixtures. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1386/evidence/.concertino/evidence-tmp/HEL-1386-skeptic-final-2-multiline-splice-regression.txt`.
  - Second path: the real CLI on a fixture tree, base script against the worktree script. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1386/evidence/.concertino/evidence-tmp/HEL-1386-skeptic-final-2-cli.txt`.
  - The CLI fixture:
    ```
    2  def q(id: Int) = sql"""SELECT o FROM t WHERE id = ${
    3    java.util.UUID.randomUUID()
    4  }""".as[Int]
    5  val n = s"""a ${s"""b
    6 c"""} d"""
    7  val t = java.time.Instant.now()
    ```
  - Base guard: `A.scala:3:5` and `A.scala:7:11`, exit=1. HEAD guard: `clean`, exit=0.
  - **(a) Multi-line splice inside a multi-line interpolated `"""`.**
    - When a `${` stays open at end of line, `scanLiteral` (`scala-code-only.mjs`, the `${` branch calling `scanCode(true)`) runs off the end. Only `state.triple` survives, so the next line resumes in *literal* mode and the splice's code lines are blanked as text.
    - The base guard flagged line 3. Splice code is exactly what this ticket exists to scan, so this is both a C4 regression and a false negative inside the ticket's own domain.
    - The header's "text lines of a multi-line `"""` are blanked (their splices scanned)" implies this case works. It is not listed as a known limit.
  - **(b) A `"""` literal nested in a splice of an open `"""`, with the inner literal crossing lines.**
    - A resumed `scanLiteral` sets `outer = null` (`const outer = resumed ? null : state.triple`). When the inner literal closes on line 6, the scanner forgets it is still inside the outer literal's splice.
    - The scanner then reads `} d"""` as code, and that `"""` *opens* a phantom literal. Every following line of real code (line 7) is blanked until some later `"""`.
    - This can silence an arbitrary stretch of a file. The base guard flagged line 7.
  - Neither shape exists in the repo today, so this does not affect the current clean result. It is still a stable, reproduced violation of standing constraint C4: "any line the base guard flagged must still be flagged". Round 1 set the standard that this guard must not become blind to code the base guard caught.
- **Other edge probes (no regression).** HEAD and the base guard both flag code after each of these:
  - an empty string, an escaped-backslash literal, `\"\"\"` inside a single-quoted string, a `'A'` char, type params, a symbol-ish `'abc` token
  - an unterminated single-line literal or splice continuing on the next line
  - two triples on one line, and a closer followed by a new single-line literal
  - a `//` inside an opener line
- **Gate defect check.** No report I relied on rests on mtime ordering. All my claims are from content and re-run output.

### Verdict: REFUTE

The round-1 regression is fixed and the main path is sound. However, the new cross-line state introduces two further reproducible blind spots where the base guard flagged and HEAD does not, which violates C4. One of them, (b), desyncs and silences ordinary code on later lines. The fix is small and local to `scala-code-only.mjs`.

### Change Requests

1. **Carry open-splice state across lines** in `scripts/scala-code-only.mjs`.
   - When a line ends inside a `${` splice of an open triple literal, persist that fact in `state`, e.g. `state.triple = { interpolated, spliceDepth }`.
   - The next line must then resume in `scanCode(true)` (code) mode at the saved brace depth, not in literal mode. After the splice's closing `}`, return to literal mode for the outer `"""`.
   - Target: line 3 of the CLI fixture above (`java.util.UUID.randomUUID()` inside a `sql"""... ${` / `}"""` splice) is flagged.
2. **Restore the outer literal when a nested `"""` closes on a resumed line.** Today `const outer = resumed ? null : state.triple` loses the enclosing literal and splice.
   - Model the open state as a small stack (outer literal, then splice, then inner literal), so that closing the inner literal returns to the outer splice and `} d"""` closes the outer literal instead of opening a phantom one.
   - Target: line 7 of the CLI fixture (`val t = java.time.Instant.now()` after `s"""a ${s"""b` / `c"""} d"""`) is flagged.
3. **Selftest.** Add both fixtures to `multiRed` in `scripts/check-scala-quality.selftest.mjs`, each expected to be flagged exactly once.
   - Add a green case: a multi-line splice whose code lines hold no FQN, followed by text on the closing line, e.g. `s"""a ${\n  x\n} java.time.Instant"""`. It must stay unflagged.
   - Show the new red cases fail on the current HEAD (`865b5a6f8`).
4. **Keep the docs accurate.**
   - Update the guard header's "Known guard limits" so it matches the result.
   - Update `design.md` so it is internally consistent. Line 14 still lists "multi-line `"""` state across lines" and the "pinned `'"'` char-literal limit (its selftest pin stays as is)" as Non-Goals. Decision 10 still says the header "keeps the `'"'` and multi-line `"""` limits". Both contradict Decision 5 and the shipped code.
5. **Re-run** the full-tree scan and the executor's appended-FQN differential, and save the new transcripts.

### Non-blocking notes

- There is no `evaluation-2.md` in the change dir. Only `evaluation-1.md`, which covers 4ce580026, is present, so I could not read a round-2 evaluator PASS for 865b5a6f8. The orchestrator should confirm the evaluator actually ran on this HEAD.
- The selftest's single CLI spawn still uses a non-splice fixture. A splice or closer fixture there would pin the CLI path end to end.
- The comment on line 11 of `scala-code-only.mjs` is over 100 columns. That is cosmetic.

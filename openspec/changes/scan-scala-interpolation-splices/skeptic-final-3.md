## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `b44bbaacc05072df1a653b61892a099d6ceccf58`. The base `609e62b6d917243355a179fa8a26318c04898c27` was resolved live with `resolve-review-base.sh`, which exited 0. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.

### What I verified (with evidence)

- **Diff scope.**
  - `git diff --stat BASE...HEAD` touches only `scripts/check-scala-quality.mjs`, `scripts/scala-code-only.mjs`, the selftest and the change artifacts.
  - `git diff --stat BASE...HEAD -- backend` is empty, and `git log BASE..HEAD -- backend` shows 0 commits.
- **ShareTokenGenerationSpec.**
  - The file is untouched, and `scanScalaText` on it returns `[]`.
  - `:45` and `:56` are still plain `"..."` literals that mention `scala.util.Random`.
- **Gate.** I ran `npm run check:scala-quality` in the worktree. It printed `check-scala-quality selftest: 82 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, and exited 0. The warnings name this worktree's `backend/src/...` files.
- **Round-1 and round-2 findings are fixed.** I ran the base CLI and the HEAD CLI on one fixture tree. The fixture combined:
  - the round-2 multi-line splice and the nested crossing `"""`
  - the round-1 `$id""".as[java.util.UUID]` and `}""".parseJson.convertTo[com.helio.domain.Foo]` closers

  Both guards reported the same 4 violations (`A.scala:3:5`, `7:11`, `9:26`, `12:26`) and exited 1. sha256 of the HEAD scripts: check-scala-quality `ef50786b…`, scala-code-only `34fef1aa…`. Both match the worktree.
- **The selftest is still failable.** I mutated scratch copies, changing one line each time:
  - Splice push removed: `15 failed, 67 passed`.
  - Cross-line stack dropped: `9 failed, 73 passed`.
  - Char-literal skip disabled: `2 failed, 80 passed`.
  - Unmutated copy: `82 passed`.
- **ACs.**
  - AC1: splices are scanned for s, f, raw and custom interpolators, with nested braces and nested literals, on one line and across lines.
  - AC2: there are selftest cases for a splice FQN, a plain-literal lookalike (`:103`), `$ident` (`:91`, `:104`) and `$$` (`:105`).
  - AC3: red-first transcripts exist from round 1 (independently reproduced then) and from cycle 3 (`HEL-1386-cycle3-red-on-865b5a6f8.txt`).
  - AC4: the tree is clean, and no new violations needed fixing.
- **C1-C3.** These are pinned in the selftest or documented in the header.
- **Executor differential (claim).** `HEL-1386-cycle3-c4-differential.txt` reports 1 unexplained base-only line, `EmbeddedPostgresGuardLexer.scala:43`. Its appended text lands after a trailing `//` comment, so HEAD is correct there; this matches round 2's independent finding. The differential only appends code at the end of real lines. The repo has no mid-line unclosed `/*` and no `*/ code` line, so it cannot see the regression below.
- **My own adversarial probes.** I compared base and HEAD `scanScalaText` on 38 shapes (ref below).
  - Most shapes are the same on both guards, including char literals (`'\\'`, `'\''`, `'"'`, `'"'`), `$"`, symbols, XML, comment-in-splice, `import`/`*`/`/*` lines inside a triple, braces in strings and chars inside splices, and unclosed splices.
  - Several base-only results are correct HEAD behaviour or need input that does not compile:
    - `"""""` opener: the text really is inside the literal, so HEAD is right.
    - `raw"a\"…`: the literal is unterminated, so the line does not compile.
    - A backtick identifier containing `"`: this is contrived.
- **New C4 regression: a `"""` that only a comment contains desyncs the cross-line literal state and silences the rest of the file.** I reproduced it through two paths: `scanScalaText` probes and the real CLI on a fixture tree.
  - Fixture B: a mid-line block comment that holds a `"""`.
    ```
    2  val limit = 10 /* the query below used to embed a
    3     raw """ block; see HEL-0 */
    4  def a = java.time.Instant.now()
    5  def b = java.util.UUID.randomUUID()
    6  def c = com.helio.domain.PanelId("x")
    ```
  - Fixture C: a line that closes a block comment and then opens a `"""`.
    ```
    2  /* a multi-line
    3     comment */ val s = """
    4  text
    5  """
    6  def a = java.time.Instant.now()
    7  def b = java.util.UUID.randomUUID()
    ```
  - Base CLI: 5 violations (`B.scala:4:11`, `5:11`, `6:11`, `C.scala:6:11`, `7:11`), exit=1. HEAD CLI: `clean`, exit=0.
  - Mechanism for B: `scanScalaText` only treats a block comment as a comment when the line *starts* with `/*`. So line 3, the inside of a mid-line `/*`, goes to `codeOnly`, and its `"""` pushes a literal frame.
  - Mechanism for C: the comment-closing line is skipped whole (`inBlockComment` → `continue`), so its real opener is never seen, and the real closer on line 5 *opens* a phantom literal.
  - In both cases every following code line is blanked until some later `"""`, which can be the end of the file.
  - The base guard had no cross-line state, so it flagged all of these lines. This is the same failure class round 2 refuted in its finding (b): a phantom `"""` that silences arbitrary later code.
  - The header lists "a mid-line unclosed `/*` or a `"""` opened after a line-leading `/* ... */` is not tracked". That covers B and the `/* a */ val s = """` variant (also base-only in my probes). It does not cover C (`*/ val s = """`), and it does not disclose the consequence, which is that the rest of the file goes silent. Round 1 established that documenting a regression against the live spec does not satisfy it. C4 is literal: "any line the base guard flagged must still be flagged".
  - The repo has none of these shapes today (`grep` found no mid-line unclosed `/*` and no comment-closing line followed by code), so the current clean result is unaffected. The guard exists to catch future code.
  - Evidence (CLI transcript + fixtures + probe output, sha256 of the scripts): `/home/matt/Development/helio/.concertino/runs/HEL-1386/evidence/.skeptic-tmp/HEL-1386-skeptic-final-3-comment-desync.txt`. Probe script: `/home/matt/Development/helio/.concertino/runs/HEL-1386/evidence/.skeptic-tmp/HEL-1386-skeptic-final-3-probe.mjs.txt`.
- **Gate defect check.** No report I relied on rests on mtime ordering. Every claim here comes from content or from re-run output.

### Verdict: REFUTE

Both earlier findings are fixed, the ACs are met, and the selftest is failable. However, the cross-line literal state can still be desynced by a `"""` that sits in, or next to, a block comment that `scanScalaText` does not model. The result is a rest-of-file blind spot on code the base guard flagged. I reproduced it through both paths and it is stable. It violates C4, and one trigger (C) is not even disclosed. The fix is local.

### Change Requests

1. **Move block-comment tracking into the shared scanner state** so comment text can never push a literal frame.
   - In `scripts/scala-code-only.mjs` `scanCodeChar`'s `/*` branch, push a `{ kind: "comment" }` frame when `*/` is not found on the line. Do not just set `i = n`.
   - In the main loop, a `comment` top frame skips to `*/` and pops the frame.
   - In `scripts/check-scala-quality.mjs` `scanScalaText` (the `inBlockComment` / `line.startsWith("/*")` block, around lines 98-108), stop `continue`-ing lines that contain code after `*/`. Either let `codeOnly` own all block-comment state, or feed the text after the `*/` (blanked up to it, so length is preserved) to `codeOnly`. Then an opener like `*/ val s = """` or `/* a */ val s = """` is seen.
   - Targets: fixtures B and C above flag the same lines as the base guard (`B:4,5,6`, `C:6,7`).
2. **Selftest.** Add fixtures B and C, plus the `/* a */ val s = """` variant, to `multiRed`, each expecting exactly the base guard's lines.
   - Add a green case: a mid-line `/*` comment spanning lines that contains `java.time.Instant` text. It must stay unflagged.
   - Show the new reds fail on `b44bbaacc`.
3. **Header and design.** Remove or reword the "mid-line unclosed `/*` … not tracked" limit in `scripts/check-scala-quality.mjs` lines 19-21 so it matches the fix. Keep `design.md` consistent with it.
4. **Re-run** the full-tree scan (it must stay clean) and the C4 differential, and save the transcripts.

### Non-blocking notes

- A backtick identifier that contains `"` (`` val `a"b` = … ``) opens a phantom literal on HEAD. This is single-line only, because the frame is cut at end of line, and the input is contrived. Consider skipping backtick identifiers in `scanCodeChar` while you are in there.
- `importInsideSplice` is head-only: an `import x.y.Z` line inside a multi-line splice is now flagged, which the base guard skipped. It is harmless and arguably correct.
- I found no evaluator report for b44bbaacc in the change dir (only `evaluation-1.md`). The orchestrator should confirm that an evaluator PASS exists for this HEAD.

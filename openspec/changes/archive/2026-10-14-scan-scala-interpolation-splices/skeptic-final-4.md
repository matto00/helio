## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD `f843a9d331d840b57c1df63fdc5fdb3d81a1a3a5` on `task/scala-guard-interpolation-splices/HEL-1386`.
I started cold. Every claim below comes from my own commands, run in this worktree. My probe harnesses live in the session
scratchpad (`base.mjs`, `inject.mjs`, `recall.mjs`, `fuzz.mjs`, `hand.mjs`, mutation copies `mut1..mut5`). None of them
were written into the worktree.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.
- **Review base.** `resolve-review-base.sh` resolved to `609e62b6d917243355a179fa8a26318c04898c27` with exit 0. This is
  also `git merge-base HEAD origin/main`. The diff `609e62b6d...HEAD` covers 5 commits and touches three scripts plus the
  change dir. `backend/` is untouched (`git diff --stat 609e62b6d HEAD -- backend/` is empty).
- **Pass 1 is base's code.** I extracted base `scanScalaText` (from `git show 609e62b6d:scripts/check-scala-quality.mjs`)
  and HEAD `scanBase` with awk and diffed them. The only difference is the signature line
  (`export function scanScalaText` became `function scanBase`). The bodies are byte-identical. HEAD's `scanScalaText`
  starts from pass 1's full `hardErrors`/`softWarnings`. It only appends pass-2 errors for lines that are not already
  flagged, then sorts by line. Base emits at most one error per line, so line-keyed dedupe drops nothing. Superset holds
  by construction.
- **Superset, measured.** Every probe below reports `lost=0`, meaning no base error string is missing from HEAD's output.
  The real-corpus mutations ran over all 1205 `.scala` files:
  - FQN injected after every `//` and `/*`: base 0 findings, pass-2-only 0.
  - FQN injected after every `"` that is followed by a letter or space: base 17781 findings, lost 0, pass-2-only 10. I
    inspected all 10. Each one is an injection that landed after a closing quote inside a real `${...}` splice, for
    example `${if (url.contains('?')) "&"java.time.Instant else "?"}`. That is code, so these are true positives.
  - `$ident` mutation (`$x` became `$java.time.Instantx`): base 1192 findings, lost 0, pass-2-only 0.
  - A grammar fuzzer generated 100,000 valid-ish programs (seeds 1-4, 25k each). FQNs appear only in plain-string text,
    triple-quoted text (multi-line), `$ident`, `$$`, `$"`, `//` and `/* */` comments (multi-line), with nested splices,
    nested braces, nested literals and char literals `'}'`, `'"'`, `'{'`, `'\n'`. Result: crash 0, lost 0, pass-2
    additions 0. My first two generator versions produced invalid Scala, for example `${...}` inside interpolated text,
    `"""` runs inside triple text, and nested `/*` in comments. I fixed the generator before reading any result, and the
    earlier "FP" hits were all traced to it.
- **Recall (the ticket's actual bug).** For each of the 2131 real-repo lines holding an interpolated `${`, I injected
  `java.time.Instant.EPOCH;` at the splice start. HEAD flags 2130 of them. The one miss is a scaladoc comment line in
  `EmbeddedPostgresGuardLexer.scala:9`, which is correctly exempt. Base flags 88 of them, which confirms the blind spot.
  In positive fuzz mode (FQN placed only in splice code, including nested braces and multi-line splices), across 3 seeds
  and 799 placements, 0 were missed.
- **ShareTokenGenerationSpec.** `git diff --quiet 609e62b6d HEAD -- .../ShareTokenGenerationSpec.scala` succeeded
  (untouched). `:45` and `:56` are plain `"..."` literals. `scanScalaText` on the real file returns `[]` on both HEAD and
  base.
- **ACs.**
  - Splice code is scanned (`scripts/scala-code-only.mjs` `stepLiteral` pushes a splice frame on `${`, and `stepCode`
    keeps splice chars).
  - Nested braces are tracked through `top.depth++/--`, and only `}` at depth 0 pops. The selftest case
    `s"${xs.map { x => 1 }.map(_ => java.util.UUID.randomUUID())}"` is red under a depth mutation.
  - Plain strings stay ignored: a non-interpolated `"` pushes `interpolated:false`, so it never opens a splice.
  - `$ident`: literal text is never kept. A mutation that keeps `$ident` as code turns the selftest red.
  - Red-first: I ran HEAD's selftest against base's guard. It exits 1 with `13 failed, 82 passed`, and all 13 failures
    are splice cases.
  - Existing violations: none. The whole-repo scan on HEAD is `clean`, exit 0.
- **Selftest can still fail.** These are mutations in scratch copies, never in the worktree. Each exits 1:
  - pass 2 removed from the union: 13 failed
  - brace depth not tracked: 1 failed (nested-brace case)
  - every literal treated as interpolated: 2 failed (plain `${}` lookalikes)
  - `/*` comment frames removed: 3 failed (comment-held splice FQNs)
  - `$ident` kept as code: 1 failed
- **Gates, run fresh in this worktree.**
  - `node scripts/check-scala-quality.selftest.mjs`: `95 passed`, exit 0.
  - `node scripts/check-scala-quality.mjs`: `clean (250 soft warning(s))`, exit 0, over 1205 files (`find backend/src -name '*.scala' | wc -l`).
  - `npm run check:scala-quality`: both steps, exit 0.
  - `npm run check:openspec`: `openspec/ is clean`, exit 0.
  - `openspec validate scan-scala-interpolation-splices --strict`: valid.
  - prettier `--check` on the 3 scripts and the change docs: clean.
  - No `concertino.config.json` gate matches `scripts/**` or `openspec/**`. All five gates are `frontend/**` or `backend/**`.
- **No crashes.** These inputs all return without throwing:
  - empty input, `s"$`
  - unterminated literals and splices
  - 5000-deep nested `${`
  - CRLF input
  - a backtick identifier containing `"`
  - 5 lines with 200k-char splice strings (62 ms)
  - the 100k fuzz programs

  The whole-tree scan takes 0.7 s, against 0.07 s for base. That is acceptable for pre-commit.
- **Docs match the code.**
  - design Decisions 1-9 describe the union, the same-length splice view, column sourcing, `id"` detection, the
    cross-line stack with comment frames, the 4+-quote closer and char-literal skipping. The code matches all of these.
  - spec delta: "splice scan SHALL never add a finding on string text" and "previous detection's reports remain" match
    the probes. Its scenario "an inner `"""` text line stays flagged" was verified on both base and HEAD (`2:5`).
  - tasks C1-C5 are reflected in the selftest pins.
  - The fixtures from the skeptic-final-3 change requests (B, C, the `/* a */ val s = """` variant) are pinned in
    `desync` with base's exact lines and pass.

### Verdict: CONFIRM

### Non-blocking notes

- **Nested block comments are a pass-2 false positive on comment text. It is undocumented.** Scala block comments nest.
  Pass 2's comment frame pops at the first `*/`, so this:

  ```
  /* a /* b */ s"${java.util.UUID.randomUUID()}" */
  ```

  is flagged by HEAD at `1:18` and not by base (base skips the line because it starts with `/*` and contains `*/`). The
  multi-line form (`/* outer` / `/* inner */` / `s"${java.util.UUID...}"` / `*/`) is flagged at `3:6` by HEAD only.
  Strictly, this is pass 2 adding a finding inside a comment.

  I did not REFUTE on it, for four reasons:
  1. Zero nested block comments exist in the 1205-file tree. The only `/*…/*` hit is inside a string literal in
     `EmbeddedPostgresGuardLexerSpec.scala:61`.
  2. The base guard already mis-models nested comments the same way for bare FQNs. Its `inBlockComment` also ends at the
     first `*/`.
  3. It fails loud (a blocked commit with a pointed message), not silently.
  4. The owner's C5 bar allows pass 2 to stay imperfect on exotic shapes.

  Suggested follow-up: add "nested `/* /* */ */` block comments" to the pass-2 limits in the header of
  `scripts/check-scala-quality.mjs` and `scala-code-only.mjs`, and to design Decision 5. Those currently say the pass-2
  limits "can only lose splice findings", but this one adds one. Alternatively, make the comment frame count depth.
- `s"${foo("java.util.UUID")}"` is flagged by both HEAD and base. This is a pass-1 inherited false positive: base's regex
  blanking pairs the quotes wrongly. It is consistent with "pass 1 byte-identical" and is not a pass-2 addition.
- `evaluation-3.md` is untracked in the change dir. The orchestrator should commit it with the delivery artifacts.
- No mtime-ordering evidence was relied on. All claims rest on content diffs, exit codes and counts.

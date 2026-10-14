## Evaluation Report — Cycle 2 (evaluation-2.md)

This review covers HEAD `1dec9bee13567c4d250d965cd5c800694abd65c5`, against base `609e62b6d917243355a179fa8a26318c04898c27`. I resolved the base live with `resolve-review-base.sh`, which exited 0. The worktree is clean (`git status --short` prints nothing).

I wrote every scratch copy and probe under
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/c2/`. I did not write anything in the worktree except this report.

### What I verified independently (all green)

**Pass 1 is byte-identical to base.**
- I extracted the body of base `scanScalaText` from `git show 609e62b6d:scripts/check-scala-quality.mjs` and the body of HEAD `scanBase`, and ran `diff` on them. It printed `BODY_IDENTICAL` (50 lines each).
- Outside that body, the only non-comment changes in the file are three additions: the `scala-code-only.mjs` import, `scanSplices`, and the union `scanScalaText`.
- `FQN_PREFIXES`, the regex, the walker and `main` are unchanged.

**HEAD is a superset of base, with zero exceptions.** I checked this with my own differential on HEAD, using base `scanScalaText` against HEAD `scanScalaText`. It ran over 1209 backend `.scala` files and printed `worktree=/home/matt/Development/helio/.claude/worktrees/task/scala-guard-interpolation-splices/HEL-1386`.

| Run | Base flagged | HEAD flagged | Base-only | HEAD-only |
| --- | --- | --- | --- | --- |
| As-is | 0 | 0 | 0 | 0 |
| Probe appended to every line | 180532 | 180532 | 0 | 0 |
| Probe prepended to every line | 232464 | 232464 | 0 | 0 |
| Probe line inserted after every line | 214094 | 214094 | 0 | 0 |
| Every second line probe sits behind `//` | 89677 | 89677 | 0 | 0 |
| Single injection, one line at a time | 180532 | 180532 | 0 | 0 |

- The single-injection run was the append mode: 232464 separate injections, each a whole-file rescan.
- In that run there were no HEAD-only lines anywhere, on probe lines or other lines.
- Its insert-after and prepend modes were stopped for runtime after the append mode finished. The all-lines variants above cover both shapes.
- Pass 2 alone over the real tree flags 0 lines. That run scanned 79162 `id"` occurrences.

**ShareTokenGenerationSpec.scala is untouched and unflagged.**
- `git log 609e62b6d..HEAD -- <file>` is empty.
- Lines `:45` and `:56` give `[]` on base, on HEAD and on pass 2.
- `git diff --stat 609e62b6d HEAD -- backend frontend` is empty.

**Gate.** `npm run check:scala-quality`, run in this worktree, printed `check-scala-quality selftest: 89 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, and exited 0. Prettier `--check` and `eslint --max-warnings=0` both pass on the three scripts and the change directory. `npx openspec validate scan-scala-interpolation-splices --strict` printed `Change 'scan-scala-interpolation-splices' is valid`.

**Red-first.**
- **New selftest against the base guard** (HEAD's `scala-code-only.mjs` present only for its direct pins): `12 failed, 77 passed`, exit 1. The failures are the s, f, raw and custom splices, nested braces, nested string, string-with-brace, single-line `"""`, splice after `$ident`, the column case, the splice after a nested crossing literal, and the char-literal brace in a splice. That is the AC's red-first, against the actual pre-change guard.
- **New selftest against `b44bbaacc`** (old `codeOnly` aliased as `spliceCodeOnly`): `6 failed, 83 passed`, exit 1. Fixtures B (`got [] want [3,4,5]`), C (`got [] want [5,6]`) and the `/* a */ val s = """` variant (`got [] want [4,5]`) cover the skeptic round-3 shapes. Both runs match the executor's cycle-4 transcripts line for line.

**Executor's mutations reproduced.** Each made the selftest fail:

| Mutation | Result |
| --- | --- |
| Pass 1 only | `12 failed` |
| Pass 2 only | `32 failed` |
| Cross-line state removed (`newScanState()` per line) | `1 failed` |
| Char-literal skip disabled | `1 failed` |
| `interpolated` forced true | `2 failed` |

### Phase 1: Spec Review — FAIL

1. **The spec delta contradicts the implemented and pinned behaviour.**
   - `specs/scala-inline-fqn-guard/spec.md` (the MODIFIED "Inline-FQN guard exemptions" requirement) says: "The check SHALL NOT report … plain text inside double-quoted string literals (including the text portions of interpolated literals, `$$` escapes, and a `$ident` reference together with any text following it)".
   - Under C5, pass 1 is the base guard, and it does report some plain text:
     - inner text lines of a multi-line `"""` literal;
     - text after a `$"` escape.
   - The selftest now pins both of these as flagged: `pass 1 keeps flagging an FQN on an inner text line (base behaviour)` and `pass 1 keeps flagging an escaped $" quote then text (base behaviour)`.
   - design.md Decision 6 and the proposal's Non-goals disclose this. The normative spec text still says SHALL NOT, so the spec and the selftest assert opposite things.
   - `openspec validate` passes because it checks structure, not truth.
2. **tasks.md still describes the replaced design.**
   - Task 2.1 says "length-preserving **per-line** code-only scanner … per design Decisions 1-7". The scanner is now a cross-line pass-2 engine, and the Decisions were renumbered in the reframe.
   - Task 2.2 ("column from the match index in the code-only string") is true only for pass-2-only hits. Pass 1 keeps base's `raw.indexOf` column.
   - Standing constraint C1 carries no "(under C5 …)" note, though C3 got one. At whole-guard level C1's literal wording ("`$"` is string text") no longer holds; only pass 2 honours it.
3. **Standing constraints.**
   - C2, C4 and C5 are honoured.
   - C3 is superseded, and the supersession is recorded.
   - C1 is honoured in code (`scala-code-only.mjs:48`), but its required pin is not failable. See Phase 2, item 1.

### Phase 2: Code Review — FAIL

Three pins pass whether or not the code they claim to pin exists. I mutated scratch copies of HEAD, one line each, and the full selftest stayed at `89 passed`, exit 0, in every case:

1. **C1 pin is vacuous.**
   - Mutation: `scala-code-only.mjs:48`, remove `|| next === '"'`, so `$"` is no longer treated as text.
   - Result: still `89 passed`.
   - Why: the pin `pass 2 is silent on an escaped $" quote then text (C1)` uses `s"a$"java.time.Instant$"b"`. After the misread, the FQN is ordinary code, and pass 2 never keeps ordinary code, so the pin passes either way.
   - A discriminating case: `pass2Findings('s"a$" ${java.util.UUID.randomUUID()}"')` must have length 1. On HEAD it is 1; with the mutation it is 0.
   - It must be a pass-2-level assertion. Base pass 1 flags that line anyway (`1:9`), which hides the difference at whole-guard level.
2. **Nested-brace handling (AC1) is not pinned.**
   - Mutation: `scala-code-only.mjs:83`, `if (c === "{") top.depth++;` changed to a no-op.
   - Result: still `89 passed`.
   - Why: both nested-brace fixtures (selftest `a nested-brace splice` and the spec scenario) put the FQN before the inner `}`, so closing the splice early changes nothing.
   - This is a real false negative: `s"${xs.map { x => 1 }.map(_ => java.util.UUID.randomUUID())}"` is flagged by HEAD (`1:32`), but by neither the mutant nor base.
3. **Comment frames are not pinned, and they are what keeps pass 2 inside the comment exemption.**
   - Mutation: `scala-code-only.mjs:70-72`, `/*` changed to `i = n` with no frame pushed.
   - Result: still `89 passed`.
   - The mutant then flags commented-out splices that base and HEAD both leave alone, which the spec exemption forbids:
     - `/* old:\n   val x = s"${java.util.UUID.randomUUID()}"\n*/` is reported at `2:16`;
     - a scaladoc line ` * e.g. s"${java.util.UUID.randomUUID()}"` is reported at `2:13`.
   - The existing green `pass 2 is silent on a mid-line block comment holding an FQN` uses bare text with no splice, so it cannot see this.

Everything else in the code is sound:
- the union is correct and pass 1 wins on duplicate lines;
- `scanBase` is a pure rename;
- `scala-code-only.mjs` is small and has no dependencies;
- file sizes are 218 and 113 lines, both within budget;
- I found no dead imports.

### Phase 3: UI Review — N/A
No UI-trigger paths changed. The spec delta is under `openspec/changes/`, not `openspec/specs/`.

### Overall: FAIL

### Change Requests
1. **Fix the MODIFIED requirement text** in `openspec/changes/scan-scala-interpolation-splices/specs/scala-inline-fqn-guard/spec.md` so it matches C5.
   - Add a sentence such as: "Lines the previous string-blanking detection reports are still reported (it matches each line of a multi-line `"""` literal, and text after a `$"` escape, as code); the splice scan never adds a finding on string text."
   - Add a scenario pinning one of those inherited reports, so the spec and `pass 1 keeps flagging …` agree.
   - Re-run `openspec validate --strict`.
2. **Make the C1 pin failable.** In `scripts/check-scala-quality.selftest.mjs`, near the `pass2Silent` block, add a pass-2-level red assertion: `pass2Findings('s"a$" ${java.util.UUID.randomUUID()}"').length === 1`. Show it fails with `|| next === '"'` removed at `scala-code-only.mjs:48`.
3. **Pin nested-brace depth.**
   - Add `'s"${xs.map { x => 1 }.map(_ => java.util.UUID.randomUUID())}"'` to `spliceRed`, expecting exactly one hit.
   - Optionally change the spec scenario the same way, so the FQN sits after an inner `}`.
   - Show it fails with `top.depth++` at `scala-code-only.mjs:83` removed.
4. **Pin the comment frames.**
   - Add green whole-guard cases: a multi-line `/* … */` block that holds `s"${java.util.UUID.randomUUID()}"` on an inner line, and a `/** … */` scaladoc ` * e.g. s"${java.util.UUID.randomUUID()}"` line.
   - Show they fail when the `/*` branch at `scala-code-only.mjs:70-72` stops pushing the comment frame.
5. **Update tasks.md.**
   - Re-word 2.1 and 2.2 to describe the two-pass design (pass 2 cross-line splice view; pass 1 column unchanged).
   - Annotate C1 as "(under C5: honoured by pass 2; pass 1 inherits base's `$"` false positive)", the way C3 is annotated.
6. **Save the mutation transcripts** for items 2-4.

### Non-blocking Suggestions
- The `$ident` identifier-skip loop at `scala-code-only.mjs:55` has no effect. Pass 2 never keeps literal text, so deleting it leaves the selftest unchanged (`89 passed`), and I could not construct an input where it matters. Consider removing it, or say why it stays.
- The 4+-quote run handling at `scala-code-only.mjs:39` is also unpinned: removing it leaves `89 passed`. Its only effect is lost pass-2 findings that base usually masks. A pass-2-level pin would be cheap, for example `pass2Findings('val s = """a""""; val x = s"${java.util.UUID.randomUUID()}"')`.
- An `import` line inside a multi-line splice is now flagged (HEAD-only, `2:8`). It is legal Scala and arguably correct; noting it for the record.

### Critical Path (cycle 2 of 3)
1. CR1, the spec text, is the only spec-divergence. It is a wording fix.
2. CR2-CR4 are three one-line selftest additions, each with a one-line mutation to show red.

The design itself (C5 union, pass 1 byte-identical, superset with zero exceptions) is verified sound. Nothing in the guard logic needs to change. If cycle 3 is spent on this, the recommendation to the human is to accept once CR1-CR5 land.

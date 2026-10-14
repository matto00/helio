## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `f843a9d331d840b57c1df63fdc5fdb3d81a1a3a5` against base `609e62b6d917243355a179fa8a26318c04898c27`, with the base resolved live. The delta since cycle 2 (`1dec9bee1..HEAD`) touches four files: the spec delta, `tasks.md`, the selftest, and `scripts/scala-code-only.mjs` (the `$ident` loop is removed and its comment updated). `scripts/check-scala-quality.mjs`, which holds pass 1 and the union, is unchanged since 1dec9bee1. In cycle 2 I verified that `scanBase` there is byte-identical in body to base `scanScalaText`.

Scratch work is under `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/c3/` (and `c2/`).

### Phase 1: Spec Review — PASS
- **CR1 (spec wording).** The MODIFIED exemption requirement now matches the code:
  - It now states that "the splice scan SHALL never add a finding on string text".
  - It states that lines the previous detection reports (multi-line `"""` inner lines, and text after `$"`) remain reported.
  - A new scenario, "A report of the previous detection is kept", pins this. It agrees with the selftest's `pass 1 keeps flagging …` cases.
  - The nested-brace scenario now puts the FQN after an inner `}`.
  - `npx openspec validate scan-scala-interpolation-splices --strict` prints `Change 'scan-scala-interpolation-splices' is valid`.
- **CR5 (tasks.md).**
  - Task 2.1 now describes pass 1 `scanBase` plus the cross-line pass 2, unioned per line.
  - Task 2.2 now describes the column (pass 1 `indexOf` wins; otherwise the pass-2 match index).
  - C1 carries an "(Under C5: …)" note, in the same style as C3.
- **Standing constraints.**
  - C1: pinned failably at pass-2 level (below).
  - C2: pinned.
  - C3: superseded and recorded.
  - C4/C5: HEAD flags a superset of what base flags, with zero exceptions (below).
- **ShareTokenGenerationSpec.scala.** No backend commits since base (`git log 609e62b6d..HEAD -- backend` gives 0), so the file is untouched. It is unflagged: the as-is scan is clean.
- **Red-first still holds against the base guard.** The HEAD selftest over the base 609e62b6d guard gives `13 failed, 82 passed`. That is the original 12 failures plus the new inner-brace case.

### Phase 2: Code Review — PASS
- **Gate.** `npm run check:scala-quality` was run from `/home/matt/Development/helio/.claude/worktrees/task/scala-guard-interpolation-splices/HEL-1386`. Output: `check-scala-quality selftest: 95 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, exit 0. Prettier `--check` passes on `scripts/` and the change dir. `eslint --max-warnings=0` on the three scripts exits 0.
- **CR2–CR4 and the new 4-quote pin.** I ran my own mutations on scratch copies of HEAD, one line each. Every one now turns the selftest red:

  | Mutation | Selftest result | Failing case |
  | --- | --- | --- |
  | `$"` handling removed (`scala-code-only.mjs:48`, CR2) | `1 failed, 94 passed`, exit 1 | `pass 2 reads `$"` as text, so a later splice FQN is still found (C1)` |
  | `top.depth++` made a no-op (CR3) | `1 failed, 94 passed`, exit 1 | `flags a splice whose FQN follows an inner closing brace` |
  | `/*` no longer pushes a comment frame (CR4) | `2 failed, 93 passed`, exit 1 | multi-line block comment at `2:16` and scaladoc at `2:13` (both flagged, as predicted in cycle 2) |
  | 4+-quote run loop removed (the 4-quote pin; this mutation was not tested by the executor) | `1 failed, 94 passed`, exit 1 | `pass 2 closes a 4-quote triple literal at its last three quotes` |

  I also re-ran two earlier mutations as a regression check:
  - pass 1 only: `13 failed`
  - char-literal skip disabled: `1 failed`
- **`$ident` loop removal.** I checked the claim that this preserves behaviour directly. I ran 1dec9bee1's `scala-code-only.mjs` and HEAD's over every line of all 1209 backend `.scala` files, plus 7 hand-built `$ident`/`$$`/`$"` shapes, and compared both the per-line view and the cross-line state. Result: `lines=232471 viewOrStateDiffs=0`. This matches the reasoning: pass 2 never keeps literal text, and identifier characters never match the `"`, `\`, or `$` branches.
- **HEAD still flags everything base flags.** I re-ran the differential on HEAD (base `scanScalaText` vs HEAD) over 1209 files, with output naming this worktree:

  | Variant | Base flagged | HEAD flagged | Base-only | HEAD-only |
  | --- | --- | --- | --- | --- |
  | as-is | 0 | 0 | 0 | 0 |
  | append probe to every line | 180532 | 180532 | 0 | 0 |
  | prepend probe to every line | 232464 | 232464 | 0 | 0 |
  | insert probe line after every line | 214094 | 214094 | 0 | 0 |
  | alternate code / `//` probe | 89677 | 89677 | 0 | 0 |

  Pass 2 alone flags 0 real-tree lines, across 79162 `id"` occurrences scanned.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- `scripts/scala-code-only.mjs:14` is a 145-character comment line; the other header lines are wrapped near 100. Prettier does not reflow comments, so consider re-wrapping it by hand.

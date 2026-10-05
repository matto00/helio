## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: a11449afec69579ccce28b6023058dc7652a2f97 (base 32571b0166a25b127a27bec645b7e2aec11b3c2b, resolved live). This report covers the cycle-2 → cycle-3 delta (46ae373a..a11449af) plus fresh runs of every gate. What evaluation-1/2 verified still holds for the code this cycle did not touch. No other agent was active in the worktree, and I ran the mutations one after another.

### Phase 1: Spec Review — PASS

All three skeptic-final-1 change requests are addressed:

1. **CR1 — pin the `text` key.** A new Scala selftest case `(text)` weakens `selectQuery`'s exempt text in place and asserts an unmatched hit, the hit's content, and a stale entry. D5 has a matching row ("text dropped from the key"). mutation-proof.md has a matching Scala 7 entry.
2. **CR2 — pin the arm reset.**
   - A new Scala case `(arm-reset)` collapses `selectQuery` to one unconditional bare query and asserts it goes red rather than inheriting `findByNodeAndRow`'s `case (None, None) =>` arm.
   - A new TS case `(d2)` checks that a `case ... =>` line in an earlier function does not leak into the exempt function's arm.
   - D5 has a matching row, and mutation-proof.md has matching Scala 8 and TS 5 entries.
3. **CR3 — remove line-number citations.**
   - The acceptance grep `grep -nE '\.(scala|ts)?:[0-9]+|Service:[0-9]+' scripts/check-node-root-encoding*.mjs` returns **no hits** (exit 1).
   - The replacement citations are accurate:
     - The quoted guard `val explicitRootId = if (trunkLastStepId.isEmpty) Some(lowestRootId) else None` exists verbatim in `PipelineRunService.scala`.
     - `final case class ProposalOutputSummary` exists in `PipelineProposalProtocol.scala`.

D2 now also states a third residual risk: a `def` spoofed inside a comment or string re-scopes the lines after it. It also documents that a nested `def` re-scopes a site and fails closed. This is accurate for `SCOPE_RE` as written.

Scope: `git diff --name-only` still shows only `scripts/check-node-root-encoding*` and the openspec change dir. CONSTRAINTS are `[]`.

### Phase 2: Code Review — PASS

Gates, run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `check:node-root-encoding` | exit 0 |
| `check:node-root-encoding:selftest` | exit 0, 64 PASS / 0 FAIL |
| `check:node-root-encoding:ts` | exit 0 |
| `check:node-root-encoding:ts:selftest` | exit 0, 29 PASS / 0 FAIL |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |

Mutants I ran myself, one at a time. After each, I restored the file with an exact `git checkout -- <path>`. `git status` was clean at the end.

| Mutant | Selftest result |
| --- | --- |
| Scala, text dropped from the key (`keyOf(relPath, scope, arm)` on both the hit side and the entry side) | exit 1 with exactly `(text)` ×3: weakened text gives unmatched hit + stale; hit named; stale entry reported |
| Scala, `arm = NO_ARM;` deleted from the scope-change block | exit 1 with exactly `(arm-reset)` ×3 |
| TS, `arm = NO_ARM;` deleted from the scope-change block | exit 1 with exactly `(d2) shifted-in case arm does not leak across scopes` |

These match mutation-proof.md's Scala 7, Scala 8 and TS 5 entries line for line.

Before/after parity: the scanners' hit and exemption logic is unchanged this cycle; the only script changes are comments and selftests. So the cycle-1 parity result still stands: 6 Scala and 1 TS raw hits, identical before and after, with 0 violations.

### Phase 3: UI Review — N/A
This is a script-only change. No file matches a Phase 3 trigger.

### Overall: PASS

### Non-blocking Suggestions
- Two rewritten comment lines exceed the ~100-column width used elsewhere in these files. Prettier does not reflow comments, so wrap them by hand to match:
  - `scripts/check-node-root-encoding.mjs:72` (142 chars)
  - `scripts/check-node-root-encoding.ts.mjs:56`

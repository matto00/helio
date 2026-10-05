## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed HEAD: 2b722ab7802831a218a1c555770018688cdf5c85 (base 32571b0166a25b127a27bec645b7e2aec11b3c2b, resolved live).

This report covers what changed between cycle 3 and cycle 4 (a11449af..2b722ab7), plus fresh runs of every gate. Everything evaluation-1/2/3 verified still holds for the code this cycle did not touch. No other agent was working in the worktree while I ran.

### Phase 1: Spec Review — PASS

- **skeptic-final-2's change request (pin the TS guard's `text` key) is addressed.**
  - New case: `scripts/check-node-root-encoding.ts.selftest.mjs` gains a `(text)` case. It edits the exempt `context.ts` line in place, keeping the same scope and arm: `?? null` becomes `|| null`, and the companion `rootId` line is dropped.
  - Assertions: the case asserts three things:
    1. the replacement really happened;
    2. there is exactly one unmatched hit, and it names the new text;
    3. there is one stale entry.
  - design.md D5: the TS paragraph now lists the text-dropped, arm-reset and post-scan-off mutations alongside their selftest cases.
  - mutation-proof.md: there is a new "TS 6" entry.
- **Scope:** `git diff --name-only` against the base shows only the four `scripts/check-node-root-encoding*` files plus the openspec change dir. In this cycle, the only script that changed is the TS selftest.
- **Untracked file:** `skeptic-final-3.md` is untracked in the change dir. It is the skeptic's own round-3 report, not part of the reviewed commit.
- **CONSTRAINTS:** `[]`, so there is nothing to honour.

### Phase 2: Code Review — PASS

Gates, run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `check:node-root-encoding` | exit 0 |
| `check:node-root-encoding:selftest` | exit 0, 64 PASS / 0 FAIL |
| `check:node-root-encoding:ts` | exit 0 |
| `check:node-root-encoding:ts:selftest` | exit 0, 33 PASS / 0 FAIL (29 + 4 new `(text)` checks) |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |

**TS text-dropped mutant, run by me.** I removed the text component from the key on both sides:
- hit key: `keyOf(relPath, scope, arm)`
- entry key: `keyOf(e.file, e.scope, e.arm)`

Result: the TS selftest exits 1 with exactly three FAILs, all from the new case:
- `(text) changed text: unmatched hit + stale entry`
- `(text) unmatched hit names the new text`
- `(text) stale entry reported`

No other case fails. This matches mutation-proof.md's "TS 6" entry line for line. I restored the file with an exact `git checkout -- scripts/check-node-root-encoding.ts.mjs`, and `git status` showed no tracked changes afterwards.

**Other checks:**
- The acceptance grep `grep -nE '\.(scala|ts)?:[0-9]+|Service:[0-9]+' scripts/check-node-root-encoding*.mjs` still returns no hits.
- The scanners' logic is unchanged this cycle; only a selftest was added. So the cycle-1 result still stands: the same 6 Scala and 1 TS raw hits before and after the change, with 0 violations.

### Phase 3: UI Review — N/A
Script-only change. No file matches a Phase 3 trigger.

### Overall: PASS

### Non-blocking Suggestions
- These two over-long comment lines from evaluation-3 are still present:
  - `scripts/check-node-root-encoding.mjs:72` (142 chars)
  - `scripts/check-node-root-encoding.ts.mjs:56`

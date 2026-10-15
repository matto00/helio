## Standing Constraints

- [C1] No sleeps, no `eventually`, no retry loops; waits are latch-based with a bounded timeout.
- [C2] No production code change in the final diff; mutations M1/M2/no-op are temporary and reverted (git diff proves it).
- [C3] Every cited test run shows this worktree's paths and non-zero executed counts.

## 1. Tracker

### Tests

- [x] 1.1 Re-verify Context facts (guard lines, gated/refinement Left branches, DbContext-only DB access) and record the first tracked hop of a leaked `author`/`refine` call in evidence.md
- [x] 1.2 Add `TrackedEc`, `TrackedDbContext`, `awaitQuiescence()` per design D1; verify spec compiles and is green
- [x] 1.3 Wire the Claude-reaching stack per D2; verify spec green
- [x] 1.4 Guards per D3 at all six sites plus before `val before`; limitation comment at the streaming guard; verify spec green
- [x] 1.5 Positive control test per D4; verify green, and red with `awaitQuiescence()` as a no-op (then restore)

## 2. Proof

### Tests

- [x] 2.1 D5(i) baseline: base spec + M1 green, >=3 runs; record
- [x] 2.2 D5(ii) changed spec + M1 red at authoring guards, >=3 runs; revert M1
- [x] 2.3 D5(iii) changed spec + M2 red at refinement guards, >=3 runs; revert M2
- [x] 2.3a D5(iv) M3 (M1 + eager streamAttempt) red at streaming guard on changed spec, green on base spec, >=3 each; revert
- [x] 2.4 D5(v) changed spec, no mutation, >=5 consecutive green runs; `git diff --stat` shows only the spec + change dir
- [x] 2.5 One foreground `sbt testFull` (capped) green; record executed counts

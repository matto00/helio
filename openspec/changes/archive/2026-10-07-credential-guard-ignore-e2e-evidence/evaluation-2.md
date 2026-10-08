## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: e14d898aedb5b1f7918d7424f2d2d0f7ce66c5be. Diff base resolved live: d125b654141ac79d96a8fd0f9cb5e74b834c7c0c. Cycle-2 delta reviewed: 6958cbb07..e14d898ae.

### Phase 1: Spec Review — PASS
Issues: none.
- Cycle-1 CR1 is resolved. `scripts/check-no-credential-in-agent-surface.mjs:141` now reads `107`, and `grep -n '^/e2e-evidence/$' .gitignore` returns `107`.
- The design Decision 2 divergence (non-blocking in cycle 1) is resolved. `removeE2eEvidencePlant` only calls `rmdirSync` when the self-test's marker was present before cleanup.
- All of cycle 1's AC1–AC3 findings still hold.
- C1 is honored: cleanup is never recursive, removes the dir only when it holds the self-test's marker, and never creates the dir over an existing one.
- The delta is limited to the three fixes plus the committed evaluation-1.md, so there is no scope creep.

### Phase 2: Code Review — PASS
Issues: none.

Gates I ran myself in WORKTREE_PATH:

| `e2e-evidence/` state | Gate exit | Self-test exit | Result |
|---|---|---|---|
| Absent | 0 | 0 | No dir left behind. |
| Populated with my own file | 0 | 0 | The file survived with the same sha256 (8435cb42...). I removed my file afterwards. |
| Empty, pre-existing | — | 0 | The dir survived. This was the cycle-1 non-blocking defect, and it is now fixed. I removed my empty dir afterwards. |

`npx prettier --check` and `npx eslint` on both scripts were clean.

Mutation checks ran in a throwaway detached worktree at e14d898ae under the session scratchpad. It has since been removed, and `git worktree list` shows no straggler.

| Mutation | Self-test exit | Failure reported |
|---|---|---|
| M1: `"e2e-evidence",` removed from the gate | 1 | "real gate exits 0 with e2e-evidence/ present", plus `runMutatedScript ... found 0`. The red/green case does fail without the fix. |
| M2: `/zz-probe/` appended to `.gitignore` | 1 | "every root-level .gitignore directory is in IGNORED_TOP_LEVEL" |
| M4: `/e2e-evidence/` deleted from `.gitignore` | 1 | The reverse-direction check. |
| M5: shared `rootDirsMissingFromIgnoreSet` stubbed to `return []`, with `/zz-probe2/` added | 1 | "parser reports a synthetic extra root pattern" |

M5 proves the non-vacuity probe now exercises the same helper as the real check. A helper that always returns `[]` makes the real check pass silently, and the probe catches it. The probe's relaxed `includes("zz-probe")` assertion also removes cycle 1's spurious duplicate failure.

### Phase 3: UI Review — N/A
Scripts-only diff. No trigger globs match.

### Overall: PASS

### Non-blocking Suggestions
- (Carried from cycle 1, still non-blocking.) `tasks.md` cites `evidence/*.log`, but `*.log` is gitignored, so those logs never reach the PR. The committed mutated-copy self-test case is the durable red evidence.

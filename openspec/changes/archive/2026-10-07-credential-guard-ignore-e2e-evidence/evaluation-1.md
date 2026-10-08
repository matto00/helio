## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 6958cbb07fd53b84d638c8cbbd3d3953d5014ec6. Diff base resolved live: d125b654141ac79d96a8fd0f9cb5e74b834c7c0c.

### Phase 1: Spec Review — FAIL

- AC1 (add `e2e-evidence` to `IGNORED_TOP_LEVEL`): PASS. See `scripts/check-no-credential-in-agent-surface.mjs:774`.
- AC2 (red before the fix, green after): PASS. I re-ran this myself.
  - Main's gate copy (d125b6541), run with `e2e-evidence/` present, exits 1. Its output is `COVERAGE DRIFT: top-level directory "e2e-evidence" ...`.
  - The fixed gate exits 0 in the same state.
  - The permanent self-test case does the same thing with a mutated copy, and I confirmed it is not vacuous (see Phase 2).
- AC3 (audit for other gitignored root dirs): PASS. I enumerated every non-comment `.gitignore` line myself. The only root-matching, non-dot directory patterns are:
  - the six original names
  - `/e2e-evidence/`
  - the two HEL-956 self-test probe dirs

  Only `.gitignore` changed between HEL-1363 and main, and that change adds `/e2e-evidence/` and nothing else. No other gap exists.
- Constraint C1: honored in the code as written. `removeE2eEvidencePlant` deletes only the two named marker/placeholder files and then calls `rmdirSync` only if the dir is empty. Planting is guarded by `existsSync`. I verified this live: a pre-existing populated `e2e-evidence/` survived a full self-test run with the same sha256.
- Task 1.1 ("refresh the header table and its line numbers") is marked done but is inaccurate. See CR1.
- Scope: clean. The diff covers the gate, the self-test, one `.gitignore` line and the change artifacts. The spec delta matches the behavior.

### Phase 2: Code Review — FAIL (one mechanical documentation defect, CR1)

Gates I ran myself in WORKTREE_PATH. The diff is scripts-only, so the frontend and backend gate globs do not match. These are the scripts' own gates.
- Without `e2e-evidence/`:
  - `node scripts/check-no-credential-in-agent-surface.mjs` exits 0.
  - The self-test exits 0 (all `ok`).
- With a real populated `e2e-evidence/` (my own file, removed afterwards; none existed beforehand):
  - The gate exits 0.
  - The self-test exits 0 with 97 `ok`.
  - The file survived unchanged (sha256 8435cb42... before and after).
- `npx prettier --check` and `npx eslint` on both scripts: clean.

Mutation checks. These ran in a throwaway detached worktree at 6958cbb07 under the session scratchpad, which has since been removed. I edited only that copy.
- M1: removing `"e2e-evidence",` from the gate, with no `e2e-evidence/` present, makes the self-test exit 1.
  - The planted-dir case fails with COVERAGE DRIFT naming e2e-evidence.
  - The mutated case throws `runMutatedScript: expected exactly one occurrence ... found 0`. So the red/green case does fail when the fix is removed. The `finally` cleanup still ran and left no stray dir.
- M2: appending `/zz-probe/` to `.gitignore` makes the self-test exit 1 with `not excluded by the gate: zz-probe`.
- M3: appending the unanchored pattern `zz2/` exits 1 with `not excluded by the gate: zz2`.
- M4: deleting `/e2e-evidence/` from `.gitignore` exits 1 with `not in .gitignore: e2e-evidence`. This is the reverse direction.
- Conclusion: the `.gitignore` consistency check is not vacuous in either direction.

Code-quality notes:
- Mutation find string: `runMutatedScript` enforces exactly one occurrence, so a drifted string fails loudly rather than quietly mutating nothing.
- Importing `IGNORED_TOP_LEVEL` from the gate does not trigger its main path, because of the realpath entry guard at `:996-998`.

Issue:
- `scripts/check-no-credential-in-agent-surface.mjs:141`: the header table says `e2e-evidence | 103`, but `/e2e-evidence/` is at `.gitignore:107` on this branch. The same commit added four lines (90-93) above it. The task's purpose was to correct stale line numbers, and the change ships a new stale one. The other rows (6/8/10/23/24/25) are correct.

### Phase 3: UI Review — N/A
Scripts-only diff. No trigger globs match.

### Overall: FAIL

### Change Requests
1. `scripts/check-no-credential-in-agent-surface.mjs:141`: change `103` to `107`, giving `//   e2e-evidence        | 107 (/e2e-evidence/, HEL-1363)`. Check it with `grep -n '^/e2e-evidence/$' .gitignore` after any further `.gitignore` edits in this change.

### Non-blocking Suggestions
- Empty pre-existing `e2e-evidence/`: the self-test removes it (verified: `mkdir e2e-evidence` then a self-test run leaves no dir). This is because startup and final cleanup call `rmdirSync` on any empty `e2e-evidence/`, not just a marker-owned one. Design Decision 2 says cleanup applies "only if the self-test created it" and startup cleanup only to a "marker-owned dir". Nothing is lost, since the dir was empty and `e2e/support/evidencePath.ts:19` uses `mkdirSync(..., { recursive: true })`. The C1 wording is honored literally. Still, either gate the `rmdirSync` on the marker having been present, or reword Decision 2 to match.
- The non-vacuity check (`selftest.mjs`, "parser reports a synthetic extra root pattern") re-implements the `filter(...)` expression instead of sharing it with the real check. It also reports a spurious second failure whenever the real check already fails (M3 output: `["zz2","zz-probe"]`). One small `rootDirsMissingFromIgnoreSet(text)` helper used by both would make the probe exercise the exact code under test.
- `tasks.md` cites `evidence/*.log`, but `*.log` is gitignored (`.gitignore:27`), so those logs never reach the PR. The committed mutated-copy self-test case is the durable red evidence, so this does not block.

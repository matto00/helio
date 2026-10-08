## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD f3113ed454c4636dc466f7eb93deb976d30829a4. The worktree is clean except for the untracked change dir.

### What I verified (with evidence)

**Round-1 change requests**
- **CR1 (toast.css stale comment): resolved.**
  - C2 now has a comment-only exception, and task 4.3 was added.
  - The 4.3 search text, "`Toast.tsx`'s own `matchMedia` check zeroes the", exists literally at toast.css:61.
  - The comment actually spans lines 60-63, not the stated "around 59-62". That is close enough, because the task anchors on the literal text.
  - toast.css is in the proposal's Impact list and in 6.2's expected list. design.md D5 records the change.
  - However, the 6.1 grep that is supposed to guard it is vacuous. See CR-A.
- **CR2 (5.2 restore check): resolved.**
  - 5.2 now uses `grep -c` with the exact guard line, expecting `1`. That line is in BRE, where `(`, `|` and `"` are literal.
  - The 2.1 content contains the line exactly once.
- **CR3 (6.2 status): resolved.**
  - `git status --porcelain -- frontend` scopes out the change dir.
  - `frontend/src/utils` is a tracked dir, so the two new files show up individually as `??`.
  - The expected set is 7 ` M` entries plus 2 `??` entries, which is 9 in total. That is correct for the planned edits.
- **CR4 (eslint-disable line): resolved.**
  - I piped the exact 2.2 test file (moved block plus the new `Reflect.deleteProperty` case) through `npx --no-install eslint --max-warnings=0 --stdin --stdin-filename frontend/src/utils/prefersReducedMotion.test.ts`. It exited 0.
  - The 2.1 module through the same command also exited 0.
- **Non-blocking notes:**
  - Double blank lines are addressed (explicit instruction in 3.1/3.3, plus `prettier --write` in 5.3).
  - The D1 wording is now accurate (buildChartOption.ts, chartAppearance.ts, Toast.tsx).
  - 4.2 forbids "cross-feature" and pins the sentence shape.

**Re-run expectations (fresh)**
- 1.1: `git grep -n "function prefersReducedMotion" -- frontend/src` prints 2 lines (Toast.tsx:18, chartAppearance.ts:89). The full `prefersReducedMotion` grep prints 12 lines. Both match the plan.
- 2.2: the describe block is at chartAppearance.test.ts:247-264, and the import is at :8. Correct.
- 3.1:
  - Lines 79-92 are exactly the doc comment plus the function.
  - Lines 78 and 93 are blank, and the instruction covers that.
  - Removing the comment also removes the `own private` pointer at :83.
- 3.3: Toast.tsx:18-26 is the function, and lines 17 and 27 are blank. Correct.
- 4.1: the replacement phrase exists verbatim on useIsNarrowerThan.ts:6.
- 6.1: the non-test query-literal grep currently prints exactly the 2 copies (Toast.tsx:25, chartAppearance.ts:91), so "exactly 1 after" is achievable.
- No `prefersReducedMotion` reference exists outside `frontend/src` (archive excluded): the grep has 0 hits.
- Tooling resolves from the worktree:
  - `npx --no-install prettier --version` reports 3.8.1.
  - `npx --no-install jest --version` from frontend/ reports 30.2.0.
  - Root `lint`/`typecheck`/`format:check` scripts exist.
- Prettier: the exact 2.1 module and 2.2 test file piped through `prettier --stdin-filepath` produce no diff.
- No import-order lint rule exists, so import placement in 3.1-3.3 cannot fail lint. The new module has no imports, so there is no cycle risk.
- 5.2 red proof is sound. With the guard reduced to `typeof window === "undefined"`, the deleted/undefined `window.matchMedia` is called, and calling it throws. The `not.toThrow` assertion therefore fails. There is no matchMedia shim in `src/test`.

### Verdict: REFUTE

One new defect. It was introduced by the round-1 fix, and the round-1 report's own suggested pattern had the same defect.

### Change Requests

1. **CR-A: task 6.1's stale-pointer grep cannot catch two of the three stale pointers it exists to guard, so "expected: NO output" passes vacuously.**
   - **The bug.** The patterns `Toast.tsx.s .prefersReducedMotion` and `Toast.tsx.s own .matchMedia` allow exactly one character between `tsx` and `s`. The real text is `` `Toast.tsx`'s `` with two characters (a backtick and an apostrophe) in that position.
   - **Reproduced twice on the current, unedited tree:**
     - The 6.1 command as written prints only `frontend/src/utils/chartAppearance.ts:83`.
     - The two `Toast.tsx…` patterns alone print nothing (exit 1).
     - Yet the stale pointers are present today at `frontend/src/hooks/useIsNarrowerThan.ts:6` and `frontend/src/shared/ui/toast.css:61`.
   - **Effect.** If 4.1 or 4.3 were skipped or botched, 6.1 would still report clean. The design.md risk line ("zero-hit grep … including toast.css's comment (D5)") claims coverage that does not exist.
   - **Fix.** Replace the 6.1 command with a fixed-string grep:
     `git -C "$W" grep -n -F -e 'own private `prefersReducedMotion`' -e '`Toast.tsx`'"'"'s `prefersReducedMotion`' -e '`Toast.tsx`'"'"'s own `matchMedia`' -- frontend/src`
     Alternatively, change both regexes to use `Toast.tsx..s`.
   - **Proof that the fix works.** I ran the `-F` form on today's tree. It prints all three lines (useIsNarrowerThan.ts:6, toast.css:61, chartAppearance.ts:83).
   - **Required additions to 1.1.** Have the executor run this exact command and record it under 1.1 with expected output of exactly those 3 lines. That proves the guard is red before it is used as a zero-hit check in 6.1.

### Non-blocking notes
- D5 sits under the "Risks / Trade-offs" heading rather than "Decisions". This is cosmetic.
- 6.1's "after" `prefersReducedMotion` list still has no expected count. That is acceptable because it is informational.
- 4.3's line hint says "around lines 59-62", but the comment is at 60-63. This is harmless because the task anchors on literal text.

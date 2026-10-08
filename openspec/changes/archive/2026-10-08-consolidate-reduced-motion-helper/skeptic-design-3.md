## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD f3113ed454c4636dc466f7eb93deb976d30829a4. The worktree is clean apart from the untracked change dir. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=task/consolidate-reduced-motion-helper/HEL-1179`.

### What I verified (with evidence)

**CR-A (round 2): resolved.** I ran every check myself on the current tree.

- **1.1 stale-pointer probe, as written in tasks.md** (`git grep -n -e "own private .prefersReducedMotion" -e "Toast.tsx..s .prefersReducedMotion" -e "Toast.tsx..s own .matchMedia" -- frontend/src`):
  - It printed exactly 3 lines, which matches the expectation in 1.1:
    - `frontend/src/hooks/useIsNarrowerThan.ts:6`
    - `frontend/src/shared/ui/toast.css:61`
    - `frontend/src/utils/chartAppearance.ts:83`
  - It exited 0. The guard is shown red before 6.1 relies on it.
- **The same probe after the planned edits returns nothing.** I simulated the edits in a scratch copy:
  - 3.1: deleted chartAppearance.ts lines 79-92.
  - 3.3: deleted Toast.tsx lines 18-26.
  - 4.1: applied the literal replacement text.
  - 4.3: applied the literal replacement text.
  - Running the same 3 patterns then printed nothing (exit 1). The 6.1 "expected: NO output" is therefore achievable, and it is no longer vacuous.
  - Neither the new module's doc comment from 2.1 nor the new 4.1/4.3 wording matches any pattern.
  - toast.css:45 mentions `Toast.tsx`'s `TOAST_EXIT_MS`. That is a different, still-accurate pointer, and the probe correctly ignores it.
- The 4.1 phrase and the 4.3 phrase each sit on a single line (useIsNarrowerThan.ts:6 and toast.css:61), so the literal replacements apply.

**The rest of 1.1 and the 6.1 expectations, re-run fresh**

- 1.1 cmd 1 (`function prefersReducedMotion`): exactly 2 lines, Toast.tsx:18 and chartAppearance.ts:89. Matches.
- 1.1 cmd 2: 12 lines. Matches.
- 1.1 cmd 3 (`-c` of the query literal): 4 files with count 1 each (Toast.test.tsx, Toast.tsx, chartAppearance.test.ts, chartAppearance.ts). The task gives no exact count here, only "lists each file", so this is consistent.
- 6.1 non-test query-literal grep:
  - Today it prints Toast.tsx:25 and chartAppearance.ts:91.
  - Both lines are inside the planned deletions (3.3: 18-26; 3.1: 79-92).
  - The 2.1 content adds exactly one matching line, so "exactly 1 line, in prefersReducedMotion.ts" holds.
- 3.1 post-edit expectation (2 lines):
  - In the simulated chartAppearance.ts, the only remaining reference is the default parameter.
  - The new import adds the second line.
- 3.3 post-edit expectation (2 lines, no `matchMedia`):
  - In the simulated Toast.tsx, the only remaining reference is the call (no `matchMedia` left).
  - The new import adds the second line.

**The other round-3 edits**

- 4.3's line hint now says "lines 60-63", and `sed -n 58,64p toast.css` confirms the comment spans 60-63.
- design.md headings are Context / Goals / Decisions (D1-D5) / Risks. D5 now sits under Decisions.
- The Risks line about the zero-hit grep "including toast.css's comment (D5)" is now true, given the probe results above.
- No new incorrect expectation was introduced. Every exact-count expectation I could evaluate on today's tree matches.
- Round-2 confirmations of 2.1, 2.2, 5.2, 5.3 and 6.2 still hold:
  - Those tasks did not change.
  - The tree is the same commit.
  - The line anchors I re-checked are unchanged: 3.1 at 79-92, 3.3 at 18-26, and the test import at :8.

### Verdict: CONFIRM

### Non-blocking notes
- 4.3's literal replacement makes toast.css:61 about 122 characters long, so the re-wrap the task asks for is necessary. If the re-wrap splits "`Toast.tsx`'s own" across two lines, the 6.1 probe is unaffected either way, because the new text is not stale.
- 1.1 cmd 3 has no exact expected output. That is fine because it is informational, but a Haiku executor could note "4 files" for the record.

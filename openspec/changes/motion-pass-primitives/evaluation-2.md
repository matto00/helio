## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `11bbc2636767c3eac9e41a53d40ca85ec5a80d31`. The diff base, resolved live, is `29cb0a60f` (origin/main after the
merge of HEL-1583 and HEL-1628). New since cycle 1:

| commit | what it changes |
|---|---|
| 8a57f9130 | palette doc comment |
| 4d242f341 | merge of origin/main |
| 11bbc2636 | hel1583 spec wait |

There are also evidence edits.

### Phase 1: Spec Review — PASS

Cycle 1 CR1-CR4 are each verified:

- **CR1: perf.md "Reading".** It now lists the per-window first-content deltas: W2 +94, W3 +59, W4 +137, W5 +70 and W6 +221 ms.
  It gives the W2-W5 median of about +82 ms and names W3 as the most favourable window. I re-checked the new miss margins
  against the raw data:

  | metric | window | measured | threshold | miss |
  |---|---|---|---|---|
  | first content | W3 | 1657 | 1621.85 | 35 ms |
  | first content | W6 | 1842.7 | 1826.3 | 17 ms |
  | long tasks | W3 | 531 | 463 | 68 ms |
  | long tasks | W6 | 566 | 476 | 90 ms |

  The long-task deltas listed (W2 +147, W3 +127.5, W4 -2, W5 +89, W6 +113) are also correct.
- **CR2: durable copies of the W4/W5 data.** `evidence/.concertino/scratch/HEL-1584/` now holds `x-*.jsonl`, `y-*.jsonl`,
  `verdict.py` and `summ.py`. `cmp` against the scratch originals shows all byte-identical. perf.md cites the durable root.
- **CR3: what the metric measures.** The Method section now states that the metric is DOM readiness, excludes the entrance,
  and is a lower bound on perceived delay.
- **CR4: palette doc comment.** `CommandPalette.tsx`: the `groupBySection` JSDoc now sits directly above `function
  groupBySection`.
- **Suggestion S3 from cycle 1.** The quarantine file is now `quarantined-specs-run-tree-unverified-head.txt`. Its header
  states that the run was on HEAD, not base, and gives the HEL-951 reasons.
- **Merge integration (driver check).** For every non-openspec file the branch touches, the set of +/- lines in
  `git diff 29cb0a60f HEAD` is identical to the set in cycle 1's `git diff c8e204e06 f931bcc18`. The one exception is
  `e2e/hel1583-refresh-line-no-shift.spec.ts`, which is a new edit. No branch-touched file lost its branch change. So the
  merged head is exactly HEL-1583/HEL-1628's main plus this branch's own hunks, and neither side was dropped:
  `PanelList.tsx`, `theme.css`, `MobilePanelStack.tsx`, the SaveStateIndicator hosts and the guard. Merge-tree was clean.
- **motionTokenGuard count.** The count of 151 is from the tree: `find frontend/src -name '*.css' | wc -l` = 151. The test's
  comment names HEL-1583's `DashboardChipRow.css` as the 150 → 151 step.
- **Perf owner decision.** Still pending. Per the instruction, this is not counted against the cycle. The evidence package is
  now sound for that ruling.

### Phase 2: Code Review — PASS

Gates, run fresh at 11bbc2636:

| gate | result |
|---|---|
| lint | 0 |
| format:check | 0 |
| typecheck | 0 |
| jest (2 workers) | root 61/61 suites, 524 tests; frontend 723/723 suites, 9082 tests |
| frontend build | 0 |

**Full e2e suite on the merged head.** It ran with 2 workers under flock, with `--trace retain-on-failure` and output in
`scratch/HEL-1584/eval-c2/pw`, cleared afterwards. Result: **473 passed, 1 skipped, 0 failed, 0 flaky** (29.2 min, exit 0).
The known flakes HEL-1633/1644 did not fire. The executor's `merge-recheck-run.txt` showed
`hel1572-appearance-preferences.spec.ts:459` (Motion token pinning) failing once. It passed in my full run; I note this as
an earlier intermittent failure.

**hel1583-refresh-line-no-shift change: a legitimate measurement fix, not a weakening.**
- What was added: one wait, in `realCardsReady`, for the `motion-enter` CSS animations to finish
  (`a.finished.catch(() => undefined)`, filtered by animation name, so the never-ending skeleton shimmer is excluded).
- Why the fix is legitimate: `getBoundingClientRect().top` includes the 6px entrance `translateY`, so without the wait the
  "before" read lands mid-transform.
- Why the guard survives:
  - All three comparisons are unchanged: card top, chip-row top and `.panel-list` scrollHeight, each within 0.5px.
  - The non-vacuity check is unchanged: `.dashboard-refresh-line:not([data-reserved])` count is 0 at "before". So the
    measurement still precedes the line resolving (held 5s by the route).
  - A real shift (the ~27px line pushing cards) would still move all three values. I did not re-mutate the source, which
    would be a code change.
- Live numbers in my run:
  - NOSHIFT: before and after are identical (card 155.1875, chips 103.1875, scrollHeight 659) in both themes.
  - NOGAP: identical (card 128, chips 76, scrollHeight 632).

### Phase 3: UI Review — PASS

This cycle's changes to UI-affecting files are the merge only; the branch's own hunks are unchanged since cycle 1, whose
real-browser review covered Off, grid, modal, palette, entrance rules and the four breakpoints. On the merged head, the full
e2e suite covers the combined UI:
- `hel1584-motion-surfaces`: Off and OS reduce × light and dark on grid, modal and palette, plus crossfade width at 1440 and
  375.
- HEL-1583's mobile chips, glass nav and refresh-line specs.
- `hel1575-*`, `hel1573-*` and `hel1572-*`.

All are green.

### Overall: PASS

### Non-blocking Suggestions

- S1. Record in the PR that `hel1572-appearance-preferences.spec.ts:459` failed once in the executor's post-merge recheck
  (`evidence/merge-recheck-run.txt`) and passed in the evaluator's full run. If it recurs on CI, treat it as a flake
  candidate, not as a pass.
- S2. Carry cycle 1's S2 into the PR: no e2e covers the detail-modal geometry during the expand animation (hel716 is
  quarantined and fails at setup).

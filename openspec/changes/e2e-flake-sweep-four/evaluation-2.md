## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 633c8aa5735cc615b30766baf5b7a5e9cca03d28. Base resolved live: fd370e5e5abbfa3451133c8a2db97edc22970be8.

Code changes since cycle 1 (bdda7c36a..633c8aa57): one jest test was renamed and given a comment
(`hydrateTabs.test.ts`), so it is now labelled as a guard. No product, e2e or support-file change, so cycle 1's 40/40
runs at `--workers=2 --retries=0` still apply. The change-dir artifacts were edited in the untracked change dir, which
gets committed at Delivery.

### Phase 1: Spec Review — PASS

- CR1 is addressed. `design.md` now has Outcome notes:
  - D2: both `uiLogin` navigations use `domcontentloaded`; the residual risk stands.
  - D3: not reproduced and stays a named candidate. The note lists the probes tried, says (a) and (c) are refuted and
    (b) is supported by the trace but could not be forced, and names the unproven hardening.
  - D4: the real cause, the pre-selected row 0 matching the locator, with the probe frames and the 10x-throttle
    red/green.
  - This makes the AC4 record part of the change that gets archived, not only lane scratch.
- CR2 is addressed. The spec delta now says "navigated to (the location changed to `/dashboards/:id`) … a selection
  change without a location change does not count as a navigation". This matches `hydrateTabs.ts`.
- CR3 is addressed:
  - tasks.md 3.4 now says phone-sheet was probed, not run 40x by the executor, and that the evaluator ran it 40/40.
  - `evidence/summary.md` notes the transcript tails and that the jest red predates a one-line expectation fix. I
    re-verified the red in cycle 1.
- The guard label is applied: the test name starts with "guard:" and the comment says why it passes on the base code.
- CONSTRAINTS C1/C2/C3/C4/C12: honored. No sleeps, retries or longer timeouts were added.

### Phase 2: Code Review — PASS

Gates re-run fresh in WORKTREE_PATH at 633c8aa57:

| Gate | Result |
| -- | -- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| frontend `tsc --noEmit` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (`HELIO_JEST_MAX_WORKERS=3`) | root 66/66 suites, 579 tests; frontend 787/787 suites, 9642 tests |

The new comment follows the CONTRIBUTING.md test-comment rule: it says why the assertion is a guard, not what the test
does.

### Phase 3: UI Review — PASS

No UI-affecting change since cycle 1. Cycle 1's real-browser hel1578 40/40 run still covers the behaviour.

### Overall: PASS

### Non-blocking Suggestions

- `evidence/summary.md` and tasks.md 3.4 describe `schema-panel-40x.txt` as a tail without a header line. That file
  does contain "Running 40 tests using 2 workers"; only the hel1578 and hel813 files are tails. If either line is
  copied into the PR body, correct it there.

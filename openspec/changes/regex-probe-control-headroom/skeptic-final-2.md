## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: a50e33ad61144018d9ebf554d1fa7f834af69bd2. Base resolved live: afc2a687286a73b22660e613adef2dbb85d0d517.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/regex-probe-control-headroom/HEL-1808`.
- **Scope (C9).** `git diff --quiet $BASE...HEAD -- frontend backend schemas` exits 0. The only code file in the diff is `e2e/hel1683-regex-main-thread.spec.ts` (+136/-9). Everything else is in the openspec change dir.
- **C10 holds in the code.** I read the full spec diff.
  - `LONG_TASK_BOUND_MS = 100` is at spec line 26.
  - The control, probe and overrun windows (fill, wait and assertions) are unchanged. The diff adds only diagnostics: the LoAF observer, the response timeline, the `overrunApi` recorder, and attribution text appended to the existing log prefixes.
  - `applyDiagnosticThrottle` returns early when the variable is unset, `""` or `"1"`, and throws on any other value that is not an integer >= 2.
  - `grep -rn HEL1808 .github playwright.config.* package.json` finds nothing (exit 1), so CI cannot turn the throttle on.
- **Gates (fresh).** `eslint --max-warnings=0` on the spec exits 0. `prettier --check` on the spec and the change-dir `.md` files exits 0. `tsc --noEmit -p e2e/tsconfig.json` exits 0.
- **Live final-tree run (1x).** Servers on 7240/10147, lane DB `helio_hel1808`, ANTHROPIC_API_KEY empty, 2 workers, nice 19. Result: 2 passed. Control, probe, overrun and long-cell probe were all 0.0 ms.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1808/evidence/.concertino/scratch/HEL-1808/skeptic-final2-baseline.txt`
- **AC2, re-run by me rather than taken on trust.**
  - `git log -S"isBacktrackBounded(tree)"` points to fb684d03b (HEL-1683).
  - I applied the committed `mutation-decline-disabled.diff` (`git apply --check` passed), which turns off the HEL-1683 backtrack decline and the later HEL-1697 cost budget. Then I ran the full spec file.
  - Result: **probe red at 563.0 ms** (`probe pattern ^(.*.*.*.*.*.*.*.*x): longest main-thread task was 563.0 ms, must be <= 100 ms (control 0.0 ms)`). The long-cell probe was red at 1219.0 ms. Control was 0.0 ms.
  - I restored with `git checkout` of the two files, and `git status --short` was empty afterwards. The red is reproducible and consistent with the executor's 491 ms, the evaluator's 483 ms and round 1's 464 ms. **AC2 met.**
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1808/evidence/.concertino/scratch/HEL-1808/skeptic-final2-mutation-decline.txt`
- **Round-1 Change Request 1 (the evaluator-share claim) is resolved.**
  - `attribution.md` no longer claims a 10-30 ms evaluator share. It now says that LoAF measured the handler as a whole and that the internal split was NOT measured, and it calls a control-vs-probe comparison confounded.
  - Ground truth for the rest of the cause paragraph is `attribution-old-shape.txt` and `attribution-new-shape.txt`. Every shipped-shape longest task maps to a `DIV#root.oninput|...dispatchDiscreteEvent` LoAF with render 0-3 ms. The control window logs `api: none`.
- **Round-1 Change Request 2 (margin as headroom) is resolved.**
  - The Margin section now gives headroom against 100 ms: CI control 74 ms leaves 26 ms, CI probe 72 ms leaves 28 ms, and the shipped-shape throttled worst overrun of 85 ms leaves 15 ms. I checked each figure against the evidence:
    - `e2e2.log` lines 1946-1948 show control 74.0, probe 72.0 and overrun 0.0 on `[dev]`.
    - `attribution-old-shape.txt` shows the 6x overrun at 85.0.
  - It states plainly that an occasional red is still possible on a ~1.4x slower host and would not mean a regex regression.
  - It names both readings of the CI 74/72 pair, labelled as INFERENCE.
- **"Why no reshape" figures** match `attribution-new-shape.txt` exactly: 4x 75/99/72 and 6x 98/87/82, against old-shape 68/72/62 and 55/58/0.
- **AC1, task 4.1 (the 5 CI recordings)** happens in Delivery and is out of this gate's reach, per the orchestrator. The owner's margin-note ruling (C10) routes AC1 through "the PR states the remaining margin and its cause", and `attribution.md` now does that with evidence-backed statements. It has a placeholder section for the CI runs.
- **Cleanup.** Servers were stopped with `stop-servers.sh` (`STOPPED ports=7240,10147`), and the worktree is clean apart from this report.

### Verdict: CONFIRM

### Non-blocking notes (fix in the PR body when the 4.1 numbers land; none changes a conclusion)

- **`attribution.md` "Cause": the parenthetical gives the wrong source for its range.** It reads "across the committed 6x shipped-shape runs the probe handler sometimes costs more, paired deltas -11..+48 ms". The 6x shipped-shape deltas are -10 and -11. The +48 comes from the reverted new shape at 4x (97 vs 49). Suggested wording: "paired deltas -11..+48 ms across both shapes; in the shipped shape at 6x the probe handler cost more in two of three runs".
- **"Cause": two small range errors.**
  - "45-97 ms of script" should read 41-97 ms: the new-shape 4x overrun LoAF has 41 ms of `oninput` script.
  - "render/style-layout 0-4 ms" should read 0-5 / 0-3: the new-shape 4x control has render=5.
- **"Cause": the opening and closing sentences disagree.** The paragraph opens "Every control/probe/overrun long task ... is attributed ... to the fill's own synchronous input handler" and then says "A minority of tasks are React renders of late responses". The one red in the evidence, the new-shape 4x overrun at 119 ms, was a `performWorkUntilDeadline` frame (dur=184), not the handler. Change "Every" to "Almost every" or "Every shipped-shape".
- **No gate defect to record.** No report in this chain discloses unsound evidence-directory mtimes, and no conclusion here rests on mtime ordering.

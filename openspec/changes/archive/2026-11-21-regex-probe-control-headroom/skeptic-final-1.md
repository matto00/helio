## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 85beaeed7d8275f73162b7baa419922b51ea48f2. Base resolved live: afc2a687286a73b22660e613adef2dbb85d0d517.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/regex-probe-control-headroom/HEL-1808`.
- **Scope (C9).** `git diff --quiet afc2a6872...HEAD -- frontend backend schemas` exits 0, so no app, backend or schema code changed. The only code change is `e2e/hel1683-regex-main-thread.spec.ts` (+136/-9). Everything else is openspec artifacts.
- **C10 holds in the code.**
  - `LONG_TASK_BOUND_MS = 100` (spec line 26).
  - Windows and frame are unchanged. The diff only adds diagnostics: a LoAF observer, an API response timeline, and the attribution in the three `console.log` lines, whose existing prefixes are kept. An `overrunApi` recorder is also added.
  - `applyDiagnosticThrottle` returns early when the variable is unset, empty or `1`. It throws on any other value that is not an integer >= 2; I checked `"abc"` against the regex and it gives `false`.
  - `grep -rn HEL1808 .github playwright.config.* package.json` has no hits, so CI cannot set the variable.
- **Gates (fresh).** `eslint --max-warnings=0` on the spec exits 0. `prettier --check` on the spec and the change-dir `.md` files exits 0. `tsc --noEmit -p e2e/tsconfig.json` exits 0.
- **Live baseline, 1x (servers 7240/10147, lane DB `helio_hel1808?user=matt`, ANTHROPIC_API_KEY empty, 2 workers, nice 19).** 2 passed. Control, probe and overrun were all 0.0 ms, and so was the long-cell probe. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1808/skeptic-final-baseline.txt`.
- **AC2, re-run by me rather than taken on trust.**
  - Provenance: `git log -S"isBacktrackBounded(tree)"` points to fb684d03b (HEL-1683). `git log -S'"regexInputCost"'` points to 98b8c40e9 (HEL-1697, after HEL-1683). The committed `mutation-decline-disabled.diff` removes both, which restores pre-HEL-1683 decline behaviour, and it applies cleanly to HEAD.
  - Run: I applied the diff, ran the full spec file, then restored with `git checkout` of the two files. `git status` showed only the evaluator's untracked `evaluation-2.md` afterwards.
  - Result: **probe red at 464.0 ms** (`probe pattern ^(.*.*.*.*.*.*.*.*x): longest main-thread task was 464.0 ms, must be <= 100 ms (control 0.0 ms)`). The long-cell probe was red at 1144.0 ms, and the control was 0.0 ms. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1808/skeptic-final-mutation-decline.txt`.
  - This matches the executor's committed 491 ms and the evaluator's 483 ms. **AC2 met.**
- **Control mutation.** The committed `mutation-control-busyloop.{diff,txt}` shows control red at 1209 ms, and the diff applies cleanly. I did not re-run it because it is not an AC.
- **AC1 (task 4.1, the CI recordings) is out of this gate's reach** by the orchestrator's instruction. I judged the margin/cause statement (`attribution.md`) against the committed evidence:
  - The CI claim checks out. `.concertino/runs/HEL-1697/evidence/scratch/e2e2.log` lines 1946-1948 show control 74.0, probe 72.0 and overrun 0.0, on the `[dev]` project. The "dev-build" framing is therefore right for CI too.
  - The cause headline is supported. In every throttled control, probe and overrun task in `attribution-old-shape.txt` and `attribution-new-shape.txt`, the dominant LoAF script is `DIV#root.oninput|...dispatchDiscreteEvent`, with render 0-5 ms. The control window logs `api: none`.
  - The "why no reshape" figures match `attribution-new-shape.txt` exactly (4x 75/99/72 vs 68/72/62; 6x 98/87/82 vs 55/58/0).
  - The evaluator-share sentence is **not supported**; see Change Request 1.

### Verdict: REFUTE

### Change Requests

1. **`attribution.md`, "Cause" paragraph: the evaluator-share claim contradicts the committed evidence.** It reads: "The client evaluator itself is roughly 10-30 ms of it (the declined probe handler, with no client evaluation, is about 30 ms cheaper than the control's)." Pairing each run's control `oninput` script duration with the same run's probe `oninput` script duration gives these deltas (control minus probe):
   - **Shipped (old) shape, `attribution-old-shape.txt`:**
     - 4x: +20, (control 70 vs probe none >= 50), +13
     - 6x: **-10** (46 vs 56), **-11** (54 vs 65), and (control none vs probe 55)

     So in all three shipped-shape 6x runs the probe handler is *more* expensive than the control's.
   - **Reverted new shape:** +13, +48, +19, +28, +13.

   No run shows "about 30 ms cheaper" for the shape that ships. The method is also confounded. The probe handler is not "no client evaluation": it still compiles the regex and runs the HEL-1683/1697 decline analysis (`isBacktrackBounded`, the cost model) on a different pattern. Meanwhile design.md's own premise says the evaluator's work on 2 tiny cells is microseconds.

   Replace the sentence with what the evidence supports. For example: LoAF attributes the task to the input handler as a whole, and the split between React dev reconcile, draft walk and evaluator was not measured. A paired control-vs-probe handler comparison is inconclusive (-11 to +48 ms; the probe handler was costlier in the shipped shape at 6x). This statement goes into the PR as the AC1 "cause", so it must not overstate.

2. **`attribution.md`, "Margin" section: state the remaining margin as headroom against the 100 ms bound, and say plainly that the flake risk remains.**
   - The section gives value ranges but never states the margin. AC1's fallback is "the PR states the remaining margin", and the ticket's own premise is 74 ms x 1.4 ≈ 104 ms.
   - Add the worst recorded value per window and its headroom:
     - CI control 74 ms, so 26 ms headroom;
     - CI probe 72 ms, so 28 ms;
     - shipped-shape throttled worst control 72 ms and overrun 85 ms, so 15 ms.
   - Add the consequence: on a ~1.4x slower host (HEL-1793) the handler alone can approach or exceed 100 ms, so an occasional red remains possible and would not indicate a regex regression.
   - The final sentence ("The control margin on a slow host is therefore the handler's cost, not the regex") names the cause, not the margin.
   - When 4.1's CI numbers land, update these figures.

### Non-blocking notes

- The "INFERENCE: a shared host stall or GC on top of a ~50 ms-class handler" for the CI 74/72 pair is labelled as inference, which is good. A simpler reading is also consistent with your own throttled data: the handler alone on a slow host reaches 60-75 ms, as at 4x. Consider naming both readings.
- `recordApi` stamps responses with Node's `Date.now()` and subtracts the browser's `performance.timeOrigin + performance.now()`. These are the same machine's wall clock, so the skew is small. It is still two clocks; the timeline is fine as a diagnostic, but do not use it for sub-10 ms ordering claims.
- The `f.dur >= 30` LoAF filter never matters, because Chromium only emits LoAF entries of 50 ms or more. This is harmless.
- `evaluation-2.md` is untracked in the worktree (the evaluator's file). The orchestrator should commit it or account for it.

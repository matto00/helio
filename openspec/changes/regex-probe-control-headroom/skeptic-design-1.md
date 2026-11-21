## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD afc2a687286a73b22660e613adef2dbb85d0d517 (planning artifacts untracked under the change dir).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/regex-probe-control-headroom/HEL-1808`.
- design.md's Context matches `e2e/hel1683-regex-main-thread.spec.ts` exactly: seed of 2 rows "a"x28+"!" with saved `(x)`
  (lines 16-61), control fill `(a+)!` + three visibility waits + `waitForTimeout(1500)` (139-158), `LONG_TASK_BOUND_MS = 100`
  (26), probe window `waitForTimeout(3000)` (161-173), overrun window (201-214).
- Driver claim "74 ms at e2e2.log:1946" CONFIRMED: `.concertino/runs/HEL-1697/evidence/scratch/e2e2.log:1946`
  `[HEL-1683 e2e] control longest long task: 74.0 ms (tasks: 74.0)` at 02:45:01Z.
- Driver claim "67 x 0.0, one 58, one 74" CONFIRMED by `grep -rhoa` over `.concertino/runs/`: 67 x 0.0, 1 x 58.0
  (`HEL-1789/.../44667845106/playwright-json-shard-5/results.json`), 74.0 x2 (the second hit is the lane's own
  `HEL-1808/evidence/premise-validation.md` quoting it, so one real occurrence).
- NOT in the plan: the same grep shows the PROBE and OVERRUN windows carry the same noise class on CI:
  e2e2.log:1947 `probe longest long task: 72.0 ms` in the very run that logged control 74 ms (a declined, server-evaluated
  probe, so not the regex); probe 57.0 and 64.0 ms elsewhere (HEL-1789 artifacts, HEL-1697 `eval2-e2e.txt`);
  `overrun longest long task: 78.0 ms` twice (HEL-1789 shard-6 results.json / skeptic-final log). All three windows assert
  the same 100 ms bound.
- Design's claim "the probe's catastrophic task is synchronous in the input handler": consistent with code —
  `frontend/src/features/pipelines/hooks/usePipelineDraftFrames.ts:184` evaluates the draft walk in a `useMemo` during the
  render the edit triggers (no timer/idle deferral), so any window containing the fill and the following render contains it.
- HEL-1789 runner record exists: `.github/workflows/ci.yml:700` writes `cpu_model:` and `:737` uploads
  `e2e-runner-shard-${{ matrix.shard }}`.
- Mutation reference `fb684d03b` is the HEL-1683 client decline commit (#1086), confirmed by `git show --stat`.
- No TODO/TBD placeholders; scope is e2e-only, avoids HEL-1796/HEL-1813 files; bound kept at 100 (C8); attribution
  before reshape with committed evidence; control-side vacuity mutation (3.3) is a good addition.

### Verdict: REFUTE

### Change Requests
1. **Cover the probe and overrun windows, not only the control.** The cited CI run logged probe 72.0 ms alongside control
   74.0 ms (e2e2.log:1946-1947), other runs logged probe 57/64 ms and overrun 78 ms, and all three assertions use the same
   100 ms bound. At ~1.4x that is the same ~100 ms flake the ticket exists to prevent, and a plan that attributes and
   reshapes only the control window will ship it. Revise:
   - design.md Decision 1 / tasks 1.2: install the LoAF + request-timeline diagnostics in all three windows (the helper is
     shared) and attribute any non-zero task in each.
   - design.md Decision 2: state explicitly what the reshape does to the probe and overrun windows (today only "identical
     window for the probe" to avoid weakening it; overrun is not mentioned), and that this must not narrow either below the
     fill + its synchronous render.
   - Decision 4 / task 3.1: record probe and overrun longest-task values per CI run alongside the control value; if they are
     not brought under the same 60 ms headroom target, the PR states their margin and cause (mirroring AC 1's escape clause).
   - Keep the existing log prefixes for the probe/overrun lines too, so the historical values stay greppable.
2. **Disambiguate task 3.1's throttled target.** Task 3.1 requires "control <= 60 ms" at 4x/6x CPU throttle, which is far
   stricter than AC 1 (CI hosts are ~1.4x) and may be unattainable when the edit's own legitimate dev-build render scales
   with throttle — leaving the executor no defined exit. State that the pass criterion is <= 60 ms at 1x locally and on the
   5 CI runs; the 4x/6x runs are diagnostic measurements whose values (and what dominates them) are recorded, with the
   escalation trigger defined (e.g. evaluator work itself > 60 ms at 1.4x-equivalent throttle -> escalate per Risks).

### Non-blocking notes
- The rare tail is ~1 in 70 runs, so 5 CI runs at 0 ms satisfy AC 1 whether or not the reshape works. Say so in the PR:
  the proof of the fix is the attribution + throttled reproduction, the CI runs are the AC's record.
- Task 3.2: a literal `git revert fb684d03b` will likely conflict with later HEL-1697 allowlist changes; a targeted scratch
  disable of the decline (as the design's "i.e." clause says) is fine — record exactly what was changed.
- Decision 2's "short settle" after the result is visible should be a named constant with its rationale in a comment.

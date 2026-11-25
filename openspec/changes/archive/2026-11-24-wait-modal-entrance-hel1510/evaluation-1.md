## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `344bde590afb0f409f704d33b1efa3157ba086fe` against live-resolved base `793802e50a8de763f905a431ca120490c372404d`.
Changed code: `e2e/hel1510-output-editor-table-overflow.spec.ts` (+12 lines). Everything else is under the change dir.

### Phase 1: Spec Review — PASS

- AC "red under forced mid-animation, green after, mutation red again": met. The committed evidence is raw logs, and I
  reproduced all three halves independently (below). The force is honest, not manufactured: it changes only
  `animation-duration` of `.ui-modal[open]`. Keyframes, easing and element stay the same, the animation is logged as
  `running` at the `limit` read, and the failure is the spec's own `toEqual([])` assertion, unchanged and with the
  `+ 0.5` margin.
- AC "20/20 normal runs": met (my run: 20 passed, 2 workers, nice -n 19, lane DB).
- AC "no tolerance / retries / timeout changes; e2e only": met. The diff adds only the wait. `test.setTimeout(90_000)`
  and `+ 0.5` are unchanged. No product code, schema or migration.
- Tasks 1.1-1.7 are all checked and match the diff. D2's target check holds: `page.getByRole("dialog")` resolves to
  the element carrying `ui-modal-in`, as the red run's `anims=[{"n":"ui-modal-in",...}]` read from that locator shows.
- C1 is honored. `stretch-sweep.txt` logs the factor, the raw resting content-right (872.000) and HEL-1613's numbers,
  and says outright that it does not prove the entrance caused the CI flake. The move from the skeptic's preferred
  5-10x to 3x is disclosed and measured. Measurement supports it: 5x and 10x did not go red.
- No scope creep.

### Phase 2: Code Review — PASS

Gates I ran myself, in WORKTREE_PATH (after `cd frontend && nice -n 19 npm ci`):
- `npm run lint`: clean (0 warnings).
- `npm run format:check`: all files pass.
- `tsc -p e2e/tsconfig.json --noEmit`: clean.
- The frontend gates (`npm test`, the frontend build) and `sbt testFull` are not triggered: no `frontend/**` or
  `backend/**` file changed.

My independent re-runs of the executor's claims. Probes were rebuilt from the committed `probe-spec*.ts.txt` in lane
scratch, with only the `./support/` import paths rewritten; nothing was written into the worktree:
- Forced 3x, no wait: **5 of 9 red** (1/3, then 4/6). Every red is `ui-select__trigger right=X limit=Y` from the spec's
  own assertion, overshoot 0.02-0.45px. The executor reported 4/4. On this box the 3x red is probabilistic, not
  reliable: it depends on how far the edge travels between the `limit` read and the control reads, and loopMs varied
  213-447ms here against 184-212ms in the executor's logs.
- Forced 3x, with the wait: **6/6 green**. Every run logs `limit=872.5 anims=[]`, so `limit` is read exactly at rest.
  This deterministic pin is the stronger evidence that the wait is load-bearing.
- Real spec `--repeat-each=20 --workers=2`: **20/20 passed**.

The non-monotonic sweep is explained and consistent. The false overflow needs edge displacement greater than 0.5px
inside the read window, and that displacement is the eased progress delta across the window. At 10x/5x the whole
curve is slowed, so the edge moves too little in ~200ms (implied moves 0.37 / 0.47 / 0.499px at 10x/5x/4x, just
under the margin). At 1x the `limit` read (~170ms of 280ms) is already past the steep front of the
`cubic-bezier(0.3, 0.9, 0.4, 1)` ease-out (implied move 0.13px). Displacement peaks between those extremes: 2-3x
(0.5-0.65px). The executor's text explains only the slow tail; the fast tail follows from the same arithmetic.

`.catch` placement: it sits on `Promise.all` rather than on each `finished`, so a cancelled animation would end the
wait at once even if another animation is still running. That does not matter for this spec. The Output editor never
passes `expandFrom` (the only callers are the panels grid/stack and PanelDetailModal), so the dialog carries exactly
one animation, `ui-modal-in`, as the probe's anims logs confirm. The two placements behave identically here. It is
only a deviation from D2's literal wording and is listed as non-blocking.

Code quality: the wait is inline, has one call site, and its comment explains why. Infinite animations are filtered
out, no cap is added, nothing is dead, and it follows `CONTRIBUTING.md`.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e runs above
used lane servers on 7053/9960, since stopped.

### Overall: PASS

### Non-blocking Suggestions
- `evidence/stretch-sweep.txt`: "the smallest-effort stretch that reproduces reliably" overstates it. An independent
  re-run measured 5/9 red at 3x. Consider recording "red in 4/4 (executor) and 5/9 (evaluator); probabilistic, with
  the with-wait run pinned at rest (`anims=[]`, `limit=872.5`) in every run". Also add the fast-tail (1x) explanation.
- `e2e/hel1510-output-editor-table-overflow.spec.ts:102`: per-animation `.map((a) => a.finished.catch(() => {}))`
  would match D2's wording and keep waiting on the other animations if one is cancelled. Today the behavior is
  identical (one animation).
- `evidence/probe-spec.ts.txt`: the comment "0.28s -> 2.8s (10x)" is stale; the default is `PROBE_X=3` (840ms).
- The raw logs for the 10x/5x/4x/2x/1x sweep points are summarized but not committed; only the 3x logs are raw.

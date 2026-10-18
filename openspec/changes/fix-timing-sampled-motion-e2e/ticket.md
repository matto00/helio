# HEL-1658: URGENT main CI red (e2e shard 4): fix timing-sampled tests hel1584 :487 and :562 and hel1260-orphan-owner-repair :108

## Description

Escalated 2026-10-17 by the owner: top priority. Main CI is red.

Main's CI on 4429d46fd (HEL-1584's merge, run 39070838899) fails **e2e (4)**. HEL-1648's PR #1056 (an unrelated change)
failed shard 4 on 3 of 3 attempts (run 39076418526):

1. `hel1584-motion-surfaces.spec.ts:562` (light): "the check pops", 0 >= 1. It reads the motion log **once**, right after
   the check becomes visible. **Fix:** `expect.poll` the log.
2. `hel1260-orphan-owner-repair.spec.ts:108`: `boundingBox().x` is null. It reads the grid item's box during HEL-1584's
   new grid entrance. **Fix:** wait for a settled layout box (non-null, and stable across 2 frames, or after the
   entrance's `getAnimations().finished`).
3. `hel1584-motion-surfaces.spec.ts:487`: "morph frames", 1 >= 2. It counts frames in a fixed time window. The morph did
   run (a hard cut gives 0 intermediate frames), so the test's sampling is the weak point, not the product. **Fix:**
   assert "more than 0 intermediate frames and no collapse toward zero" or, better, sample by animation progress
   (`getAnimations()` / ECharts animation events) rather than by rAF count. Keep the Off / reduce controls.

Logs: `/home/matt/Development/helio/.concertino/runs/HEL-1648/evidence/.concertino/scratch/HEL-1648/diag-ci-pr-shard4.log`
and `diag-ci-main.log`; also `/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/scratch-keep/e2e4.log`.

See also HEL-1651 (a hel1573 motion e2e flake on main): same class of timing-sampled motion assertions.

origin_kind: followup
origin_ticket: HEL-1584

## Acceptance Criteria

- All three tests are shown failing first under CPU throttling (Playwright CDP `Emulation.setCPUThrottlingRate` 4-6x, or
  taskset), then pass 40/40 throttled after the fix.
- Every "can fail" control from HEL-1584's evidence still fails (Off token removed -> red; hard cut -> red; missing check
  pop -> red; and so on).
- No retries, no larger timeouts, no loosened thresholds that could pass a hard cut or a missing pop.
- Green in CI on the exact merged head (shard 4 included).

## Driver scope addition (2026-10-17)

While in these files, check the rest of `hel1584-motion-surfaces.spec.ts` and HEL-1573's motion specs
(`hel1573-motion-grid-chart.spec.ts`, `hel1573-motion-primitives.spec.ts`) for the same read-once / fixed-window pattern.
Fix any that clearly share it and list them. No product-code changes unless a probe proves an app defect (then escalate).

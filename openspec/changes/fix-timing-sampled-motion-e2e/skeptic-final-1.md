## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 673f987692628237636e41790d93d74b1f6ff1f0 against live base 4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec
(resolve-review-base.sh, exit 0). Spawn guard READY. Diff: 3 e2e specs + change dir. No product code, no
playwright.config.ts change (`retries: 0`, `timeout: 30_000` unchanged).

### What I verified (with evidence)

- **C1 (no weakening).** Read every hunk. No retries, no `timeout:` options on any new `expect.poll` (default expect
  timeout). Removed `waitForTimeout`s were replaced by state polls. The fixed 2500ms wait before the add-panel pop count
  is still there, so the exact `toHaveLength(1)` keeps its window for a spurious second pop. One threshold moved: morph
  `between >= 2` became `>= 1`. The ticket's own fix text allows this ("more than 0 intermediate frames"). The change also
  adds two signals: the clock must go unfinished and then finished after the click, and the last frame at clock finish
  must be within 5% of the final bars. The collapse guard `> 0.4` is unchanged.
- **Hard-cut morph: my own adversarial probe.** Control E (duration 0) only shows the clock poll failing. That leaves
  open whether `between >= 1` alone catches a hard cut while the clock is running. I tested that case. I temporarily set
  `animationEasingUpdate: (k) => (k < 1 ? 0 : 1)` in `frontend/src/utils/chartAppearance.ts:342`, so the tween runs its
  full duration and then jumps. The run was at CDP 6x, repeat 2: **2/2 red** at
  `"intermediate frames between the old and the new bars (a morph)", Expected >= 1, Received 0` (spec :567). So the
  1-frame floor bites even when the clock is busy. Evidence:
  `/home/matt/Development/helio/.concertino/scratch/HEL-1658/skeptic-final-1/probe-step-easing.diff` and
  `.../probe-step-easing-cdp6.txt`. Reverted with `git checkout`, tree clean.
- **Missing pop.** The save-check poll is `>= 1` with the default timeout. Control F (pop class removed) is red in both
  themes at the new poll (`control-F-missing-check-pop.txt`, Received 0 after 5000ms). The add-panel pop is polled
  `>= 1` and then pinned to exactly 1.
- **Null/unstable box.** `settledGridItemBox` returns true only when the box is non-null and within 0.5px of the
  previous read. A box that stays null or keeps moving never satisfies it, so the test times out red. The product
  assertions (position survives a reload, <2px; repair POST count; stored layout) are unchanged.
- **HEL-1584 controls A–D.** The tests they exercise (runMatrix lift/Off, width, expand, palette label gap) are
  untouched by this diff. The recorded transcripts are red: A `the lift token resolves to 1` x2, B width `toBeLessThan`
  x2, C `toHaveLength`, D `label opacity minus first-row opacity`.
- **First-visit `>= 3` poll vs the later negative.** The world has exactly 3 cards, and there is a 900ms wait plus a
  second `clearLog` before the warm-switch `toEqual([])`. A late tail of entrances cannot contaminate the negative.
- **Fresh throttled run (CDP 6x, harness applied temporarily, then reverted):**
  `/home/matt/Development/helio/.concertino/scratch/HEL-1658/skeptic-final-1/green-cdp6.txt`: 6 passed, 1 failed. The
  failure was :493 at **unchanged line 500** (`.chart-panel__canvas canvas` toBeVisible 5s), the first chart on a freshly
  started server. The evaluator saw the same failure, at the same line. A re-run of :493 and the grid-enters test (:345),
  repeat 3: **6/6 passed** (`.../green2-cdp6.txt`). All of hel1260 (4 tests) and :600 light/dark passed.
- **`:24` (now :54).** I agree with the evaluator: the red-then-green claim is not shown at a matching throttle. It is a
  sweep item, not an AC test, and it passed here at 6x.

### Verdict: CONFIRM

### Non-blocking notes
- The pre-existing line-500 canvas wait has now tripped twice under 6x on a cold server (once for the evaluator, once
  for me). It is outside this diff, but it can make the AC's "40/40 throttled" claim look shaky. Track it as a follow-up
  alongside HEL-1651.
- The PR body should correct the :24 claim (red only at 30x, green only at 20x).
- The `settledGridItemBox` comment says "one animation frame apart". The real interval is one rAF plus the poll's
  back-off.
- AC4 (green CI on the merged head, shard 4) is still open and belongs to delivery.

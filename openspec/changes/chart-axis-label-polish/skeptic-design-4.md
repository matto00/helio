## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)
- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`. HEAD is 559c4be77 (= base). The only untracked content is the change dir.
- **Ground truth read:** ticket.md, proposal.md, design.md, tasks.md and specs/heatmap-histogram-charts/spec.md; `frontend/src/utils/histogramBins.ts` (in full); `heatmapHistogramOptions.ts:95-160`; `chartAppearance.ts:120-136`; skeptic-design-3.md.
- **Round-3 item 1 (single bin): fixed.**
  - Design D2 now says a single bin keeps `formatChartNumber(start)`. The spec says "A single bin SHALL keep the shared chart number format for its value", and it has the scenario 1700000000.5 -> "1700000000.5". Task 3.1 lists that test.
  - Simulation: 1700000000.5 renders "1700000000.5". This is identical to today's `histogramBinLabel`, so there is no regression.
- **Round-3 item 2 (zero width / distinctness bound): fixed.**
  - D2 computes `width = (last.end - first.start) / bins.length`.
  - In `binHistogram`, `max > min` makes the span a positive double. `width <= 0` therefore only arises from subnormal underflow, and that case is handled with `d = 20`.
  - The spec bounds its distinctness promise by width >= 1e-19 and width >= 1e-13 × max|edge|.
  - I simulated the exact D2 rule, using the real `binHistogram` logic, cap/tol/negative-zero handling and `Intl` formatting, over 2 random sweeps:
    - 148,698 in-bound cases across magnitudes 1e-18..1e18 with bin counts 2-100: 0 adjacent duplicate labels.
    - 200,000 cases targeted at the corner where width ≈ 1e-19..1e-16 and |edge| ≈ width/1e-13: 0 duplicates.
- **Spec scenarios reproduced:**
  - 0-10/4 gives "0.0 to 2.5" … "7.5 to 10.0".
  - 0-10/5 gives integer labels.
  - -0.1..0.5/6 has no "-0", and the zero edge reads "0.0".
  - 1700000000..1700000002/8 uses 2 places, all distinct.
  - 0..1e-6/4, 0..0.01/3 and 0..1e-12/4 each use one precision and are distinct.
  - 1234567890.12..15/3 is distinct.
- **Spec vs D2 semantics agree:** "fewest places (0 to 20) … shown exactly", "never more than one place beyond the first significant decimal of the bin width" (= `cap`), "within one millionth of a bin width" (= `tol = width*1e-6`), "single bin keeps the shared chart number format", and the distinctness bound (identical in both). The spec's "bin width" equals D2's span/n for equal-width bins.
- **Non-blocking round-3 note:** D5 now `.catch`es each `finished` and returns `undefined`.
- **New defects:** none found. D1, D3, D4, D6 and the task mapping to AC1-AC5 are unchanged from round 3. I did not re-litigate them.

### Verdict: CONFIRM

### Non-blocking notes
- D2's parenthetical "SINGLE bin (`bins.length === 1`, zero width)" is slightly inaccurate. `binHistogram` also returns one bin with `start !== end` when a stored `binCount: 1` reaches it: the editor limits the count to 2-100, but `binHistogram` accepts values >= 1. The rule still applies the same way: `formatChartNumber`, "a to b", exactly as today, and that matches the spec. The executor should branch on `bins.length === 1`, not on zero width.
- The spec does not describe the `width <= 0` -> d=20 path. That path is reachable only with subnormal spans, it lies outside the distinctness bound, and the spec makes no promise there. Acceptable.

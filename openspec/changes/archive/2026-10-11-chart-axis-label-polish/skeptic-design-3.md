## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 559c4be77d1915c03aec687d1d6d8ffcd42b3c9c, which equals `origin/main`. The change dir is untracked, so there is no code diff yet. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`.

### What I verified (with evidence)

**Round-2 CR1 (multi-bin tolerance): FIXED for the multi-bin path.**
- I simulated D2 exactly as written:
  - edges come from `binHistogram` (`frontend/src/utils/histogramBins.ts`: `min + i*width`, last end = `max`);
  - `width = bins[0].end - bins[0].start`;
  - `cap = clamp(1 - floor(log10 w), 0, 20)`;
  - the smallest passing `d` under `tol = width*1e-6`;
  - round, normalise `-0`, then `Intl` with min = max = d and no grouping.
- Every row of my round-2 counterexample table is now distinct:

| Case | Result |
|---|---|
| 1700000000..1700000002 / 8 | d=2, "1700000000.00 to 1700000000.25" … |
| 1234567890.12..15 / 3 | d=4, distinct |
| 0..1e-12 / 4 | d=14, distinct |
| 1..1.000000001 / 4 | d=11, distinct |
| 0.3..0.3000000001 / 2 | d=11, distinct |
| 1e-20..2e-20 / 2 | d=20, distinct |

- The spec scenarios reproduce exactly: 0–10/4, 0–10/5, −0.1..0.5/6 (no "-0"), 0..1e-6/4 and 0–0.01/3.
- Floating-point noise on large-magnitude edges, as asked:
  - 1700000000..1700000002/10 has noisy edges (w = 0.20000004768…): d=1, distinct.
  - 1700000000..+0.001/4 falls back to cap 5: distinct.
  - Noise can only make a low `d` fail. That pushes `d` toward `cap`, whose step `10^-cap <= w/10` keeps adjacent edges apart. So noise is benign while it stays well below `w`.
- Randomised test: 20,000–40,000 cases per band, magnitudes 1e-18..1e18, 2–50 bins, widths >= 1e-19. There were **zero** adjacent duplicates and zero "a to a" labels for every width/|edge| ratio from 1e-3 down to 1e-14 (script in my scratchpad, `rnd2.js`).
- D2's corrected distinctness argument is sound. A passing `d < cap` puts the rounded edges on a 10^-d grid, within 2e-6·w of the true spacing. A zero difference would need w ≤ 2e-6·w, which is impossible.

**Round-2 CR2 (D5 hang): FIXED.**
- The animation is on the `<dialog>` itself:
  - `Modal.tsx:211` puts `ui-modal` on the `<dialog>`;
  - `Modal.css:12-19` sets `.ui-modal[open] { animation: ui-modal-in var(--transition-slow) backwards }`, with `--transition-slow: 0.28s cubic-bezier(...)` at `theme.css:65`.
- A no-arg `el.getAnimations()` therefore includes it. It excludes descendants (the infinite `ui-skeleton-shimmer`) and pseudo-elements.
- `::backdrop` has no animation anyway: the only `animation` in `Modal.css` is line 19, plus a colour `transition` at :180. So there is no `::backdrop` concern.
- `CSSAnimation.animationName` is a standard property that Chromium supports, and it returns the keyframes name `ui-modal-in`.
- With `backwards` fill, a finished animation leaves `getAnimations()`. The design correctly treats an empty list as settled.
- `theme.css:454` reduced-motion sets duration to 0.01ms. No spec emulates reduced motion here, so it is irrelevant.
- The rect-stability alternative matches the existing pattern at `e2e/support/touchTargetProbe.ts:227-263`.
- The mandatory red (a) (wait removed → 43.34 fails at 43.5) proves whichever option is chosen.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts` checks:
  - the 43px sites are at :495 and :504;
  - the `_componentsViews` read is at ~:299-306;
  - ECharts 6.1.0 is at `package-lock.json:6200-6201`.

**New defect: the single-bin path keeps the magnitude-relative tolerance that round 2 refuted.**
- I simulated a single bin (min === max) with D2's `tol = 1e-9*max(1,|e|)`, cap 20:

| Single value | Planned label | Today (`formatChartNumber`, max 2 dp) |
|---|---|---|
| 1700000000.5 | **"1700000001"** | "1700000000.5" |
| 10000000.01 | **"10000000"** | "10000000.01" |
| 1234567890.12 | **"1234567890"** | "1234567890.12" |
| 99999.999999 | **"100000"** | "100000" |
| 0.1234567891234 | "0.12345679" | "0.12" |
| 1e-20 | "0" | "0" |

- The first three are regressions against today's output, for plausible constant columns: a single epoch-second-with-fraction value, or a price.
- They also contradict the spec, which says a single bin "uses the fewest places up to 20 that show its value exactly". 1700000000.5 is not shown exactly as "1700000001", and the label is simply wrong.
- Round 2 explicitly flagged that this tolerance "also breaks the single-bin clause". The revision kept the single-bin rule unchanged and did not reconcile the spec wording.

**New defect (smaller): the spec's distinctness qualifier is the wrong bound, and D2's `width` can compute 0 for a multi-bin histogram.**
- The spec says that for bin widths >= 1e-19, adjacent bins SHALL never share a label. That is false when the bin width approaches the floating-point spacing of the edges:

| Case | width / ulp(edge) | Width computed as | Labels |
|---|---|---|---|
| 1..1+2^-52, 4 bins | w ≈ 5.6e-17 ≥ 1e-19 | 0 | "1", "1", "1 to 1", "1" |
| 1e16..1e16+4, 8 bins | w = 0.5 < ulp 2 | 0 | adjacent duplicates |
| 1.7e18..1.7e18+1000 ns, 8 bins | w = 125 < ulp 256 | 0 | adjacent duplicates |
| 1e15..1e15+1, 7 bins | ulp 0.125 | — | a bin labelled "1000000000000000.40 to 1000000000000000.40" |

- In each case, `bins[0].end - bins[0].start` computes 0, so D2 silently takes the single-bin tolerance path for a multi-bin chart.
- The root is that `binHistogram` collapses edges (binning is a non-goal). The data is contrived, so this is not a realistic UX bug. It is, however, a normative SHALL with a stated bound that does not hold.
- In my random runs the real precondition is relative: zero failures at width/|edge| ≥ 1e-14.

**Unchanged, re-checked briefly:**
- D1: interval/hideOverlap is added at the merge point, with a rendered proof and an escalate-if-unsupported rule.
- D3 and D4 copy/comment targets; D6.
- Tasks 3.1/3.2 cover the new cases.
- AC1–AC5 each have a task. No placeholders.

### Verdict: REFUTE

### Change Requests

1. **D2 + spec + task 3.1: fix the single-bin label rule.** Today `1e-9*max(1,|e|)` renders a single value of 1700000000.5 as "1700000001", 10000000.01 as "10000000" and 1234567890.12 as "1234567890". That is wrong output, a regression from today's `formatChartNumber`, and it contradicts the spec's "show its value exactly". Pick one option and make design and spec say the same thing:
   - (a) **Keep `formatChartNumber` for the single bin.** This is the simplest option and causes no regression: a lone label has no cross-label consistency to preserve. The spec then says the single bin uses the shared chart number format.
   - (b) **Use a resolution-based exactness test.** For example, take the fewest `d <= 20` at which `Number(e.toFixed(d)) === e`, falling back to 20. The spec then states that rule rather than "exactly" with an unstated tolerance.

   Either way, add a task-3.1 unit test: a single value 1700000000.5 must not render "1700000001".
2. **D2 + spec: make the multi-bin width and the distinctness bound honest.**
   - Compute `width` for `bins.length > 1` as `(last.end - first.start) / bins.length`, not `bins[0].end - bins[0].start`, so a multi-bin chart never takes the zero-width path.
   - Qualify the spec's "never share an identical label" with the bound that actually holds. For example: "for bin widths of at least 1e-19 and at least 1e-13 × the largest absolute bin edge". Below that, adjacent edges can coincide in floating point, which is outside this change's binning non-goal.
   - Alternatively, if the planner prefers, drop the numeric bound and state that the guarantee assumes distinct bin edges.
   - No test is needed at the ulp-scale boundary.

### Non-blocking notes
- D5: the `finished` promise rejects (AbortError) if the animation is cancelled, for example if the sheet closes mid-animation. That is unlikely in this flow. Catching it, or returning `undefined` from `evaluate`, avoids a confusing failure.
- At very small widths, `d` up to 20 shows the binary expansion (for example "0.00000000000000000001 to 0.00000000000000000001" for bin 1 of 1e-20..2e-20/2, whose labels are still distinct across bins). Within-bin "a to a" can occur at the 1e-20 extreme, below the spec's 1e-19 floor. This is acceptable.

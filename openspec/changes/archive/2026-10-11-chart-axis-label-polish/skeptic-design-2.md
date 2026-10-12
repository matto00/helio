## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 559c4be77d1915c03aec687d1d6d8ffcd42b3c9c, which equals `origin/main`. The change dir is untracked, so there is no code diff yet. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`.

### What I verified (with evidence)

**Round-1 CR1 (negative zero): FIXED.**
- I simulated D2 exactly as now written: cap = clamp(1 − floor(log10 w), 0, 20); the smallest exact `d` under tolerance `1e-9*max(1,|e|)`; round, then `x === 0 ? 0 : x`; then `Intl.NumberFormat` with min = max = d and no grouping. Edges come from `utils/histogramBins.ts` (`min + i*width`, last end = max).
- −0.1..0.5/6 → d=1: "-0.1 to 0.0", "0.0 to 0.1" … "0.4 to 0.5".
- −0.1..0.6/7 and −0.2..0.5/7 also contain no "-0".
- `Math.round(-1.39e-16)` is −0, and the normalisation catches it. The spec scenario and task 3.1 cover this case.

**Round-1 CR2 (cap 6 vs the SHALL), at the cited case: FIXED, but the SHALL is still false in general (see CR1 below).**
- 0..0.000001/4 now gives cap 8, d 8, and four distinct labels ("0.00000000 to 0.00000025" …).
- The spec scenarios are reproduced exactly:
  - 0–10/4 → "0.0 to 2.5" … "7.5 to 10.0"
  - 0–10/5 → "0 to 2" … "8 to 10"
  - 0–0.01/3 → d=4, distinct
- Large-magnitude edges, as the orchestrator asked. The 20-place cap itself is harmless:
  - When |e| is large, d=0 already passes, so `e*10^d` never overflows.
  - 1e6..1e6+1/3 gives d=2 with distinct labels.
- The defect is the **exactness tolerance**, not the cap. Simulated output:

| Case | cap | d | Labels |
|---|---|---|---|
| 1700000000..1700000002 / 8 (epoch seconds over 2 s) | 2 | 0 | "1700000000 to 1700000000", "1700000000 to 1700000001", "1700000001 to 1700000001" ×3 … **adjacent duplicates** |
| 1234567890.12..1234567890.15 / 3 | 4 | 0 | all three "1234567890 to 1234567890" |
| 1..1.000000001 / 4 | 11 | 9 | "1.000000001 to 1.000000001" ×2 adjacent |
| 0..1e-12 / 4 | 14 | 0 | all four "0 to 0" |
| 0.3..0.3000000001 / 2 | 12 | 1 | "0.3 to 0.3" ×2 |
| 1e-20..2e-20 / 2 | 20 | 0 | "0 to 0" ×2 |

- Mechanism: `1e-9*max(1,|e|)` is an absolute floor of 1e-9 that grows with |e|. Whenever the bin width is at or below roughly twice that tolerance, a `d` below `cap` passes "exactness", and the edges collapse when rounded.
- Consequences:
  - Raising the cap to 20 is unreachable for any width below about 2e-9.
  - D2's justification ("`cap` is one place past … so adjacent edges always differ at `d`") conflates `cap` with `d`, because `d` can be well below `cap`.
  - The spec's normative "Adjacent bins SHALL therefore never share an identical label" is false for realistic data: the epoch-seconds row is a plausible histogram.
  - The same tolerance also breaks the single-bin clause "fewest places up to 20 that show its value exactly": a single bin at 1e-20 renders "0".
- In round 1 I called the tolerance "fine for realistic magnitudes". That was wrong for large magnitudes. The new 20 cap removed the cap-based counterexample and exposed this one.

**Round-1 CR3 (D5 settle mechanism): FIXED as to the target. One option introduces a new hang risk (CR2 below).**
- D5 now names `ui-modal-in` and the 0.985 scale, and explicitly forbids `settleTransitions.ts`.
- `Modal.tsx:211` puts the `ui-modal` class on the `<dialog>` itself. `Modal.css:12-19` animates `.ui-modal[open]`, so the animation is on the dialog element, and `dialog.getAnimations(...)` does include it.
- `OutputEditorSheet.tsx:15,288` uses the shared `Modal`. `OutputEditorSheet.css` has no animation or transform override.
- The proof is now mandatory, with two reds: wait removed, and source CSS undersized. That resolves my round-1 non-blocking note.
- New defect: the `{subtree: true}` option waits for every animation in the dialog, including infinite ones.
  - The sheet's preview renders `ChartRenderer`, which lazy-loads `ChartPanel` (`ChartRenderer.tsx:18`) behind `<Suspense fallback={<PanelSuspenseFallback/>}>` (`:93`).
  - That fallback renders `PanelBodySkeleton` → `Skeleton` (`SuspenseFallback.tsx:12-17`, `PanelBodySkeleton.tsx:1,23`).
  - `Skeleton.css:16` is `animation: ui-skeleton-shimmer … linear infinite`.
  - The outputs gallery card renders no chart (no `ChartRenderer` in `OutputGalleryCard.tsx`), so the first sheet open after `page.goto` can be the first `ChartPanel` import.
  - The Playwright configs set no `reducedMotion`, and the spec calls no `emulateMedia` (grep, zero hits).
  - If the subtree snapshot is taken while the chunk is suspending, `Promise.all(...map(a => a.finished))` never resolves, and the test hangs to its timeout.
  - I did not reproduce this in a browser (no server work this gate). It is a structural hazard derived from source, not an observed failure.

**Unchanged since round 1, re-checked:**
- D1's merge points and ECharts 6.1.0 `hideOverlap` behaviour; D3 and D4 citations; D6.
- Task 3.2 now includes the histogram-y negative check, as noted in round 1.
- The premise-validation file agrees with every line reference.
- AC coverage is unchanged and complete. No placeholders.

### Verdict: REFUTE

### Change Requests

1. **D2 and spec: make "never identical" actually hold, or qualify it.** The `1e-9*max(1,|e|)` tolerance lets `d` drop below what distinctness needs. Pick one option and make design, spec and tests agree:
   - (a) **Scale the tolerance to the bin width**, not the edge magnitude (for example `|round(e,d) − e| <= 1e-6 * width`), so that "exact at d" implies the rounded edges stay about one width apart. Keep the single-bin case on its own rule. Re-run my table: epoch 1700000000..1700000002/8 should give d=2 ("1700000000.00 to 1700000000.25" …), and 1234567890.12..15/3 should give 4 distinct places.
   - (b) **Keep the tolerance and qualify the SHALL**, along with the D2 sentence "adjacent edges always differ at d". For example: "…when the bin width exceeds 1e-9 × the largest |edge|".

   Either way, add a unit test in task 3.1 for the boundary you choose. Use the epoch-seconds case (1700000000..1700000002, 8 bins) as the realistic one. Correct D2's "cap … so adjacent edges always differ at d" reasoning, which is wrong as written.
2. **D5: drop the `{subtree: true}` option, or scope it to `ui-modal-in`.** The dialog subtree can contain the preview's infinite `ui-skeleton-shimmer` (lazy `ChartPanel` → `PanelSuspenseFallback` → `Skeleton`), whose `finished` never resolves. Use one of:
   - `el.getAnimations()` with no subtree, filtered to `animationName === "ui-modal-in"` (the scale is on the dialog itself, so no subtree is needed);
   - the rect-stability wait already offered.

   Return `undefined` from the `evaluate` rather than the `Animation[]`.

### Non-blocking notes
- With a width-scaled tolerance, `d` can reach 17 or more for tiny widths on non-zero edges. `Intl` formats the exact binary value at that precision (for example, 0.1 at 20 places is "0.10000000000000000555"). That is correct, but it looks ugly at extreme widths. It is acceptable, and no test should assert pretty output there.
- Pre-rounding with `Math.round` rounds −x.x5 toward +∞ (−0.25 → −0.2) while +0.25 → 0.3. This is consistent within a chart and not worth changing.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD d305ab95cb53e387c4b548ea6601856f0aecf6cf against the live-resolved base beb94adfe49759ebc8e180500130a032fdfac3b4 (`resolve-review-base.sh`, origin/main).
Evidence root (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/skeptic/`

### What I verified (with evidence)

- **Diff scope.** The diff touches `HomeOpeningLine.tsx` (span `ui-skeleton home-opening__ghost-bar` inside the hidden ghost; the `<Skeleton>` bar is removed; there is a direct `Skeleton.css` import), `HomePage.css` (the inline/clone/visible/transparent rule plus a six-layer rounded-rect mask; the old absolute bar rule and `position: relative` are removed), two unit files, the new e2e spec and change artifacts. `Skeleton.tsx`/`Skeleton.css` are unchanged (`git diff --stat beb94adfe HEAD -- frontend/src/shared/ui/` is empty). The rule body has no background, animation or keyframes, so the shimmer and the reduced-motion and motion-Off flat fills come from Skeleton.css unchanged (C3).
- **AC1: one bar per line at 431-604px, light and dark.** I wrote my own probe (`probe.cjs`). It holds home-summary, dashboards, pipelines and runs, and runs every width from 320 to 1300 on host Chromium in light and dark, and in the helio1678-ci and helio1678-dv browsers in light. At all 981 widths, `getClientRects()` on the bar equals the ghost's line count. That count is 2 at 431-604px in Sans.
- **Skeleton look, judged in the running app with default motion (the shimmer).** I paused the `ui-skeleton-shimmer` animations at 10%, 35% and 60% and took screenshots at 431, 500, 604 and 1280, light and dark, on host, ci and dv. Each line has its own rounded bar with a clear gap between bars, and the last line's bar is shorter, like a paragraph skeleton. The bars use the same tint, sheen and radius as the dashboard-card and run skeletons beside them, in both themes. In dark, the shimmer is visible inside each bar on its own. The 1280 bar is one sentence-width bar (the D3 change from the old `min(520px, 80%)`, which reads correctly). Persisted: `shots/host-light-500-p0.35.png`, `shots/host-dark-500-p0.35.png`, `shots/host-light-604-p0.1.png`, `shots/host-light-431-p0.6.png`, `shots/host-dark-1280-p0.6.png`.
- **AC2 / C2: zero layout change.**
  - **Sweep, re-run by me** (the evaluator had not). The executor's `vsweep2.cjs` copy (only the credentials differ from the archive tool, checked by diff) ran in fresh `helio1678-ci` and `helio1678-dv` run-server containers. Light and dark both show "differing widths: none (of 981)", with CDP-proven faces Schibsted Grotesk vs Liberation Sans (ci) and vs DejaVu Sans (dv). Persisted: `sweep-ci.out`, `sweep-dv.out`.
  - **Head vs base markup, a stronger check than the sweep.** The sweep only compares web font with fallback, so it would miss a change that shifts every width by the same amount. My probe replaces the span in place with a plain text node, which is the base markup, and compares ghost heights at every width from 320 to 1300. The result is 0 differing widths of 981 on host (light and dark), ci and dv.
  - **hel1665 0px series, re-run by me.** All four files pass: 48 + 42 = 90 (`e2e-b.txt`, `e2e-c.txt`).
- **New spec, hel1678 and hel1572, re-run by me:** 63 passed (`e2e-a.txt`). These include the new spec's 44.
- **Red first (C1).** Commit 55fb1bc36 touches only the e2e spec, the two unit test files and change artifacts; no implementation file. `evidence/red-base.txt` shows "44 failed". For mutations I relied on the evaluator's independent scratch re-run, whose outputs exist with counts (slice: 40 failed, the 4 passing being the one-line widths; hidden: 44 failed; no mask: 44 failed; absolute bar = base: 44 failed). These match `mutations.txt`.
- **Reduced motion.** The spec's `os` and `off` tests assert `animation-name: none`, `background-image: none` and a background colour equal to `--app-surface-soft`, still with 2 bars of the same geometry. This is green in my run.

### Judgment: running the e2e geometry assertions under reduced motion

The choice is acceptable and leaves no gap that matters:

1. The bar's thickness, gap and corners come only from the mask. The mask is static and does not reference `background` or `animation`. Motion changes only `background-position` (or swaps the gradient for a flat fill), and that is painted under the same mask. Geometry measured on the flat fill is therefore the geometry of the shimmering bar.
2. The default-motion tests still pin everything that defines the shimmering look, at 10 widths in both themes:
   - `animation-name: ui-skeleton-shimmer`
   - a gradient `background-image`
   - `clone` on both properties
   - a mask that is not `none`
   - one fragment per line
3. The stated reason is real. In light, the gradient runs `--app-surface-soft` to `--app-surface-raised` around the page colour, so parts of a bar match the page at some animation phases. My paused-phase screenshots show this, for example the left of line 1 at 604 p0.1. It is the shared recipe's own behaviour against the page background, and the old single bar had it too. It is not a regression.
4. I covered the untested remainder (pixels under shimmer) by eye at three phases, four widths, two themes and three browsers.

### Verdict: CONFIRM

### Non-blocking notes
- Optional hardening: one default-motion geometry test with the animation paused at a fixed phase in dark (where the bar never matches the page), to pin the shimmering bars by pixels as well.
- Evaluator's DRY note stands: the mask is written twice (`-webkit-mask-*` and `mask-*`). A custom property holding the layer list would halve the rule. HomePage.css is far over the ~400-line split threshold; mention it in the PR.
- The gate chain recorded no mtime-dependent evidence, so there is no gate defect to record.

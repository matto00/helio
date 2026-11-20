## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD beb94adfe49759ebc8e180500130a032fdfac3b4 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

**Round-1 change requests: are they really addressed?**
- CR1 (thickness at design time): addressed. D2 now has numeric targets (0.8em ±1px, gap >= 8px, corners `--app-radius-sm`) and a concrete per-fragment rounded-rect mask. Promoted to C4. The old "STOP if gap < 4px" fallback is replaced by a measured mechanism. Not just re-worded.
- CR2 (assertion that catches merged bars): addressed. D4 adds a thickness/gap scan per fragment at 431/480/604 and 320/375/430, light and dark, plus mutation (c) "drop the mask". D1 now says correctly that `display: inline` gives per-line painting and `clone` gives per-fragment radius, gradient and mask. Each mutation names the assertion that catches it.
- CR3 (explicit Skeleton.css dependency): addressed in D1 and task 3.1 (side-effect `import "../../../shared/ui/Skeleton.css"`, path checked: it resolves to `frontend/src/shared/ui/Skeleton.css`), plus a unit/source assertion.
- CR4 (name the browser): addressed in task 1.1 (record the Playwright 1.55 bundled Chromium build string, and re-measure in helio1678-ci/dv with fonts blocked).

**D2 mechanism, probed.** I built D2's composed mask literally: two `linear-gradient(#000,#000)` cross layers plus four `radial-gradient(circle at <corner>, #000 6px, transparent 6px)` 6x6 corner tiles. Positions are `calc(50% ∓ b/2 ± r/2)`, which is correct for percentage positioning of an r-tall tile. I applied it to the D1 span in HeadlessChrome 156 (MCP browser, not Playwright 1.55 Chromium; task 1.1 still owns that measurement). Flat fill, 476px and 380px wide. Probe page: `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/probe-r2.html`.
  - Layout neutral: ghost height is still 60px at 24px (2 lines) and 50px at 20px. Fragment rects are the same as without the mask. Computed `box-decoration-break` and `-webkit-box-decoration-break` are both `clone`.
  - I scanned a pixel column at x=100 (screenshots below):
    - 24px Schibsted: bars rows 17-35 and 47-65, so **19px thick with an 11px gap**.
    - 24px Liberation-matched fallback: 107-125 and 137-155, **19px with an 11px gap**.
    - 20px: 287-302 and 312-327, **16px with a 9px gap**.
    - All within 0.8em ±1px and >= 8px. The light and dark scans are identical.
  - Corners: the per-pixel grid at line 1's top-left shows a quarter-circle. (13,18) is background and (18,17) is bar colour, so D4's corner check holds as written. The mask applies per fragment: line 2's band and corners match line 1's.
  - The DejaVu face is not installed on the host (`SG Fallback DejaVu:error`), so the dv face is unmeasured here. Task 1.1 measures it in helio1678-dv, which is appropriate.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/skeptic-r2-mask-light.png` and `/home/matt/Development/helio/.concertino/runs/HEL-1749/evidence/.concertino/scratch/HEL-1749/skeptic-r2-mask-dark.png`.
- **Fair reading of "matching the existing skeleton look"?** Yes. This is design judgment within the plan's authority, not an owner question. The bar keeps the shared recipe (tokens, radius, shimmer, reduced-motion fill), and today's bar is `--text-xl` (20px). 0.8em gives 19.2px at desktop and 16px at phone, where a 20px bar would leave only a 5px gap in a 25px line box. Sibling precedent: `.home-card__name--skeleton .ui-skeleton` also lays a bar over hidden text. The owner sees the screenshots at the final gate.
- **D4 would catch the failure modes.**
  - (a) Drop clone: under `slice` the mask spans the concatenated strip, so line 2's left end and line 1's right end lose their rounding. The line-2 corner check and the computed-style assertion catch it.
  - (b) Drop `visibility: visible`: nothing is painted, so the geometry scan and computed visibility catch it.
  - (c) Drop the mask: measured in round 1 as 29px bars with a 1px gap, so the thickness/gap assertion catches it.
  - (d) Restore the absolute bar: the "only one `ui-skeleton`" and fragment assertions catch it.
  - The background contrast is tiny: flat surface-soft vs `--app-bg` differs by 7 per channel in both themes. The scan therefore needs a low threshold (I used >=2). See notes.
- No e2e selects `.home-opening__ghost` or `.home-opening__skeleton-line` (grep of `e2e/`: zero hits). The unit tests do, and the plan updates them.

**New defect found.**
- D4's unit bullet and task 3.2 ask `HomePage.css.test.ts` to assert "no `@keyframes`/`animation` ... in HomePage.css". HomePage.css already has `@keyframes tl-nudge` (line 481) and `animation: tl-nudge ...` (line 497, HEL-1584 timeline nudge). As written, the assertion cannot pass at head without deleting an unrelated shipped animation. It would also be "red on base" for the wrong reason, which contaminates the C1 red evidence. A competent implementer could read this two ways: delete or weaken the nudge, or silently narrow the assertion.

### Verdict: REFUTE

### Change Requests

1. **design.md D2 last bullet and D4 "Unit" bullet; tasks.md 3.2:** re-scope the "no shimmer outside Skeleton.css" unit assertion so it can pass without touching HEL-1584's `tl-nudge`. For example:
   - HomePage.css declares no `ui-skeleton-shimmer` and no keyframes other than `tl-nudge`.
   - The `.home-opening__ghost .home-opening__ghost-bar` rule body has no `background`, `animation` or `@keyframes`.
   - No `background` declaration anywhere in HomePage.css uses `linear-gradient`.

   State explicitly that `tl-nudge` is unrelated and stays untouched.

### Non-blocking notes

- Corner antialiasing: `#000 6px, transparent 6px` gives an aliased quarter-circle. Border-radius elsewhere is antialiased, but at 7-level contrast the difference is invisible in practice. If the executor softens the stop (e.g. `calc(r - .5px)` to `calc(r + .5px)`), D4's corner pixel check must allow partial alpha (threshold, not exact background).
- The pixel scan must state its threshold. The bar-vs-background difference is about 7/255 in the flat fill, in both themes, so "non-background" means a diff >= 1-2, not a perceptual threshold.
- Centring the band with `background-position`-style percentages works because the inline box height is the content area. No padding may be added to the span, or the band, positions and line boxes all shift.
- The Mono "two lines at 1280" claim is not load-bearing: the assertion is fragment count == line count, whichever it is.
- Scratch-only probes; no tracked file modified.

## 1. Docs

- [x] 1.1 Read `DESIGN.md`'s current `::after` clause (Control-metrics section,
      line ~207) and confirm the exact surrounding sentence to extend
- [x] 1.2 Re-verify all four ground-truth numbers against
      `openspec/changes/archive/2026-08-21-anchor-mobile-command-bar/design.md`,
      `evaluation-1.md`, and `tasks.md` before writing any new sentence (8px
      per-side extension, 8px→16px gap fix, 35.75px broken / 43.75-44.5px correct
      readings, 0.25px bisection step)
- [x] 1.3 Extend the `::after` clause in `DESIGN.md` to state: the per-side
      extension formula `(44 - controlSize) / 2` with the 28px→8px worked example;
      the minimum-gap rule (>= 2x the per-side extension); that
      `getComputedStyle(el, "::after").width` and neighbouring-painted-box sampling
      cannot detect overlap, and `elementFromPoint` bisection is the required
      verification; the legitimate sub-44px abutting-region reading (~43.75px at a
      0.25px step) with the epsilon it requires, and the explicit warning against
      widening the gap to compensate
- [x] 1.4 Confirm the existing `44px` tap-target-floor sentence in the same
      paragraph is unchanged and still reads consistently with the new addition
- [x] 1.5 Proofread: wrap prose per the surrounding section's line style, no
      unverified numbers, no claim not traceable to HEL-772's own design.md/
      evaluation reports

## 2. Verification

- [x] 2.1 Diff-review `DESIGN.md` against the 4 acceptance-criteria bullets in
      `ticket.md`, confirming each is satisfied by an actual sentence, not merely
      implied
- [x] 2.2 Confirm no code, test, or non-`DESIGN.md` file was touched

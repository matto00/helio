# Measurements (HEL-1746)

## Meta row tiers with the Ask button (task 3.1a)
The tier hook measures the row's CONTENT width: the border-box width minus 40px of padding (evaluation-1.md's probe: `content = rowW - 40` at
every width; an earlier draft of this file said 36px, which was wrong).

Method: a temporary Playwright spec (deleted) loaded a dashboard at viewport widths stepping down in view mode and read the row's border-box
width, its overflow, the actions group's overflow, the facts column width (`leftW`) and which controls were present. Two raw files are kept:
`.concertino/scratch/HEL-1746/measure.txt` (12 lines, one sampling, viewports 1300 down to 1190, taken before the constants changed) and
`measure-after.txt` (12 lines, viewports 1230 down to 1120, taken after). Every line quoted here is verbatim in the file named.
- `measure.txt`: `M view 1200 {"rowW":896,...,"leftW":393,"editLabel":"Edit layout",...}` is the last labelled line, and
  `M view 1190 {"rowW":886,...,"leftW":497,"editLabel":"",...}` is the first icon-only line. No overflow on any of the 12 lines (`"overflow":0,"actionsOverflow":0`).
- `measure-after.txt`: `M view 1230 {"rowW":926,...,"leftW":423,"editLabel":"Edit layout",...}` is labelled and `M view 1220 {"rowW":916,...,"leftW":527,"editLabel":"",...}` is
  icon-only. No overflow on any of the 12 lines.

These single samples were taken 250ms after navigation, were not repeated, and their switch widths do not line up with the constants (a 860 content
width is a 900 border box), so they are NOT what the constants rest on and should not be read as the thresholds. What they do show is that the row
never overflowed. The thresholds are confirmed by the evaluator's own probe (below).

Why the constants moved: Ask adds a 28px icon button plus a gap to the actions at tiers 0 and 1, about 40px, so `iconOnly` 820 -> 860 and `kebab`
640 -> 680 (both +40) keep the facts column the room it had before Ask. `countOnly` stays 520 (Ask has moved into the kebab by then). This is the
design reasoning, not a number read from the files above.

Verified independently (evaluation-1.md; raw output in `.concertino/scratch/HEL-1746/eval/eval-probe.txt` and `eval-edit.txt`): each tier switches exactly at content widths 860 and 680.
- View mode, viewports 1440 to 900px: no row or actions overflow; the facts column is at least 397px at tiers 0-1.
- Edit mode, viewports 1440 to 1120px (edit mode itself ends below about 1100px): Ask present at tiers 0-1, no overflow at any width; icon-only
  switch at content < 1010 (labels at 1016, icon-only at 996); the facts column is 303px just before that switch, the same minimum as before Ask,
  because the edit threshold and Ask both moved by 40. `META_ROW_EDIT_EXTRA_PX` (150) is unchanged.
- The narrow-desktop e2e asserts content width (row minus 40px) is under 680 at a 900px viewport, where Ask is a kebab item.

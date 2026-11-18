## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c3a25b4a9ca64b9dc5ed3c49e8ba83464ea5b084` against the live-resolved base `361c22f223ee27409b045860aab6ab889bbbb687` (from `resolve-review-base.sh`, exit 0). The diff covers `PipelineSpine.css`, `e2e/hel1608-spine-count-overlap.spec.ts` and the change dir.

### What I verified (with evidence)
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/spine-compact-menu-rule/HEL-1671`.
- **Full e2e, run by me:** `e2e/hel1608-spine-count-overlap.spec.ts` plus `e2e/hel1579-pipeline-spine-layout.spec.ts`. Settings: DEV_PORT=7103, DATABASE_URL pointing at lane DB `helio_hel1671`, `--workers=2`, `nice -n 19`. Result: **19 passed, exit=0**. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1671/evidence/.concertino-skeptic-ev/skeptic-final-e2e.txt`.
- **The backend is on the lane DB:** the `users` row count in `helio_hel1671` went from 1 to 18 during the run. I checked the database itself and read no env file.
- **Hover-gating guard and spine jest tests:** `npm --prefix frontend test -- --maxWorkers=3 --testPathPatterns='pipelineHoverGating|spine'`. The filter matched the whole frontend suite: 821/821 suites and 9927 tests passed, so the guard is included and green.
- **Item 1 (one ⋮ rule):** traced in the CSS. Cards have no opacity rule, so their ⋮ is always visible. The base `.spine-row--selected .spine-row__menu { opacity: 1 }` is no longer overridden in compact mode. Hidden menus get `pointer-events: none`, and pointer input comes back only for the selected row, for `.spine-row__menu:focus-within`, and for row `:hover` inside `@media (hover: hover)`. Regular rows get the hit-box extension (`margin-right: -control-sm` plus matching padding). `.spine-row` has no flex gap, so the select's border box reaches the row's right edge under the menu.
  - Live check at 1100px: the selected trigger is vertically centred and flush right, and unselected slots are hidden.
- **Item 2 (marker gap):** `.spine-row__select:has(> .spine-row__markers:empty)` drops the markers track and moves the count to column 3. Live at 900px on the selected Compute row (which has a marker), the grid is `24px 86.6px 14px 14.4px 20px`. The e2e gap assertion is green.
- **Item 3 (compact is on):** the guard test is green. The executor's M1 and the evaluator's threshold mutant both turn it red. Live readings: 769 → 147px, 900 → 207px, 1100 → regular.
- **Item 4:** decided in D4 (accept the truncation). Evidence: "Compute column" measured 99/110 at 1100px.
- **Item 5:** the delta's 800px / 600px content-width wording matches `PipelineSpineHeader.css:345/379/389` (`@container (max-width: 800px|600px)`).
- **D2's own acceptance criterion fails on a truncated title. This is the issue the executor self-flagged, and I reproduced it.**
  - Setup: my own seeded pipeline (5 step rows, Source and Output cards), 769px, list default, "Assert / validate" selected. The title is truncated: clientWidth 99, scrollWidth 108.
  - Geometry: the title box is y 592–610 and x to 459. The trigger is x 439–467, y 606–634. `--control-sm` resolves to 28px with `(pointer: coarse)` false, so this is the fine-pointer desktop case, not only coarse.
  - Sampling with `elementFromPoint` the way D2 and the spec's `covered` check prescribe: the samples at the title's bottom band (y 607 and 609) for x = 439, 449 and 454 all resolve to `.spine-row__menu`. That is 6 of 20 samples.
  - Reproduced: identical geometry after a full reload in light theme, and in dark before that.
  - Visually, the trigger's top border runs along the baseline of the "d…" ellipsis. On hover the trigger's filled background butts into the title's bottom band.
  - Persisted screenshots:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1671/evidence/.concertino-skeptic-ev/skeptic-final-dark-769-default-assert-selected.png`
    - `…/skeptic-final-dark-769-selected-assert-x8.png`
    - `…/skeptic-final-light-769-selected-assert-row-x8.png`
    - `…/skeptic-final-light-769-selected-assert-trigger-hover-x8.png`
  - Why the e2e is green: the spec's `covered === 0` check only ever samples the selected row `rows.nth(1)`, which is "Sort rows". That title is short, so its visible text never reaches the trigger's columns. The assertion passes without exercising the case it exists for, which is a truncated or long title on the selected compact row (the normal case at 769px, where most labels truncate).
- **Consistency:** the compact selected ⋮ sits flush in the row's bottom-right corner. The regular selected row's ⋮ (1100px, `skeptic-final-light-1100-default-hover-sort.png`) and the card ⋮ are vertically centred with breathing room. The compact placement is the odd one out among the three.
- **Executor flag on the "default" screenshots:** they were taken at the list's minimum width. The evaluator's table and my own live checks cover list default, so this is not a gap.

### Verdict: REFUTE

### Change Requests
1. **`frontend/src/features/pipelines/ui/spine/PipelineSpine.css`, compact block, `.spine-row--selected .spine-row__menu` (`top: auto; bottom: 0`).**
   - The problem: the 28px trigger rises 4px into line 1. When the selected title is truncated, its visible text box is hit-tested as the menu at the bottom band. D2 makes "not covered, verified by `elementFromPoint` sampling including the bottom band" the condition for this placement, and that condition fails.
   - The fix: place the trigger so its box does not intersect the title's box. For example, give compact rows a uniform `row-gap` or line-2 band of at least `control-sm` minus the line-2 height minus the bottom padding. Apply it to every compact row, not only the selected one, so selecting a row causes no height shift. Any other approach that keeps the title's full line-1 width and leaves the count and summary uncovered is fine.
   - While there, reconsider the bottom-flush alignment, so the ⋮ reads as centred on line 2 rather than wedged into the row corner.
   - Record the before/after geometry at 769px with a truncated selected title, at the 28px token.
2. **`e2e/hel1608-spine-count-overlap.spec.ts`, "spine row menu: one rule" test.**
   - The problem: the `covered` assertion is vacuous because the selected row's title ("Sort rows") never reaches the trigger's columns.
   - The fix: also select a row whose title is truncated or fills line 1 at the compact widths. Seed a long-label step (for example a compute or assert step), or assert on whichever row has `scrollWidth > clientWidth`.
   - Show it red on c3a25b4a9's CSS before the fix in CR1, and green after.

### Non-blocking notes
- `pipeline-schedule-config-ui` delta: "below about 600px" versus CSS `max-width: 600px` (at or below). Consider "at or below 600px".
- The evaluator's notes still apply: the unused `markersDisplay` field and the `hitInMenu` simplification.
- The jest `--testPathPatterns` alternation ran the whole suite. That is harmless, but a narrower invocation would be cheaper.

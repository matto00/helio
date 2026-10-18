## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `36290bc2f9cf7ed2a892556fa9b36af32784eb3b` (commits 389792b50 red-first sweep test, 36290bc2f CSS fix) against
live-resolved base `d8387507734f8e74bbf62df8880923791ec7c08d`.

Evidence (persisted, durable): `/home/matt/Development/helio/.concertino/runs/HEL-1608/evidence/.concertino/scratch/HEL-1608/`
(`eval-probe.cjs`, `eval-probe-summary.json`, `eval-count.cjs`, `eval-count.json`, `eval-dark-769-count-1000-spine.png`,
`eval-dark-769-longcount.png`, `eval-light-769-kbfocus-lane.png`, `eval-dark-769-hover-lane.png`, `eval-dark-390.png`,
`eval-light-900.png`, `eval-dark-1100.png`). The other screenshots (`eval-{dark,light}-{769,900,1024,1100,1280,390}.png`
and the reveal shots) are in `/home/matt/Development/helio/.concertino/scratch/HEL-1608/`. Every claim below rests on a
measurement (px, computed style) or a screenshot's content. None rests on mtime ordering.

### Phase 1: Spec Review — PASS
- AC1 (readable titles at 769–1100, both themes, list 248/400, trunk and lane rows): met. Shipped CSS, my own probe running
  the sweep's measurement: 0 failures in all 4 list/theme combinations. 43 lane-row samples per combination. 152 compact rows
  (list 248) and 172 (list 400).
- AC2 (red on HEL-1579 CSS): met. See the "Red proof" section below.
- AC3 (1280×800): spine 332px with the list at 248, all four titles readable. The sweep also asserts 270–340 at 1280×900.
- Doc nits: archived design D2 updated, both header CSS comments fixed, and the spec delta corrects the paused-chip wording.
  `grep "clamp(270px\|1100px block"` hits only the archived evaluation/skeptic reports that describe the nits.
- Tasks all ticked and they match the diff. No scope creep: CSS in the three spine files, the sweep test only (C3: the
  seedPipeline and :174 accent test were not touched), docs.
- C1/C2/C3 honored. Phone: the compaction is gated on the named container `spine-column`, which only `.spine-body__spine`
  creates. All hel1582-* specs are green (below).

### Phase 2: Code Review — FAIL
Gates (fresh, run by me in WORKTREE_PATH):
- `npm run lint`: clean. `npm run format:check`: clean. `npm --prefix frontend run typecheck`: clean.
- `npm test` (HELIO_JEST_MAX_WORKERS=2, nice 19): root 61/61 suites, 524 tests; frontend 723/723 suites, 9049 tests. Exit 0.
- `npm --prefix frontend run build`: exit 0.
- e2e (flock, 2 workers, nice 19, trace retain-on-failure, DEV_PORT=7040): the whole `hel1579-pipeline-spine-layout.spec.ts`
  plus all four `hel1582-*` specs gave 36 passed and 2 skipped. The 2 skips are the pre-existing HEL-1582 slow-lane-only
  maximal sweeps (390/768, `HELIO_E2E_SLOW`). The HEL-1620 :174 flake did not occur.

Red proof (the AC2 scrutiny point). `red-proof.txt` shows only the first failure (769 dark, list=default, trunk "Filter
rows" 22px). Playwright stops at the first failed `expect`, so the file alone does not show lane rows or list=max. I
re-ran the sweep's exact measurement in the live app with an in-page override that restores the HEL-1579 track
(`clamp(180px,22vw,340px)`) and removes the `spine-column` container. Every combination fails:
default/dark, default/light, max/dark and max/light each have 132 failing title samples, 40 of them lane rows. At 769 the
lane row "Limit rows" is 2px visible and occluded, and "Compute column" is 8px. The shipped CSS gives 0 failures in the
same run. AC2 is adequately proven.

Non-vacuity of the assertion:
- `titles.length >= 4` with the branch seed (3 trunk rows and 1 lane row). My probe confirmed the lane row is matched
  (`.spine-lane--sub` ancestor).
- The probe is anchored on the title's own rect, clipped to the column's client rect. A 0-visible title fails through the
  `visible > 8` guard.
- Mutation: forcing `pointer-events: auto` on the hidden compact menu makes the two-end occlusion probe fail 114–129
  samples per combination ("OCC"). So the probe really detects the overlaid ⋮.

Code issues:
1. **Row count collides with the summary text in compact rows (regression introduced here).** Design D2(c) requires the
   count to sit "at the summary line's end with the summary padded to clear it". The padding is a fixed `4ch`
   (`frontend/src/features/pipelines/ui/spine/PipelineSpine.css:414`), and the count is absolutely positioned over it
   (`:406-411`). Any count of 5 or more characters therefore overprints the summary's last glyphs. Measured at 769, 849
   and 929 (`eval-count.json`), summary text against count box:
   - "999" and "off": 0px overlap.
   - "1,000": 7px overlap on "Filter rows" and 5px on lane "Limit rows".
   - "12,345": 14px and 12px.

   The screenshot `eval-dark-769-count-1000-spine.png` shows "duration_1,000" and "first 31,000" running together. Counts
   of 1,000 or more are ordinary for real sources (the sweep's 14-row seed hides this). The width ranges are not
   identical: 1,000 rows (the narrowest range) collide at about 769–929px viewports, and larger counts reach further.
2. **[mechanical] DESIGN.md §Spacing (line 268–269): all padding uses a `--space-*` token.** `padding-right: 4ch` at
   `PipelineSpine.css:414` is a literal larger than 4px. The fix for issue 1 will replace this line anyway.

Otherwise:
- Clean. Named container (no unnamed `@container` subject sits inside the spine: the filter-row and header rules resolve
  to the page/centre column as before).
- The ActionsMenu panel portals to `<body>`, so the menu's `transform` does not trap it.
- The selected-row `opacity: 0` override wins by source order at equal specificity. Hover and focus rules (0,3,0) restore
  it.
- State rungs reuse the existing tokens.

### Phase 3: UI Review — PASS (with the count collision above counted under Phase 2)
- Happy path: 769, 900, 1024, 1100 and 1280 in light and dark, plus 390 (dark and light). Titles are readable, the header
  is one row, and there is no document scroll at any swept width (docW/docH ≤ 0 in all 172 samples).
- Reveal at 769 (compact), both themes:
  - Idle unselected row: opacity 0, pointer-events none.
  - Selected row with no focus: opacity 0, pointer-events none (as designed).
  - Hover: opacity 1, pointer-events auto. The menu sits on the row's hover tone.
  - Keyboard: Tab from the row's select button lands on "Step actions for Compute column" (pointer-events auto,
    focus-within). It is visible with its focus ring after the 250ms transition (`eval-light-769-kbfocus-lane.png`), and
    Enter opens the menu (1 `menu` role).
- Phone (390): unchanged layout (`eval-dark-390.png`). The hel1582 specs are green.
- Console: the only errors are `404 GET /api/pipelines/:id/schedule` on load. That is the pre-existing "no schedule"
  response, not related to this change.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/spine/PipelineSpine.css:406-415`: in compact rows, make the row count clear the
   summary text for any realistic count, at least up to 7 characters ("1,234,567"), instead of the fixed `4ch`
   (`:414`). Options, in no particular order:
   - Turn `.spine-row__select`/`.spine-row__text` into a two-row grid with the count in the summary row's own
     auto-width cell, so the summary ellipsizes before it.
   - Keep the absolute count, but reserve its real width.

   Use `--space-*` tokens for any spacing (DESIGN.md §Spacing [mechanical]). Then extend the sweep assertion so a regression
   is caught: for each compact row, assert the count's box does not intersect the summary's content box (summary rect
   minus its padding-right). Seed or inject a count of 5 or more characters, because the 14-row seed only produces "14"
   and never exercises the overlap. Show that new check red on the current CSS first. You can reproduce with
   `eval-count.cjs` (persisted ref above): it overwrites `.spine-row__count` text in-page and measures overlap.

### Non-blocking Suggestions
- `red-proof.txt` records only the first failure. Consider noting in it that a full matrix (lane rows and list=max) was
  checked, or append a one-line summary. My reproduction above covers it for this review.
- The probe left the dev account (`matt@helio.dev`) with its context list at 400px, a server-persisted preference, and
  added one pipeline, `hel1608-eval-pipe`, with its source `hel1608-eval-src`. This is harmless shared dev data.

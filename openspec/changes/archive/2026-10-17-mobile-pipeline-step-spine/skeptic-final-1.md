## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9fbe26a7ac24733502b08db2fc56855b33ffa085`. The base was resolved live with `resolve-review-base.sh` (main/origin) as
`544bd79ea5879263fc05808ff15bee6cd7d6c430`. The diff covers 112 files, +7021/-10180. The servers on 7014/9921 run from
this worktree (`/proc/<pid>/cwd` checked). All probes were my own headless Chromium runs (isMobile, hasTouch, DSF 2),
paced, with one throwaway user. I deleted that user by exact id with `buildUserDeleteSql`, and a re-count shows 0 rows.

Durable evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/skeptic-f1/`:
- `results.json`: fit, gutters, slot, pills, nav and touch sweeps for 6 theme×width cells.
- `kinds.json`: per-kind sheet hit-extent sweep, swipe, popover and Motion levels.
- `chain-pl.json`: touch-swipe scroll chain.
- `overflow-after-sr.png`, `ac3-long-end-375-dark.png`, `kinds-filter-sheet.png`, `dark@375-p3-steps.png`, `light@375-p3-steps.png`, `dark@375-sheet.png`.
- `e2e.log`, plus the probe scripts `probe.cjs`, `kinds.cjs` and `overflow.cjs`.

### What I verified (with evidence)

- **AC1 (one-screen fit): met.** At 375×812 the Output card bottom is 688.8 against a bar top of 696, a margin of 7.2px, in both themes.
  - The source card spans 227.8–318.8 and the three rows 354.8–542.8.
  - At 390 the margin is 39.2px, and at 768 it is 219px.
  - The spec honestly states the owner framing: the truncation strip, analyze banner and rename/confirm rows are outside the check.
  - I did not rebuild the 8-digit, Partial and paused state. The evaluator's cycle-5 numbers for it match the executor's table, and the new e2e case for it passed in my run.
- **AC2 (sheet): met for editability and dismissal.**
  - jest renders every `OP_TYPES` kind in `BottomSheet` (`PipelineMobileLayout.test.tsx:367`).
  - Live, I opened the sheet for 15 kinds (filter, sort, compute, cast, rename, datebucket, dedupe, fillnull, stringops, window, select, limit, assert, aggregate, union). Every one opened, with body overflow 0.
  - Real CDP touch drags:
    - A 40px drag springs back and leaves no inline transform; the computed transform is `none`.
    - A body drag scrolls the body (scrollTop 47) and never moves the sheet.
    - A 400px drag dismisses the sheet. The exit frames go 416→812 and then `closed`, with no frame back at rest, so there is no flash.
  - The visible Close button closes the sheet at every width.
- **AC3 (clearance): met.**
  - With the 3-step pipeline, the bar bottom is 736 against a nav top of 744 at 375 (8px), and the same 8px holds at 390 and 768.
  - On a 9-step pipeline scrolled to the end by real touch swipes, "+ Output" ends above the bar top at 696 (`chain-pl` screenshot).
  - The clearance follows `--pipeline-mobile-actions-h` (40px).
- **AC4 (touch floor):**
  - **Met** for the Steps, Preview and Runs tabs: 0 failures at 375, 390 and 768, in both themes.
  - **Not met** in the step sheet. See CR1.
- **e2e re-run myself:**
  - Command: `hel1582-mobile-pipeline.spec.ts` under the flock lock, 2 workers, `nice -n 19`, DEV_PORT 7014.
  - Result: **18 passed**.
  - The contrast table shows the only sub-4.5 text value is the named light Run-pill hover at 3.95 (FU-3). Every state surface is ≥1.119 and every non-text value is ≥3.19.
  - The 18 passes coexist with the CR1 defect, because the sweep cannot see it (see CR1).
- **Sheet primitive (C4, C7) is reusable by HEL-1584's split:**
  - It composes `Modal` and leaves it unedited.
  - At rest the transform is `none` and the inline style is empty.
  - A `Select` popover inside the sheet anchors under its trigger: trigger bottom 267, listbox top 271, left edges equal.
  - Close requests are vetoable through `onRequestClose`.
  - Motion levels:
    - **Off:** the entrance animation is 1e-05s, and the exit closes with no transition.
    - **Subtle:** the entrance is `bottom-sheet-fade`, with opacity only.
  - Timing comes only from tokens.
- **`data-slot="draft-status"`:** `display:none` (via `:empty`), 0×0, no children, no padding, at every width. This holds.
- **River retirement:**
  - No import of any deleted component remains.
  - `PipelineRiverSkeleton` and `.pipeline-detail-page__river` survive as the live loading skeleton. This is a naming leftover, not dead code.
  - The spine-layout spec delta is honest about the scenario name it keeps.
- **Mono name and gutters:**
  - The name is in JetBrains Mono.
  - Content sits 12px from both edges at every width.
  - Accent appears only on the Run pill fill, the active tab indicator and focus.
- **"Reachable on touch" for the run meta:** I agree with the evaluator. The Runs tab is a 44px tab on the same page, and its latest row carries the full figures and a "Show log" toggle. A tappable meta would cost header height against a 7.2px fit budget. This is acceptable.

### Verdict: REFUTE

Two stable, reproduced defects, both introduced by this diff.

### Change Requests

1. **AC4 / DESIGN.md §3 expander tiling: hit regions inside the step sheet are stolen by the sheet's own new expanders.**
   - **Where:** `PipelineMobile.css:552-557` gives every sheet button a z-index:1 44px `::after`. The filter AND/OR combinator buttons are 24px painted, so their expanders overhang 10px and cover the top 2px of the control below.
   - **Measured** by `elementFromPoint` bisection at 0.25px, at 375, 390 and 768, in both themes, reproduced in 3 runs:
     - **Filter:** "Field for condition 1" (`.ui-select__trigger`) has a hit height of **42px**. The top band hits `pipeline-detail-page__filter-combinator-btn`.
     - **Union:** "Other source" (`.ui-select__trigger`) has a hit height of **42px**. The band is stolen by a `filter-combinator-btn`-class button in its editor.
     - **Select fields:** a checkbox label's hit width is **42.75px**. A short field name makes its label narrower than 44.
   - **Why the e2e is green anyway:** `sweepFloor` measures `PAINTED_BOX_CONTROLS` (selects and inputs) by painted height, which is 44, never by hit extent. It also measures checkbox labels on the y axis only. DESIGN.md §3 says outright that region overlap "must" be bisected.
   - **Fix (both parts required):**
     - Give the combinator cluster (and the union editor's equivalent) at least the overhang (≥10px, i.e. `--space-3`) of gap to the next control inside `.mobile-step-sheet__content`, and make labels min-width 44.
     - Extend `sweepFloor` to bisect hit extent on both axes for painted-box controls and checkbox labels too. Add a mutation proving it goes red on today's combinator overlap.
2. **The visually hidden "Outputs" heading escapes the scroller and lets the page scroll away its own header with no way back.**
   - **Where:** `SpineOutputs.tsx:42` adds `sr-only` on phone. `.mobile-body` (`PipelineMobile.css:241`) is not a positioned box, so the absolutely positioned sr-only `<h3>` resolves against `.pipeline-detail-page`, outside the scroller.
   - **Effect on a long pipeline (9 steps, 375×812):**
     - The `overflow:hidden` page's scrollHeight is 935 against a clientHeight of 688. The heading sits at y≈990.
     - `scrollIntoView({block:"nearest"})` on that heading scrolls the page by 247px. This is what VoiceOver or TalkBack do when the cursor reaches it, and what find-in-page does for "Outputs".
     - The result: the header is at -191, the tabs are gone, and the pills float mid-screen with an empty band above the nav (`overflow-after-sr.png`).
     - Because the page is `overflow:hidden`, touch cannot scroll it back.
   - **Reproduced** with two different triggers: the sheet sweep's scrollIntoView (`ac3-long-end-375-dark.png`) and the direct heading call.
   - **Not triggered by:** keyboard Tab ×60 or real touch swipes.
   - **Fix:** give `.mobile-body` `position: relative`, or otherwise contain the sr-only eyebrows (the `PipelineSpine.tsx:122` eyebrows too) inside the scroller. Add a test that the phone page's scrollHeight equals its clientHeight with a long step list.

### Non-blocking notes

- The source card reads "Static" and then "Static · 14 rows". The kind line repeats the sample label and costs about 20px of the fit budget. The Output card's "off Compute column" wording is unclear. Both come from the desktop `SpineSourceCard`/`SpineOutputs` (HEL-1579), not from this diff.
- After a tap, the active tab keeps its hover fill (sticky touch hover; see the Preview and Runs screenshots). Consider gating phone hover fills behind `(hover: hover)`.
- On the board, step rows are bordered cards. Here they are open spine rows. This is consistent with the desktop spine and acceptable.
- Rename `PipelineRiverSkeleton` and `.pipeline-detail-page__river` in a follow-up. The river is gone, but the name implies it is not.
- The 404 console errors (2 per page load) also occurred in the evaluator's runs' context. I did not attribute them, and they are not a cause of this verdict.
- Gate-defect check: no report I drilled into relied on mtime ordering.

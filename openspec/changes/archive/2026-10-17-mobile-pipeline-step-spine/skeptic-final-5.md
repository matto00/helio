## Skeptic Report — final gate (round 5, skeptic-final-5.md)

**One-line verdict (owner format):** CONFIRM. This round's fix (the disclosure panel portals into the open sheet, with vertical placement and a height cap) introduced no regression of any already-fixed acceptance criterion. The round-4 AC4 defect is fixed in all 6 phone cells.

**Reviewed:** HEAD `9d7ab84630d4836793e8d2462996b51ebf8a5583`.
- Base resolved live with `resolve-review-base.sh` (main/origin): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`.
- The round-5 delta is `61c4b458b..9d7ab8463`. It touches only:
  - `OutputSchemaDisclosure.tsx` (+34/−9) and its jest test
  - `usePortalPopover.ts` (+2: an optional `maxHeight` field on the position type; the hook's logic is unchanged)
  - the HEL-1582 e2e spec
  - two evidence docs
- `OutputSchemaDisclosure` has a single consumer, `spine/StepPreviewTable.tsx`. No other popover is affected.
- **Servers:** reused on 7014/9921. `assert-phase.sh servers` passed, and Vite serves the new `dialog[open]` / `roomBelow` code (checked with curl).

**Evidence directory (durable):** `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/skeptic-f5/`. It holds `probe.cjs`, `probe.json`, `e2e-1582.log`, `e2e-other.log` and the screenshots named below. No conclusion here relies on mtime ordering.

**Probe user:** one throwaway user, `db1aee7e-866b-494c-92c6-72e04d5d3eac`. It owned a 17-column static source (14 long names) and a 3-step filter/sort/compute pipeline with an Output and a run. I deleted it by exact id with `buildUserDeleteSql` through `e2e/support/db.cjs`, and a re-count returns 0.

### What I verified (with evidence)

Every number below comes from my own headless Chromium probe (isMobile, hasTouch, DSF 2) in `probe.json`.

**Round-4 defect, Preview tab: fixed** at 375, 390 and 768, dark and light.
- In the default state (open the page, tap Preview, tap "18 fields") the panel opens below the trigger.
  - At 375 and 390 its rect is [29, 359.8, 364/379, 743.8]: fully on screen, with `maxHeight` 384 and the panel scrolling internally.
  - At 768 the rect is [312, 328.3, 760, 601.3].
- An `elementFromPoint` hit at the panel's centre lands inside the panel.
- The filter field is painted 44px tall and its hit extent is 44.75 in every cell (round 4 measured 27).
- Tapping the scrim closes the panel.
- Screenshots: `preview-panel-dark@375.png`, `preview-panel-light@390.png`.

**Round-4 defect, step sheet: fixed** at 375, 390 and 768, both themes.
- The panel is now a descendant of `dialog[open]` (`inDialog: true`) and the hit at its centre lands inside it.
- At 375 and 390 it opens above the trigger (rect top 38.5, bottom 422.5). At 768 it opens below (375.5 to 648.5).
- The filter's hit extent is 44.75. A real tap on the filter followed by typing `long_column_name_1` works and filters the list to 5 chips.
- A tap on the scrim at y=4, which is above the sheet's own rect, closes the panel only; the sheet stays open. That is correct: `Modal.handleDialogClick` only reacts when `e.target === dialog`.
- Screenshots: `sheet-panel-default-dark@375.png`, `sheet-panel-default-light@390.png`.

**No regression of already-fixed AC items from this round's change** (all 6 cells):
- **AC1:** the Output card bottom is at 688.8. The pill tops are at 696 (375), 728 (390) and 908 (768). Horizontal overflow (`scrollWidth − innerWidth`) is 0.
- **AC2:** the sheet still closes from its visible Close control (painted 28×28, hit extent 44×44.75) after the panel has been used. A real CDP touch swipe on `.ui-modal__header` still dismisses it after the panel was opened and closed. The swipe listens on the header surface only (`useSheetSwipe.ts`), so the panel, now inside the dialog, cannot start a drag.
- **AC4:** the "N fields" trigger's hit extent is still 72.75 × 44.75 on the Preview tab and in the sheet.
- **Console:** 1 console 404 per load, the same as every earlier round.

**Gates I re-ran myself** (flock on the e2e lock, nice 19, outputDir in scratch, DEV_PORT=7014):
- `e2e/hel1582-mobile-pipeline.spec.ts`: **29 passed (16.2 min)**, EXIT 0, run as one file and not stitched. Playwright used 1 worker; the file is serial.
- `hel813-mobile-touch-target-floor.spec.ts`, `hel813-…regression.spec.ts` and `hel1579-pipeline-spine-layout.spec.ts`: **37 passed (1.5 min)**, EXIT 0.
- Jest (`OutputSchemaDisclosure|usePortalPopover|StepPreviewTable|BottomSheet|PipelineMobile|ActionsMenu|Select`): **15 suites / 150 tests passed**.

**Desktop 1440×900, both themes** (`desktop-dark.png`):
- The panel opens **below** the trigger. With the trigger at y=293.5 it spans 318.5 to 575.5, fully on screen, and its centre hit lands inside it. The filter is still 28px (the desktop value is unchanged). The page does not scroll at 1440, so I could not test a lower trigger position.
- This is a visible behaviour change from round 4. On the same kind of fixture, round 4's `probe.json` recorded the panel opening above with top 28.5, which was on screen.
- The executor's framing that "previously its top went off screen" on desktop is therefore not true for a 17-field schema. It only holds for schemas tall enough to reach the 384px cap.
- The result still reads well: the panel sits over the preview table, not over the step editor. It does not regress any AC (desktop is outside the ACs).

**Gate-defect check:** no report I drilled into relied on mtime ordering, and neither does any of my conclusions.

### Verdict: CONFIRM

### Change Requests

None.

### Non-blocking notes (follow-up candidates; none of these is a regression of an acceptance-criterion item)

1. **Desktop placement flips more than it needs to.** `OutputSchemaDisclosure.tsx` decides above or below from the 384px *cap* (`fullHeight`), not from the panel's measured height. A 257px-tall panel that fit above the trigger (round 4: top 28.5) now opens below it at 1440. Possible fix: measure after mount (as the hook's horizontal clamp does) or estimate from the field count. Below may well be the better desktop placement anyway, so this needs an owner call.
2. **Below-placement ignores the glass BottomNav.** The cap only keeps an 8px viewport margin. On the Preview tab at 375 the panel's bottom (743.8) happens to stop just above the nav. Because the room-above test falls back to below whenever the trigger's top is under about 392px, a trigger positioned slightly lower would let the panel extend behind or over the nav, up to about y=801. I did not reach such a state, so this is an unverified hypothesis worth one probe.
3. **Escape inside the sheet closes both the panel and the sheet** (the executor reported this as unchanged). A more expected result is that the first Escape closes only the panel. `usePortalPopover`'s document `keydown` and the dialog's native `cancel` both fire.
4. **Earlier notes still stand:**
   - The HEL-1582 e2e takes 16 min on one worker. The three MAXIMAL sweeps are the bulk of that and are a CI-cost candidate for `@slow`/nightly.
   - Rounds 1–4 polish items: the "Static / Static · 14 rows" repeat, the "off Compute column" wording, sticky touch hover on tabs, the `PipelineRiverSkeleton` naming, and the AI-row `scrollWidth` overhang.

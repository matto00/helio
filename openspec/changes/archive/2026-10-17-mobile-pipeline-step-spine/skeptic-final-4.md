## Skeptic Report — final gate (round 4, skeptic-final-4.md)

**One-line verdict (owner format):** REFUTE. AC4 is broken by this round's own fix. The "N fields" disclosure trigger now meets the 44px floor, but the panel it opens is not tappable on a phone. On the Preview tab at 375 and 390 the panel opens 57px above the top of the viewport, so its filter field has a 27px tappable area. In the step sheet the panel renders underneath the modal sheet, so it is invisible and its tappable area is 0.

**Reviewed:** HEAD `61c4b458b66fdf48f16c3ca4662a5f6182d6c3b9`.
- The base was resolved live with `resolve-review-base.sh` (main/origin): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`.
- The round-4 delta is `f181c9646..61c4b458b`:
  - `StepPreviewTable.css` (+25)
  - `SchemaFieldViewer.css` (+8)
  - `OutputSchemaDisclosure.tsx` (the left clamp) and its jest test
  - `PipelineMobile.css.test.ts`
  - the e2e spec
  - two evidence documents
- **Servers:** reused on 7014/9921. `assert-phase.sh servers` passed, and Vite serves the new `padding-block: var(--space-4)` rule.

**Probes:** all are my own headless Chromium runs (isMobile, hasTouch, DSF 2), paced under the `/api` limit.
- They used one throwaway user, `38b31ed2-439f-4520-9576-8cacefe86475`. Its data is a 17-column static source with 14 long names, and a 3-step pipeline (filter, sort, compute) with an Output and one run.
- I deleted the user by exact id with `buildUserDeleteSql` (`DELETE 0 … COMMIT`). A re-count shows 0 rows.

**Durable evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/skeptic-f4/`. Every file named below is in that directory: `probe.json`, `repro.json`, `sheetpanel.json`, the scripts, and the screenshots.

### What I verified (with evidence)

**Round-3 defect, the trigger's own hit area: fixed** (`probe.json`, all 6 cells: 375/390/768 × dark/light).
- **Preview tab:** "18 fields ▾" is painted 72×17. Its `elementFromPoint` hit extent is 72.75 × **44.75**. The band above it resolves to the header or title and the band below to the header, so it is not clipped and no neighbour overlaps it.
- **Real taps:** `touchscreen.tap` at the centre, at +18px and at −18px all open the panel, in every cell.
- **Step sheet (Filter):** "17 fields ▾" has a hit extent of 72.75 × **44.75** in all 6 cells, and a tap 15px below its centre registers.
- **Header:** with the trigger it is 84px tall at 375/390 (wrapped) and 55px at 768. It reads cleanly in both themes (`preview-light@375.png`): the padding is balanced and the dashed affordance is unchanged.
- **Schema filter field:** painted 44px tall on touch, with a 44.75 hit height at 768.

**Desktop is unaffected by the shared-component changes** (1440×900, fine pointer, both themes; `probe.json` `desktop-*`, `desktop-dark.png`).
- The `.step-preview__header` is 35px tall with 8px padding, the trigger's `::after` height is `auto`, and the filter is 28px. All of these are pre-change values.
- The panel opens at `left = 830.8`, which is the trigger's own left, so the clamp does not engage. That is expected: 1440 − 448 − 8 = 984 > 830.

**AC1 and AC3, re-checked on my pipeline in 6 cells.**
- The Output card bottom is at 688.8. The pill tops are at 696 (375), 728 (390) and 908 (768).
- `scrollWidth − innerWidth = 0`.
- There is 1 console 404 per load, the same as earlier rounds.

**The executor's e2e, run by me in full:** `e2e/hel1582-mobile-pipeline.spec.ts`, DEV_PORT=7014, under the flock, nice 19, outputDir in scratch.
- Result: **26 passed (14.9 min)**, exit 0. Playwright ran it on 1 worker. Log: `.concertino/scratch/HEL-1582/skeptic-f4/e2e.log`.
- The suite is green while both defects below are present. The reason is under the finding.

**The finding, reproduced** (`probe.json`, then a separate fresh-context re-run in `repro.json`, then `sheetpanel.json`).

1. **Preview tab, 375×812 and 390×844, both themes, the default state** (open the page, tap Preview, tap "18 fields").
   - The panel is `position: fixed` and bottom-anchored 8px above the trigger (`bottom: innerHeight − rect.top + 8`, `OutputSchemaDisclosure.tsx`).
   - The trigger's top is 334.8, and the panel is 384px tall: it hits the `max-height: min(24rem, …)` cap because the long field names wrap one per line in a 335px-wide panel.
   - So the panel's top is at **−57.2**. Its header ("Output schema · 18 fields") is at −40.2, and the filter field is at −17.2 with a painted height of 44.
   - A scan of the filter's own column with `elementFromPoint` finds **27px** of tappable height. That matched in 4 of 4 cells and again on the fresh re-run.
   - `scrollIntoView({block:"center"})` on the filter changes nothing (the panel is fixed and already at `scrollTop` 0), so the user cannot recover the area.
   - Screenshots: `panel-dark@375.png`, `repro-panel-375.png`, `repro-panel-390.png`.
   - At 768 the panel is on screen, with a top of 22.3 and a filter hit height of 44.75.
2. **Step sheet, 375 and 768.**
   - Tapping "17 fields ▾" mounts the panel, but `createPortal(…, document.body)` puts it under `body`. The sheet is a modal `<dialog>` in the browser's top layer, so the panel sits beneath it.
   - `elementFromPoint` at the panel's centre returns `pipeline-detail-page__filter-combinator-btn` (375) and `pipeline-detail-page__filter-config` (768).
   - The filter field's centre resolves to `step-focused` or `step-focused__header`.
   - The panel is invisible and nothing in it can be tapped (`sheetpanel-375.png` shows the sheet unchanged after the tap). The trigger this round made tappable is therefore a dead control in the sheet.
   - The codebase already solves this for `ActionsMenu` (`shared/chrome/ActionsMenu.tsx:69`) and `Select` (`shared/ui/Select.tsx:74`): both portal into `triggerRef.current.closest("dialog[open]") ?? document.body`.

**Why the green e2e misses both.**
- The maximal sweep opens the disclosure only on the Preview tab, and its fixture puts the trigger lower on screen ("far right of a wrapped header", per `maximal-sweep.md`). It never opens the disclosure inside a sheet; there it only bisects the trigger.
- `maximal-sweep.md`'s claim that the panel "is on screen at every width" is true horizontally only. Its own "not fixed" note dismisses the vertical case as "not reached in any swept state". It is reached in the default Preview-tab state of an ordinary 3-step pipeline on a 17-column source.

**AC2 and the sheet otherwise:** the visible Close control and the earlier rounds' sheet behaviour are covered by the green AC2 e2e tests in my run. I made no new design objection to the sheet chrome in `sheet-dark@375.png`.

**Gate-defect check:** no report I drilled into relied on mtime ordering, and none of my conclusions do. They rest on measured coordinates and hit-tests.

### Verdict: REFUTE

This breaks AC4 ("All interactive elements meet the 44px touch floor", measured by real hit area under C8). The panel's filter field is a 27px tappable target at 375/390 on the Preview tab, and has a 0px target in the sheet. The defect sits inside this round's exact fix, which made the disclosure tappable and claimed the panel was kept on screen.

### Change Requests

1. **AC4: the "N fields" disclosure panel must open fully on screen and above the sheet.** The file is `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.tsx`.
   - **(a) Portal target.** Portal into `triggerRef.current.closest("dialog[open]") ?? document.body`, the same pattern as `ActionsMenu.tsx:69` and `Select.tsx:74`. Today it portals unconditionally into `document.body`, so in the step sheet it renders beneath the modal dialog.
   - **(b) Vertical placement.** When the space above the trigger (`rect.top − 8 − margin`) is less than the panel's height, either open downward (`top: rect.bottom + 8`), or cap the panel's `max-height` to the available space so its top stays at or below an 8px viewport margin. Today a trigger at y≈335 with a 384px panel puts the panel's top at −57.
   - **(c) Desktop behaviour.** Keep desktop behaviour unchanged, and keep the horizontal clamp.
   - **(d) Tests.** Extend the e2e so it would have been red:
     - On the Preview tab, open the disclosure in its default state (no prior scrolling) on a source with 14+ long column names at 375 and 390. Assert the panel rect is inside the viewport and the filter's hit extent is at least 44.
     - In the sheet, open the disclosure and assert `elementFromPoint` at the panel's centre lands inside the panel.

### Non-blocking notes (follow-up candidates)

- **CI runtime.** The full HEL-1582 spec took 14.9 min on 1 worker in my run, and the three MAXIMAL sweep tests (~3 min each) are most of that. That is a real CI cost. My suggested follow-up is to run one MAXIMAL size (375) in the PR suite and move 390/768 to a nightly or `@slow` tag, or to share one seeded fixture across the three sizes.
- The round 1–3 polish notes still stand: the "Static / Static · 14 rows" repeat, the "off Compute column" wording, sticky touch hover on tabs, the `PipelineRiverSkeleton` naming, and the harmless AI-row `scrollWidth` overhang.

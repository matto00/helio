## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `4d2d6316ad18f79b6c83efcd2469c8ea711da5be`. I resolved the base live with `resolve-review-base.sh` (main/origin): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`. The diff covers 112 files.

The servers on 7014/9921 were reused. `/proc/<pid>/cwd` shows both run from this worktree's `frontend`/`backend`. The merge brought no backend or schema change since the backend started.

All probes are my own headless Chromium runs (isMobile, hasTouch, DSF 2), paced under the `/api` limit. They used one throwaway user, which I deleted by exact id with `buildUserDeleteSql`. A re-count shows 0 rows.

I seeded a 14-step "kinds" pipeline with every `OP_TYPES` kind the executor's e2e seed omits:
- join
- lookup
- union (with a second source)
- upsertsource
- extractheadings
- chunkbytokencount
- convertformat
- analyzewithai
- generatetext
- pivot, unpivot, splittext and select
- filter with OR and 2 conditions

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/skeptic-f2/`
- `cells.json`, `kinds.json`, `long.json`, `motion.json`, `ai.json`
- the probe scripts `seed.cjs`, `probe.cjs`, `ai.cjs`
- screenshots: `ai-move-375.png`, `light@375-steps.png`, `dark@375-steps.png`, `dark@768-steps.png`, `kind-join-dark@375.png`, `kind-lookup-dark@375.png`, `long-end-dark@375.png`

### What I verified (with evidence)

- **AC1 fit, at 375×812 in both themes:** met (`cells.json`).
  - Source card: 227.8–318.8.
  - Step rows: 354.8–414.8, 418.8–478.8 and 482.8–542.8.
  - Output card bottom: 688.8, against a bar top of 696. That is 7.2px of margin.
  - At 390 and 768 the margin is larger: bar tops are 728 and 908.
- **AC3 clearance:** met.
  - On the 3-step pipeline, the bar bottom is 736/768/948 against nav tops of 744/776/956, so the pills clear the nav by 8px at every width.
  - On a 9-step pipeline swiped to the end with real CDP touch, "New output" ends at 680 against a bar top of 696 at 375, and 16px above the bar at 390 and 768 (`long.json`, `long-end-dark@375.png`).
- **Round-1 CR2 (hidden headings escaping the scroller): fixed** (`long.json`).
  - On the long pipeline, page scrollHeight equals clientHeight at all three widths: 688/688, 720/720 and 900/900.
  - `scrollIntoView` on each sr-only heading (Source, Steps, Outputs) leaves page scrollTop at 0 and the header top at 56.
- **Round-1 CR1 (combinator overlap, short checkbox labels): fixed.** I bisected hit extent on both axes for the filter (OR, 2 conditions), union, select and split-text editors. There were 0 failures at 375/390/768 and in light@375.
- **Join and lookup editors in the sheet:** both pass.
  - Join: 9 controls. Lookup: 11 controls. Both have hit extent ≥44 on both axes and body overflow 0, at 375 dark, 390 light, 768 dark and 375 light.
  - Their screenshots look correct: the selects anchor in place and the warnings wrap inside the card.
  - upsertsource, extractheadings, chunkbytokencount, generatetext, convertformat, pivot and unpivot also pass.
- **Page tabs, AC4 outside the sheet:** 0 failures in all 6 theme×width cells.
  - Steps tab: 18 controls (header, tabs, body, pills).
  - Preview tab: 9 controls.
  - Runs tab: 8 controls.
  - Filter sheet: 12 controls.
  - The visible Close control closes the sheet in every cell.
- **HEL-1584 merge did not break the sheet** (`motion.json`, 375 in both themes).
  - **Full:**
    - The entrance is `bottom-sheet-in` at 280ms; Modal's `ui-modal-in` does not stack on it.
    - The backdrop runs `ui-modal-backdrop-in` at 0.16s.
    - At rest the inline transform is empty and the computed transform is `none`.
    - A Select listbox opens 4px under its trigger, with left edges equal (55/55).
    - The exit frames run 16→155→…→812 and then `closed`. No frame returns to rest, so there is no flash.
  - **Subtle:** the entrance is `bottom-sheet-fade` (the BottomSheet rule wins over Modal's Subtle `ui-modal-fade-in`). The exit is opacity only, 1→0, with top fixed at 16.
  - **Off:** the dialog has no running animations, the backdrop duration is 1e-05s, and the exit closes immediately.
  - **Swipe:**
    - A 40px handle drag springs back with no inline transform left behind.
    - A body drag scrolls the body (scrollTop 71) and leaves the sheet alone (`none`).
    - A 400px drag dismisses the sheet.
- **DESIGN.md v3, the board, and C1–C7:** I compared the light@375 and dark@768 screenshots with round 1, and nothing has drifted.
  - The pipeline name is in JetBrains Mono.
  - Gutters are 12px, and the document scrollWidth equals the viewport.
  - Accent appears only on the Run pill, the active tab and focus.
  - The `draft-status` slot is held.
  - The round-1 non-blocking notes still apply. The console 404 (1 per load) is unchanged and not attributed to this diff.
- **Owner-accepted framing:** stated honestly. I did not re-litigate it.

### Verdict: REFUTE

The issue is one stable defect, reproduced at 375, 390 and 768 and in both the kinds sweep and a dedicated run. It is an AC4 failure in the step sheet that causes a real wrong action. C8's "every step kind's editor" sweep does not catch it because the e2e seed never creates the kind that has it.

### Change Requests

1. **AC4 / C8: in the "Analyze with AI" editor, the output-field "Move up" button cannot be tapped. Tapping it moves the field down.** (`ai.json`, `ai-move-375.png`)
   - **Where:**
     - `AnalyzeWithAiConfig.tsx:151-170` renders two `pipeline-detail-page__step-card-move-btn` buttons side by side. They are squeezed to 14px painted width in the sheet row.
     - Each button gets a centred expander at least 44px wide: `PipelineMobile.css` sheet rule `button::after` (width `max(100%, 44px)`, z-index 1), plus the ≤430px rule in `PipelineDetailPage.css`.
     - The later sibling's expander paints over the earlier button completely.
   - **Measured** by `elementFromPoint`, identical at 375, 390 and 768:
     - "Move output field 2 up" (enabled): its painted centre resolves to "Move output field 2 down", so its hit area is 0.
     - "Move output field N down": hit width 25px.
     - "Move output field 3 up" (whose down button is disabled): hit width 43px.
   - **Real tap:** a Playwright tap on the painted centre of "Move output field 2 up" turned field order `a,b,c` into `a,c,b`. The tap ran the down action.
   - **Why the gates are green:**
     - `seedPipeline(manyKinds)` in `e2e/hel1582-mobile-pipeline.spec.ts:79-121` seeds no `analyzewithai` step.
     - It also skips join, lookup, upsertsource, extractheadings, chunkbytokencount, convertformat and generatetext.
     - So the C8 test "every step kind's editor … by real hit area" covers about two-thirds of `OP_TYPES` and cannot see this. Those other kinds pass in my run.
   - **Fix (both parts):**
     1. Tile the move pair inside the sheet so each button owns at least 44×44 with no overlap. Options:
        - Give each button `min-width: 44px` in the sheet. The row can wrap the name and type onto their own line.
        - Or stack up/down vertically, at most 22px painted each, with expanders that do not overlap.
        - Or space the pair at least 44px centre to centre.
        - Keep `Remove` clear as well.
     2. Extend the C8 seed to every `OP_TYPES` kind the server accepts, including join, lookup, upsertsource, extractheadings, chunkbytokencount, convertformat, analyzewithai with 3 or more output fields so the middle row has both moves enabled, and generatetext. Fail loudly on any omission. Prove red on today's markup.

### Non-blocking notes

- The round-1 polish notes still stand:
  - The "Static / Static · 14 rows" repeat.
  - The "off Compute column" wording.
  - Sticky touch hover on tabs.
  - The `PipelineRiverSkeleton` naming.
- The AI move-pair overlap at ≤430px already exists on main for the desktop/focused editor (`PipelineDetailPage.css` ≤430px expander, unchanged in kind). The fix in CR1 may want to cover that context too. It is required here only because the sheet is this ticket's surface and falls under AC4.
- Gate-defect check: no report I drilled into relied on mtime ordering.

## Skeptic Report — final gate (round 3, skeptic-final-3.md)

**One-line verdict (owner format):** REFUTE — AC4 is broken. The step preview's "N fields ▾" schema disclosure, shown for any step with 13 or more output fields, has a real hit height of 17.75px on the new Preview tab and 35px in the step sheet. I measured this at 375, 390 and 768, in both themes.

I reviewed HEAD `f181c9646478d51177fe46bb95d301e4b17f8979`. I resolved the base live with `resolve-review-base.sh` (main/origin): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`. The round-3 delta is `4d2d6316a..f181c9646`, four files:
- `PipelineMobile.css` and `PipelineDetailPage.css`: +18 and +16 lines
- the e2e spec
- `mutation-proofs.md`

The servers on 7014/9921 were reused. `/proc/<pid>/cwd` shows both run from this worktree's `frontend`/`backend`, and Vite serves the new move-btn rule.

All probes are my own headless Chromium runs (isMobile, hasTouch, DSF 2), paced under the `/api` limit. They used one throwaway user, `77377b1a-bf91-4e70-886f-c3070388f59e`. I deleted it by exact id with `buildUserDeleteSql`, and a re-count shows 0 rows.

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/skeptic-f3/`. All the files named below are in that directory.

### What I verified (with evidence)

**Round-2 defect (the AI move pair): fixed. I verified both the red and the green myself.**
- **Seed:** a 26-step pipeline with every `OP_TYPES` kind. The server accepted all 26 after I corrected one invalid convertformat pair of my own. "Analyze with AI" has 4 output fields.
- **Green on HEAD** (`ai.json`, `ai-dark@375.png`), in all 6 cells (375/390/768 × dark/light):
  - Every move and remove button has an `elementFromPoint` hit extent of 44.75×44.75.
  - The pair's centres are 52px apart, and the down button and Remove are 46px apart.
  - Body overflow is 0.
  - Real `touchscreen.tap` presses at the painted centres give the right order every time: 2-up → `b,a,c,d`, 3-down → `b,a,d,c`, 1-down → `a,b,d,c`, 4-up → `a,b,c,d`.
  - ±20px off-centre probes land on the intended button.
- **Red, with the new margins and flex rule reverted by an injected page style** (`ai-revert.json`, `ai-revert-dark@375.png`):
  - In all 6 cells "Move output field 2 up" is 14px painted with a hit area of 0, and "down" has a hit width of 25.
  - Taps produce wrong orders, e.g. `a,c,b,d` and `c,b,a,d`.
  - This reproduces round 2's defect at 375, 390 and 768.
- **The executor's e2e, run by me** with DEV_PORT=7014, under flock, nice 19, outputDir in scratch:
  - All 4 tests passed in 3.1 minutes: the C8 sweep at 375, 390 and 768, plus the AI "Move output field 2 up" real tap.
  - The run's teardown deleted its 4 recorded throwaway users.
- **Gate scoping:** the ≤430px rule in `PipelineDetailPage.css` is width-gated, not touch-gated. That is consistent with the ≤430px expander it tiles, so it satisfies DESIGN.md §3's "same gate" rule.

**AC1, AC3, and AC4 on the page (`cells.json`, 6 cells): unchanged since round 2.**
- AC1: on the 3-step pipeline, the source is at 227.8, the rows are at 354.8, 418.8 and 482.8, and the output card bottom is 688.8. The bar tops are 696, 728 and 908, so the margin is +7.2 at 375.
- AC3: the pills clear the nav by 8px.
- AC4: 0 failures on the Steps tab (18 controls), the Preview tab (9), the Runs tab (8) and the filter sheet (12).
- The visible Close control closes the sheet.
- There is 1 console 404 per load, the same as before.

**C8 sweep over all 26 editors × 6 cells (`kinds.json`):**
- No failures at 375 or 390.
- At 768 in both themes there are 2 failures: the Analyze-with-AI and Generate-text sheets each have a "14/15 fields ▾" trigger with hit height 41.25. This led to the finding below.

**The finding, reproduced 3 ways** (`prev.json`, `wide.json`, `wideprev.json`, screenshots `prev-ai-768.png`, `wide-dark@375.png`, `wide-previewtab-375.png`):
- **Setup:** I made a pipeline on a 16-column static source with filter, sort and limit steps.
- **Trigger:** `StepPreviewTable` renders `OutputSchemaDisclosure` whenever a step's output schema has more than `SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD` (12) fields. Its trigger is a 17px painted mono text button.
- **On the Preview tab** (`MobilePreviewTab.tsx`, new in this ticket):
  - Hit height is **17.75px** at 375 and 768.
  - The trigger gets no hit expander at all: `::after` height is `auto`.
- **In the step sheet** (the plain Filter step, all 6 cells):
  - Hit height is **35px**.
  - The sheet's family `button::after` expander (44px) is clipped by `.step-preview { overflow: hidden }` (`spine/StepPreviewTable.css:11`). Hit-testing just above the 35px band resolves to `step-preview`.
  - At 768 with a single-line header the clip is the same; that is the 41.25 seen in the sweep.
- **Why it matters:** a wide source is the normal case, not an edge case (REST/CSV sources). The executor's C8 seed and every page sweep use a 3-column source, so no gate has ever rendered this trigger on the Preview tab or with a single-line header.

**Design judgment on the delta:**
- The moved pair reads cleanly in light and dark. The chevrons are evenly spaced, Remove stays boxed, the name and type fields keep usable widths (79/94px at 375), and nothing drifted from round 2's screenshots.
- The C1–C7 and DESIGN.md v3 checks from round 2 still hold: mono name, 12px gutters, accent only on Run, active tab and focus.

### Verdict: REFUTE

This defect is outside the exact round-2 fix, but it breaks AC4 ("All interactive elements meet the 44px touch floor"), so per the owner's rule it is a REFUTE and not a follow-up.

### Change Requests

1. **AC4: the "N fields ▾" disclosure trigger (`.output-schema-disclosure__trigger`) is below the touch floor on this ticket's phone surfaces.**
   - **The defect:**
     - On the Preview tab (`MobilePreviewTab` → `StepPreviewTable`), its hit height is 17.75px because it has no expander.
     - In the step sheet, its hit height is 35px because the sheet's 44px `::after` is clipped by `.step-preview { overflow: hidden }` (`frontend/src/features/pipelines/ui/spine/StepPreviewTable.css:11`).
     - At 768 with a single-line header it is 41.25px.
   - **The fix:**
     - Give the trigger a 44px expander under the touch gate on both surfaces.
     - Keep the expander inside the clip. For example, add vertical padding to `.step-preview__header` under the touch gate so the expander has at least 13.5px of room above and below. Or stop clipping the header, for example by moving the `overflow: hidden` onto `.step-preview__body` only.
     - Tile the expander against the header's neighbours, as DESIGN.md §3 requires.
   - **The test:** extend the C8 sweep and the Preview-tab sweep with a source wider than 12 columns, so the disclosure renders with a single-line header. Show it red on today's markup and green at 375, 390 and 768.

### Non-blocking notes (follow-up candidates, not blocking)

- In the AI row at 375 the row's `scrollWidth` is 325 against a `clientWidth` of 317. This comes from the Remove expander overhang. It is harmless: body overflow is 0 and nothing is clipped.
- The round-1 and round-2 polish notes still stand: the "Static / Static · 14 rows" repeat, the "off Compute column" wording, sticky touch hover on tabs, and the `PipelineRiverSkeleton` naming.
- Gate-defect check: no report I drilled into relied on mtime ordering.

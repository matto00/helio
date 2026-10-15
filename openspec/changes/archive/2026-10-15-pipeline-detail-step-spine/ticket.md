# HEL-1579: Pipeline detail v2 (desktop): step spine, focused step editor, preview table

## Description

The pipeline detail page feels crowded: steps get lost among a source bar, an outputs/schedule bar, tabs, inline step cards with many accent-coloured controls (Output, Branch, Add step, Preview, Remove), and a footer of schema chips plus run buttons. Accent discipline is broken, so nothing stands out.

Three regions under a single compact header (the live output column arrives with the live-preview ticket, HEL-1581. Reserve its slot):

- **Header (one row):** breadcrumb, pipeline name (mono), a status chip, rows written plus relative last run, a schedule chip ("Add schedule" when there is none), Dry run, the primary **Run**, and an overflow menu.
- **Left: step spine (~270–340px).** Source card, numbered steps on a vertical line (each with title, a one-line mono summary and **row count after that step**), "+ Add step", an Output card ("Chart · used in N panels"). The selected step is highlighted with an accent wash and an accent-filled number. Branches render as an indented sub-spine.
- **Centre: the selected step's editor** (one at a time instead of every card expanded), with Disable / Duplicate / Remove as quiet text actions.
- **Centre below: preview table** of rows after the selected step, with the column type shown in the header. Schema chips move here from the footer.
- The accent goes only on the primary Run, the selected step and focus. Every other action is secondary or ghost.
- Reference: "B2 · Pipeline" (PipelineLive board, row 3) on the epic's canvas; local copy at /home/matt/Development/helio/.concertino/design/HEL-1570/ (screenshots/PipelineLive*.png, canvas/project/PipelineLive.dc.html). PipelineDesktop is superseded.

## Acceptance criteria

- [ ] All existing step kinds remain editable through the focused editor, and existing pipeline-editor e2e/unit tests pass or are migrated with no lost assertions
- [ ] The spine shows a per-step row count from the latest run or analyze, and selecting a step updates the editor and the preview table
- [ ] Branches/lanes are visible and selectable in the spine
- [ ] At 1280×800 the spine, editor and at least 8 preview rows are visible without page scroll for a 3-step pipeline
- [ ] Only the Run button, the selected step and focus rings use the accent (Skeptic visual check)

## Binding inputs (from the driver brief, verified by the orchestrator)

- Precedence: ACs and owner rulings, then DESIGN.md v3 (§0, §9 Shell, §11 Live preview, appendix), then HANDOFF.md, then the boards. Boards' data, hex and orange accent are illustration only.
- Owner ruling (HEL-1574 escalation, archive design.md D12, DESIGN.md §9): pipeline/source Delete lives ONLY on the overview rows, never in the detail page or its header.
- No page title duplication (DESIGN.md §9: pipeline top bars carry a small breadcrumb/label, not a display h1; the desktop command bar already shows "Data Pipelines / <name>").
- docs/live-draft-preview.md (HEL-1580) defines the later draft / Save & run model (HEL-1581). Do not build draft mode here, but do not contradict it.
- Related: HEL-1585 (pipeline detail scrolls the whole shell out of view at 1440). Report whether this layout fixes it.
- Blocks HEL-1582 (mobile pipeline page) and HEL-1581 (live preview). Desktop scope: the phone layout stays as is.

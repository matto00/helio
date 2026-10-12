# HEL-1464: After HEL-1432: long table column names overflow the Output editor at desktop widths; 7 more labels point at nothing (Select id now supported); "Color by field" label vs accessible name mismatch

## Description

Origin: HEL-1432 (matto00/helio#904, 2951d0b8), lane-reported. Priority Low; labels Follow-up, Bug.

1. **Desktop overflow:** at 1100/1440px a long column name pushes the table Columns list past the Configuration card:
   23–70px with a 49-char name, 229px with an 86-char name (the whole sheet then scrolls sideways). Same
   `min-width: auto` root cause HEL-1432 fixed for ≤768px. Screenshot:
   `.concertino/runs/HEL-1432/evidence/skeptic-final-long-dark-1100.png`. Verify in both themes; keep HEL-469 (no
   column-name collapse) and HEL-813 (44px tap targets).
2. **Seven labels whose `htmlFor` points at nothing:** add-root-source (AddRootModal), divider-orientation
   (DividerEditor), form-editor-dataset (FormEditor), image-fit (ImageEditor), pipeline-source (CreatePipelineModal),
   schedule-kind (PipelineScheduleDialog), source-method (RestApiForm). Now one-line fixes using the shared `Select`'s
   new `id`. Add a `getByLabelText` test per label (red on the whole pre-fix tree).
3. **WCAG 2.5.3:** the "Color by field" label is announced as "Scatter color-by field" (label and accessible name
   disagree). Align them.

## Acceptance Criteria

- AC1: At 1024, 1100 and 1440px (and 768/375, no regression), a table Output with a 49-char and an 86-char column name keeps
  every Columns-row control and the list itself inside the Configuration card's content box, and the editor sheet has
  no horizontal scroll, in both light and dark themes. A truncated column name exposes its full text (title/tooltip).
  HEL-469 (name/checkbox never 0px wide) and HEL-813 (44px tap floor, move-group gap) invariants hold.
- AC2: Each of the seven labels resolves to its control: `document.getElementById(label.htmlFor)` is the intended
  combobox, ids come from `useId()` (no hardcoded literal ids), and a `getByLabelText`/label-element test per label is
  red on the whole pre-fix tree and green after. A whole-tree sweep shows no literal `htmlFor` without a matching `id`.
- AC3: The "Color by field" control's accessible name contains its visible label text (WCAG 2.5.3), and so does every
  other associated Output-editor label (audit found "Bins" vs "Bin count" — added at the design gate); existing tests,
  e2e and the opening-state snapshot are updated deliberately, not loosened.
- AC4: No new `eslint-disable`; design tokens per DESIGN.md; verified in the running app (keyboard, accessible names,
  both themes, 1440 and 375) with before/after evidence.

## Premise validation (orchestrator, 2026-10-11, origin/main 5b99a846b)

All seven dangling literal `htmlFor` sites still exist and a whole-tree sweep finds exactly these seven (none gone, none
new). New Output-editor label sites since HEL-1432 (HEL-1311 ChartSlotFields, HEL-1307 ConditionalFormatsField) have
matching ids statically. "Color by field" / "Scatter color-by field" at `ChartDisplayFields.tsx:267/271`. Verdict:
no-drift.

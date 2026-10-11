## Why

HEL-1432 gave the shared `Select` an `id` and fixed Output-editor labels and the ≤768px table-options overflow, but left
three defects: the same `min-width: auto` overflow still pushes a long column name past the Configuration card at
desktop widths (up to 229px; the sheet scrolls sideways), seven labels on other surfaces still point at nothing, and the
"Color by field" label is not contained in its accessible name ("Scatter color-by field", WCAG 2.5.3).

## What Changes

- `TableDisplayFields.css`: the shrink-to-card rules (`min-width: 0`, zero-minimum list track) apply at every width;
  the wrapped phone layout stays gated on `max-width: 768px`. A truncated column name gets its full text as `title`.
- Seven components pass a `useId()`-derived id to `Select` and to their label's `htmlFor`: AddRootModal,
  DividerEditor, FormEditor, ImageEditor, CreatePipelineModal, PipelineScheduleDialog, RestApiForm.
- `ChartDisplayFields`: the color-by Select's accessible name contains its visible label "Color by field";
  `HistogramBinCountField`: "Bins" likewise; every Output-editor label is audited for label-in-name.
- Tests: label-element association tests per label (red on the whole pre-fix tree); desktop-width layout evidence.

## Capabilities

### New Capabilities
- `labelled-select-controls`: visible labels outside the Output editor that name a shared `Select` are associated
  with it.

### Modified Capabilities
- `pipeline-output-sheet` (ADDED requirements): table options fit the Configuration card at desktop widths too; Output-editor label text
  is contained in the control's accessible name.

## Impact

Frontend only: `frontend/src/features/panels/ui/editors/{TableDisplayFields.tsx,TableDisplayFields.css,
ChartDisplayFields.tsx,DividerEditor.tsx,FormEditor.tsx,ImageEditor.tsx}`, `frontend/src/features/pipelines/ui/
{AddRootModal.tsx,CreatePipelineModal.tsx,schedule/PipelineScheduleDialog.tsx}`,
`frontend/src/features/sources/ui/forms/RestApiForm.tsx`, plus tests and one snapshot line. No API/schema change.

## Non-goals

- HEL-1500 item 4 (reference-mark rows without visible labels).
- Renaming any other accessible name (e.g. "Scatter point size field", "Bound dataset" — they already contain their
  label text).
- Redesigning the column row or the desktop layout beyond keeping it inside the card.

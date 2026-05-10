# HEL-195 — Step-by-step data preview in pipeline editor

## Title
Step-by-step data preview in pipeline editor

## Description
After each step in the editor, show a sample of the current output rows (first N rows). Preview is fetched from the backend execution engine for the partial pipeline up to the selected step. Helps users validate each transformation before adding the next.

## Acceptance Criteria
- Each step card in the pipeline editor has a "Preview" affordance (button or toggle) that fetches a sample of the output rows produced by that step.
- The preview shows the first N rows (suggested: 10) of the data after applying all steps up to and including the selected step.
- The backend runs the partial pipeline (steps 1..K) and returns sample rows.
- The preview table is rendered inline in the StepCard (or an expandable panel below it).
- Loading and error states are handled gracefully.
- Works with the existing analyze/run infrastructure where possible — prefer reuse over new endpoints.

## Notes
- This is NOT a new pipeline op. It is a UI/UX feature.
- "New pipeline op wiring checklist" does NOT apply.
- Use HEL-233 analyze endpoint as foundation if possible.
- The pipeline editor already has StepCard components — add preview affordance there.
- Parent epic: HEL-141 (Data Pipeline & Registry Hardening)

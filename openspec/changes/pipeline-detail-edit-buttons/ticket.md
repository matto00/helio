# HEL-260: Pipeline detail — lock source toggle, add Edit Source / Edit Type buttons

## Description

Pipelines are **contracts**. Once a pipeline exists, its source and its output type are commitments — editing them should be deliberate, not a casual toggle.

### Today (problem)

- The pipeline detail page exposes a "+ Connect source" button that implies the user can casually swap sources.
- Source chips in the source bar can be toggled, suggesting they're configurable per-pipeline.

### Target behavior

- Replace "+ Connect source" with an explicit **"Edit Source"** button (singular — multi-source is a v1.4 stretch).
- Replace source-toggling with a non-interactive display of the pipeline's current source.
- Add **"Edit Type"** button to access the bound output DataType's schema.
- Both buttons open dedicated modals or navigate to the appropriate detail page; they don't perform inline edits.

## Definition of Done

- No accidental source/type changes possible from the pipeline detail page
- Edit Source / Edit Type are visible, deliberate actions
- Copy stays singular ("Source", not "Sources") since multi-source is a future stretch
- Permissions: editing the source or type is gated by ownership of those resources, not just the pipeline

## Metadata

- Ticket: HEL-260
- URL: https://linear.app/helioapp/issue/HEL-260/pipeline-detail-lock-source-toggle-add-edit-source-edit-type-buttons
- Priority: Medium
- Project: Helio v1.3.1 — Polish & Hardening
- Parent: HEL-241

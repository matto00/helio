# HEL-212 — Empty state when no DataTypes exist

## Title
Empty state when no DataTypes exist

## Description
When a user tries to create a data-bound panel and no DataTypes exist in the registry, show an empty state with a clear explanation and a link to create a pipeline. Does not block creation of cosmetic panel types (Markdown, Image, Divider, Embed).

## Context
- Part of HEL-145 epic: "Type Registry as Defacto Panel Source"
- Sibling tickets HEL-210 (remove DataSource→Panel binding path) and HEL-211 (panel DataType selection modal) are already merged
- HEL-211 introduced a panel creation modal where users select a DataType before creating a data-bound panel
- This ticket adds the empty state to that modal when no DataTypes are registered

## Acceptance Criteria
- When the panel creation modal opens and no DataTypes exist in the registry, display an empty state UI instead of the DataType selection list
- The empty state includes:
  - A clear explanation (e.g. "No data types found. Create a pipeline to get started.")
  - A link/button to navigate to the pipeline/data-types creation flow
- Cosmetic panel types (Markdown, Image, Divider, Embed) are NOT affected — they can still be created even when no DataTypes exist
- The empty state is shown only for data-bound panel type selection, not globally

## Priority
High

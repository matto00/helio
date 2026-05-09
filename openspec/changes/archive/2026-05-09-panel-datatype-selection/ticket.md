# HEL-211 — Panel creation requires DataType selection

## Title
Panel creation requires DataType selection

## Description
Data-bound panel types (metric, chart, text, table) require selecting a registered DataType during creation. The DataType picker lists only types produced by pipelines in the Type Registry.

## Parent Epic (HEL-145)
Epic - Type Registry as Defacto Panel Source

Enforce the pipeline → DataType → Panel binding chain. Remove the direct Data Source → Panel path from frontend and API. Panel creation requires selecting a registered DataType. Empty state prompts users to create a pipeline first. Existing directly-bound panels surface an inline warning to attach a pipeline.

## Context
This ticket is part of the larger effort to make the Type Registry the canonical source of truth for panel data. The goal is that panels must declare which DataType they consume, rather than being created without a type binding or bound directly to a DataSource.

Data-bound panel types are: metric, chart, text, table.

## Acceptance Criteria
- When creating a panel of a data-bound type (metric, chart, text, table), the panel creation flow includes a DataType picker step
- The DataType picker lists only DataTypes that are produced by at least one pipeline registered in the Type Registry
- Selecting a DataType is required before the panel can be created (the submit button is disabled until a DataType is chosen)
- The selected DataType ID is stored on the panel record (dataTypeId field)
- If no DataTypes are available (no pipelines registered), an empty state is shown prompting the user to create a pipeline first
- The backend POST /api/panels endpoint accepts and persists the dataTypeId
- Non-data-bound panel types (e.g., free-form/static) do not require DataType selection

## Priority
High

# HEL-179 — Data Pipelines list view

## Title
Data Pipelines list view

## Description
List view for all pipelines: shows pipeline name, source data source, output DataType name, last-run status (succeeded / failed / never run), and last-run timestamp. Empty state with a create button when no pipelines exist.

## Acceptance Criteria
- A "Data Pipelines" section/page is accessible from the app navigation
- The list displays all pipelines with the following columns/fields:
  - Pipeline name
  - Source data source name
  - Output DataType name
  - Last-run status: one of "succeeded", "failed", or "never run"
  - Last-run timestamp (or blank/dash when never run)
- When no pipelines exist, an empty state is shown with a "Create pipeline" button (button can be non-functional / placeholder for now)
- The list fetches data from the backend API (GET /api/pipelines or equivalent)
- UI matches the existing Helio design system (typography, colors, spacing)

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Parent
HEL-140

# HEL-181 — Refactor Data Sources into standalone sidebar section

## Title
Refactor Data Sources into standalone sidebar section

## Description
Extract Data Sources from the current combined view into its own top-level sidebar section with its own route. Preserve all existing list, detail, create, and delete functionality.

## Acceptance Criteria
- Data Sources has its own top-level entry in the sidebar navigation
- Data Sources has its own dedicated route (e.g. /data-sources)
- All existing functionality is preserved:
  - List data sources
  - View data source detail
  - Create data source
  - Delete data source
- Navigation between sidebar sections works correctly
- No regressions in existing Data Sources UI behaviour

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Priority
High

## Parent
HEL-140

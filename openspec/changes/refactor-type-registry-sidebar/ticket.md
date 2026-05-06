# HEL-182: Refactor Type Registry into standalone sidebar section

## Title
Refactor Type Registry into standalone sidebar section

## Description
Extract Type Registry from the current combined view into its own top-level sidebar section with its own route. Preserve all existing list, detail, and management functionality.

## Acceptance Criteria
- Type Registry is a top-level sidebar entry (not nested under another section)
- Type Registry has its own dedicated route (e.g. /type-registry or similar)
- All existing list, detail, and management functionality is preserved
- Navigation to Type Registry works from the sidebar
- Existing Type Registry components and logic are reused (no rewrites)
- No regressions in Data Sources or other sidebar sections

## Priority
High

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Parent
HEL-140

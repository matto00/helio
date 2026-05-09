# HEL-210 — Remove direct Data Source → Panel binding path

## Title
Remove direct Data Source → Panel binding path

## Description
Remove any frontend UI and API paths that allow a panel to bind directly to a Data Source. Update OpenAPI spec. Any remaining direct-binding code paths should return a clear error.

## Priority
High

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Parent
HEL-145

## Acceptance Criteria
- No frontend UI element allows a panel to bind directly to a Data Source
- Any API paths that previously allowed direct panel → Data Source binding either no longer exist or return a clear error (e.g., 400 Bad Request with a descriptive message)
- OpenAPI spec is updated to reflect the removal or error behavior
- Existing tests are updated / new tests are added to cover the removed paths and the error responses

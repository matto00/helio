# HEL-185 — Pipeline create/edit flow scaffold

## Title
Pipeline create/edit flow scaffold

## Description
Frontend create and edit flows wired to the pipeline CRUD API. Create flow: name, source selection, initial step list (empty). Edit flow: load existing pipeline and steps into the editor. Save/cancel with unsaved changes detection.

## Acceptance Criteria
- Create flow: user can enter a pipeline name, select a data source, and start with an empty step list; submitting calls POST /api/pipelines and navigates to the editor
- Edit flow: navigating to /pipelines/:id/edit loads the existing pipeline (name, source) and its steps via GET /api/pipelines/:id/steps into the editor form
- Save action: calls PATCH /api/pipelines/:id (and any step mutations) and returns to the pipeline list on success
- Cancel action: if there are unsaved changes (dirty state), prompt the user to confirm before discarding; if clean, navigate away immediately
- Unsaved changes detection: the form tracks dirty state (original vs. current values); the browser's beforeunload event also warns if the user tries to close/navigate away with dirty state
- Loading and error states are handled gracefully (spinner while fetching, error message on failure)
- All new components are covered by unit tests

## Parent
HEL-141

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Priority
High

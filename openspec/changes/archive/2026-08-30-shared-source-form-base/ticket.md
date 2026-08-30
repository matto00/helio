# HEL-720: De-duplicate TextSourceForm/PdfSourceForm/ImageSourceForm into a shared base form

## Description

Row 0d of the Pipelines & Outputs remodel (HEL-903) — parallel with 0a–P1.3. The shared base form is reused by the inline source creation in "New pipeline" (P1.5, HEL-908).

From the beta UI/UX polish sweep (PR #382).

**Scope**
`TextSourceForm`, `PdfSourceForm`, and `ImageSourceForm` are near-identical (upload control + name field + submit), each hand-rolled independently. Extract a shared base form/hook that the three source-type-specific forms compose, reducing triplicated validation, error handling, and layout code.

## Acceptance Criteria

- One shared implementation backs all three unstructured-source forms.
- No behavior change for users; validation/error messages stay consistent across all three.

## Notes (orchestrator-added context)

- Design spec: `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` on `main` wins wherever it disagrees with this ticket. If the ticket's scope references Data Types/Metrics as user-facing concepts, that is stale pre-remodel wording — the spec deletes them wholesale.
- Row 0c (HEL-725, merged to main) landed `PageShell`/`PageHeader`/`PageStatus` primitives at `frontend/src/shared/ui/`. Use them rather than hand-rolling containers or loading/error states where applicable to these forms — check what exists there first.
- This is a frontend ticket: `DESIGN.md` is binding, and the UI gate applies (skeptic must drive the running app via Playwright, not just read code).
- `StaticSourceForm`/`useRestSourceForm` in the same directory are a different source type (REST) and are NOT in scope for this de-duplication — do not fold them in unless doing so is a trivial, natural consequence of the shared base; if scope creep is tempting, prefer a spinoff ticket instead.

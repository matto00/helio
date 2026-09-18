# HEL-1086: File upload field

## Description

A file field storing through the existing uploads backend (`HELIO_UPLOADS_BACKEND`, local/gcs) and writing a `binary-ref` cell — the same convention `ImageSource` already uses. No new storage concept.

## Acceptance Criteria

- Upload works on both `local` and `gcs` backends.
- The resulting cell resolves to a fetchable file.
- Keyboard-operable file picker with an accessible name and a visible selected-file state.

## Context

- Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)
- Parent epic: HEL-1082. Related: HEL-1085 (shipped the six non-file field renderers, explicitly deferring `file` to this ticket).
- `FormSubmission.scala` currently hard-rejects any supplied value for a `control == "file"` field with `"file fields are not yet supported"` (tagged HEL-1086) — this ticket removes that rejection and implements the real path.
- Submission MUST go through the existing `POST /api/panels/:id/submit` path (HEL-1087) — `FormSubmission.buildRow` composed under the bound source's lock — never a parallel write route.
- `binary-ref` wire convention: `BinaryRefType -> "binary-ref"` (`domain/model/model.scala`). The closest existing analog for a form-submitted (non-pipeline) file write is `ImageUploadService` (HEL-246): validates extension/size, writes bytes via the shared `FileSystem` abstraction (respects `HELIO_UPLOADS_BACKEND`/`HELIO_UPLOADS_ROOT`/`HELIO_UPLOADS_BUCKET`) to a `storageKey`, and returns metadata. `BinaryRefRepository` itself is pipeline-node-keyed and not directly reusable for a literal form row.

## Standing Constraints (carried from earlier HEL-108x leaves)

- [C1] Assert computed ARIA state, never presence — measure the running app's accessible name / aria-invalid / aria-describedby associations, not markup presence in a snapshot.
- [C2] Prove behavior red by mutation, one layer at a time — a mutation that stays green because a different layer masks it is not evidence.
- [C3] Write-path caution: uploads target only the configured backend; a rejected submit stores no file and writes no row (prove with before/after counts, check for orphans); a stored reference cannot resolve outside the uploads root.

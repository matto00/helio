## Why

A `form` panel's `file` control is authorable (HEL-1084) but unrenderable and unsubmittable: the client has no
renderer for it and the server hard-rejects any supplied value (`FormSubmission.scala`: "file fields are not yet
supported"). HEL-1086 completes the field set so a form can actually capture and persist an uploaded file.

## What Changes

- Render a keyboard-operable file picker control for `control: "file"` fields, with a computed accessible name
  and a visible/announced selected-file state (mirrors the accessibility bar the other six controls already
  meet, HEL-1085).
- Client submit path sends the selected file's bytes to the server as part of (or alongside) the existing
  `POST /api/panels/:id/submit` call — no new, parallel write route.
- Server accepts a `file` field's value: validates it (extension/size, reusing `ImageUploadService`'s existing
  validation shape), writes bytes via the shared `FileSystem` abstraction (respecting `HELIO_UPLOADS_BACKEND` /
  `HELIO_UPLOADS_ROOT` / `HELIO_UPLOADS_BUCKET`), and writes a `binary-ref`-shaped cell value into the appended
  row — the same wire convention (`BinaryRefType -> "binary-ref"`) already used elsewhere.
- Remove `FormSubmission.scala`'s current unconditional rejection of `file`-control values; replace it with
  real validation (required/optional, extension, size) equivalent to every other control's rules.
- A rejected submit (validation failure, storage failure) writes neither a file nor a row.

## Capabilities

### New Capabilities
(none — file-field behavior is added to the existing form-panel capabilities below)

### Modified Capabilities
- `form-panel-rendering`: adds the `file` control's render requirements (keyboard operability, accessible
  name, visible selected-file state), and retires/re-adds the "not-yet-supported fields" requirement to drop
  the file case. `openspec archive` never rewrites an existing spec's `## Purpose` section from a delta
  (verified against the shipped CLI's `specs-apply.js`) — the spec's current Purpose ("...renders its
  non-file fields...") is stale once this ships and needs a manual post-archive edit (tasks.md 3.4).
- `form-panel-submit`: replaces the "a value for a `file` field is always rejected" requirement with real
  accept/validate/store requirements; updates the "field the form renders non-editable" framing for `file`.

## Impact

- Frontend: `FormFieldControl.tsx`, `FormPanelView.tsx`/`FormRenderer.tsx`, `formSubmission.ts`,
  `useFormPanelValues.ts` (or a new file-value hook), `panelService.ts` (submit call shape).
- Backend: `FormSubmission.scala` (remove file rejection, add validation), the `submit` route/service
  (accept multipart or a two-step upload-then-submit, TBD in design.md), a file-storage integration point
  reusing `FileSystem`/uploads-backend config (new or adapted service alongside `ImageUploadService`).
- No new storage concept, no new migration expected (reuses `binary-ref` wire shape); design.md will confirm
  whether a persistence row (à la `BinaryRefRepository`, pipeline-keyed) is needed or whether the metadata
  lives inline in the row cell only, mirroring `ImageUploadService`'s simpler no-separate-index approach.

## Non-goals

- No pipeline-side file ingestion change; `BinaryRefRepository` (pipeline-node-keyed) is not modified.
- No new file types/extensions beyond what the uploads backend already accepts elsewhere.
- No drag-and-drop; a standard keyboard/pointer-operable `<input type="file">`-based control is sufficient.

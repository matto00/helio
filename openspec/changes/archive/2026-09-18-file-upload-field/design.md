## Context

See proposal.md - Why. Key existing facts (verified in-tree, see premise-validation.md):
- `FormSubmission.buildRow(config, declaration, values: Map[String, JsValue])` is a pure builder; the route
  currently accepts only JSON (`entity(as[FormSubmitRequest])`) at `POST /api/panels/:id/submit`
  (`PanelRoutes.scala`).
- `FileSystem` trait (`infrastructure/storage/FileSystem.scala`) is the storage abstraction already
  respecting `HELIO_UPLOADS_BACKEND`/`HELIO_UPLOADS_ROOT`/`HELIO_UPLOADS_BUCKET`; `ImageUploadService`
  (HEL-246) is the closest analog: validates extension/size, writes via `FileSystem.write(storageKey, bytes)`
  to `<prefix>/<uuid>.<ext>`, and there's precedent for `Multipart.FormData` handling in
  `DataSourceRoutes.scala`/`UploadRoutes.scala`.
- `BinaryRefType -> "binary-ref"` is the wire type tag (`domain/model/model.scala`); `BinaryRefRepository` is
  a pipeline-node-keyed secondary index over pipeline-run-produced binary refs — not applicable to a literal
  form-submitted row, which never runs through the pipeline engine.

## Goals / Non-Goals

**Goals:**
- One atomic server operation: validate everything (including the file), then store the file, then append
  the row — under the existing per-source lock `submitForm` already uses (HEL-1087 D3).
- A rejected submit (any field, not just the file) leaves neither a stored file nor an appended row.

**Non-Goals:**
- No standalone "upload then reference" two-step flow — rejected because a two-step flow can leave an
  orphaned file on the backend when the second (submit) step fails, violating the "rejected submit stores no
  file" requirement without extra cleanup machinery this ticket doesn't need.
- No change to `BinaryRefRepository` or the pipeline engine's binary-ref extraction.
- No new file types beyond what an uploads-backend-wide allowlist already governs elsewhere.

## Decisions

**D1 — Single multipart request, not two requests.** `POST /api/panels/:id/submit` gains an alternate
multipart/form-data body shape alongside its existing JSON shape, dispatched via `concat(...)` with a second
`entity(as[Multipart.FormData])` branch — Pekko HTTP's per-branch unmarshaller rejects on content-type
mismatch and falls through to the next branch, the same `concat` + unmarshaller-rejection mechanism
`DataSourceRoutes.createMultipartUploadRoute` already relies on (not an explicit `Content-Type` header
switch). The multipart body carries one
`values` part (the same JSON shape as today, for every non-file field) plus zero-or-more file parts named by
their `sourceField`. The route layer collects the multipart entity into `(valuesJson: Map[String, JsValue],
files: Map[String, (filename: String, bytes: Array[Byte])])` and calls `panelService.submitForm` with both.
Alternative considered: base64-encode file bytes inside the existing JSON body. Rejected — inflates payload
~33%, and `FormSubmission` would need to become byte-aware/impure for size validation, when multipart keeps
the existing pure `Map[String, JsValue]` builder almost untouched.

**D2 — `FormSubmission.buildRow` gains a file-presence marker, not file bytes.** Before calling `buildRow`,
`PanelService.submitForm` folds `files` into the `values` map as a small `JsObject` placeholder (e.g.
`{"__file": true, "filename": ..., "sizeBytes": ...}`) for any `file`-control field with an attached file, so
`buildRow`'s existing required/undeclared/unconfigured checks work unmodified for file fields (a file field
with an attachment is "supplied"; without, "not supplied" — same `isEmptyValue` shape). `buildRow` performs
the extension/size check against the placeholder's `filename`/`sizeBytes` (no bytes needed for that check) and
returns a `Left` on a bad extension/size exactly like any other field-level rejection — so file storage is
never attempted until every field, file included, has already passed. Only after `buildRow` returns `Right`
does `PanelService.submitForm` write each attached file's real bytes via `FileSystem.write` and substitute the
placeholder in the built row with the real `binary-ref` JSON object (`storageKey`, `mimeType`, `filename`,
`sizeBytes`), before calling `DataSourceRepository.appendBuiltRow` under the existing lock. If the file write
itself fails (backend I/O error), nothing is appended and the error surfaces as a `500`/transport failure —
covered by the existing "transport or non-field failure" spec requirement, not a new one.

**D3 — Storage key shape.** `form-uploads/<uuid>.<ext>` (new prefix, sibling to `ImageUploadService`'s
`images/<uuid>.<ext>`) — namespaced separately so a form upload is trivially distinguishable from a
panel-literal image upload in the backend's storage listing, with the same UUID-named-file approach (the
original filename is never used as the storage key, closing the path-traversal spec scenario by
construction — `FileSystem.write` never sees a caller-controlled path segment).

**D4 — Extension/size limits reuse `ImageUploadService`'s pattern, not its literal `allowedExtensions`.** A
form file field isn't only images. New config: `FORM_UPLOAD_MAX_FILE_SIZE_BYTES` (default matches
`ImageUploadService`'s `10485760L`) and a small extension allowlist covering common document/image types
(exact list: implementation detail, not spec-level — the spec only requires *some* configured, enforced
allowlist and size bound, mirroring the existing image-upload requirement shape).

**D5 — Client sends multipart only when a file is attached.** `panelService.ts`'s submit call keeps sending
plain JSON when no `file` field holds a value (every existing non-file form keeps working unchanged, zero
behavior change for the six already-shipped controls); it switches to `FormData`/multipart only when at least
one `file` field is populated.

## Risks / Trade-offs

- [Risk] Multipart parsing adds a second code path to an otherwise-pure JSON route → [Mitigation] the
  multipart branch is a thin adapter that produces the exact same `Map[String, JsValue]` input `buildRow`
  already accepts; `buildRow` itself stays pure and single-shaped.
- [Risk] A large file could block the actor system during multipart collection → [Mitigation] reuse the same
  size-bound-then-reject pattern `ImageUploadService`/`DataSourceRoutes` already apply; the route-level
  pre-check happens before the full entity is buffered where Pekko HTTP's multipart directives allow it,
  matching existing upload routes' own trade-off (not a new one this ticket introduces).
- [Risk] GCS backend not locally testable → [Mitigation] `FileSystem` is already backend-abstracted and
  covered by existing GCS-backend tests for `ImageUploadService`/connector uploads; this change adds no new
  GCS-specific code, only a new storage-key prefix and a new metadata shape, so the existing abstraction's
  test coverage is the applicable evidence — call this out explicitly if a live GCS bucket isn't reachable
  from the delivery worktree.

## Migration Plan

No schema migration. No new persisted table — the `binary-ref` metadata lives inline in the row cell exactly
like every other cell value (`node_snapshots`-equivalent dataset-row storage), consistent with D1/Non-Goals
(no new `BinaryRefRepository` entry). No rollback concerns beyond a normal revert.

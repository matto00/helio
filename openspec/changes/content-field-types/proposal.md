## Why

The Type Registry only models structured scalar field types (string, integer, float,
boolean, timestamp). The v1.4 Unstructured Data release needs to represent large text
bodies (extracted document/markdown text) and references to stored binaries (PDF, image)
as first-class field values, distinct from structured data, so the upcoming connectors
(HEL-214 PDF, HEL-215 text/markdown, HEL-216 image) and text pipeline ops (HEL-219/220/221)
have a stable contract to produce and consume against.

## What Changes

- Add a `FieldTypeCategory` distinction (`Structured` | `Content`) over the existing
  `DataFieldType` vocabulary.
- Add two new `DataFieldType` variants: `StringBodyType` (wire: `string-body`) and
  `BinaryRefType` (wire: `binary-ref`).
- Define the row-value shape each content type carries: `string-body` is a plain JSON
  string (already supported by the existing JSONB row storage); `binary-ref` is a small
  JSON object `{storageKey, mimeType, filename, sizeBytes}` referencing a file in the
  existing uploads store (`FileSystem` abstraction / `HELIO_UPLOADS_BACKEND`).
- Add a `binary_refs` table (Flyway migration) + `BinaryRef` domain model + repository so
  binary metadata is queryable and lifecycle-manageable independent of the opaque JSONB
  row blob — the durable "reference to a stored binary" downstream connectors write to
  and pipeline ops read from.
- Frontend: recognize the two new `dataType` strings wherever field-type badges/icons are
  rendered in the Type Registry, so new types display sensibly rather than falling through
  to an "unknown" state.

## Capabilities

### New Capabilities

- `type-registry-content-fields`: `FieldTypeCategory`, the two new `DataFieldType`
  variants, the `binary_refs` table/repository, and the value-representation contract
  content-producing connectors and content-consuming pipeline ops build on.

### Modified Capabilities

- `schema-inference`: the `DataFieldType` sealed-type requirement is updated from "exactly five
  variants" to seven, adding the two content variants and their canonical wire strings. No
  inference *behavior* (CSV/JSON heuristics) changes — no connector infers a content type in this
  change — only the vocabulary requirement itself.

## Impact

- Backend: `domain/model.scala` (`DataFieldType`, new `FieldTypeCategory`, `BinaryRef`),
  new `BinaryRefRepository`, new Flyway migration. No `DataTypeProtocol`/JSON-formatter changes
  are needed — `BinaryRef` has no REST route and no JSONB column in `binary_refs` (flat scalar
  columns only), and `InferredField`/`DataField.dataType` already cross the wire as plain
  strings via `asString`.
- Frontend: `features/dataTypes` field-type badge/icon lookups.
- No changes to existing structured-type behavior, casting, or pipeline execution.

## Non-goals

- Implementing the HEL-214/215/216 connectors themselves (they consume this contract).
- Implementing the HEL-219/220/221 text pipeline ops (they consume this contract).
- Binary upload UI, or a garbage-collection job for orphaned binaries (follow-up work).
- Adding server-side validation/allow-listing of `dataType` strings generally — none
  exists today for structured types either; out of scope for this ticket.

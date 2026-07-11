# HEL-215: Plain text and Markdown connector

**Linear URL:** https://linear.app/helioapp/issue/HEL-215/plain-text-and-markdown-connector
**Parent epic:** HEL-146 (Helio v1.4 — Unstructured Data)
**Priority:** Medium

## Description

Data Source connector for `.txt` and `.md` files. Ingests content as a single
string field. Registers filename and byte size as metadata fields. Supports
file upload and URL-based ingestion.

## Orchestrator-supplied context

This is the **FIRST connector of the v1.4 Unstructured Data release** (epic
HEL-146), delivered deliberately on its own so it establishes the reusable
connector→content-type integration pattern that the next connectors (HEL-214
PDF, HEL-216 image) will follow.

### Scope

- A Data Source connector for `.txt` and `.md` files.
- Ingests file content as a single string field.
- Registers `filename` and byte size as metadata fields.
- Supports **file upload** AND **URL-based ingestion**.

### Build on HEL-217 (just merged, commit 6ea75a1)

Use the new `StringBodyType` content field type from the Type Registry
(`DataFieldType` in `backend/src/main/scala/com/helio/domain/model.scala`) for
the ingested content field.

### Design requirement

Keep the source-registration / connector wiring clean and reusable, since
HEL-214 (PDF) and HEL-216 (image) will extend the same infrastructure. The
design doc must call out the integration seam future connectors should reuse
(e.g. how a connector declares its supported file extensions/MIME types, how
it maps extracted content + metadata onto `DataFieldType`s, how upload vs.
URL-based ingestion share a common ingestion path).

## Acceptance criteria (derived from description — confirm during planning)

- Users can create a Data Source of type "Plain text / Markdown" via file
  upload.
- Users can create the same Data Source type via URL (fetch content from a
  remote URL).
- Ingested content is stored as a single field using `StringBodyType`.
- `filename` and byte size are registered as metadata fields on the resulting
  data type/row.
- `.txt` and `.md` extensions are both accepted by this connector.
- Connector wiring is structured so that HEL-214/HEL-216 can add new file-type
  connectors without duplicating upload/URL ingestion plumbing.

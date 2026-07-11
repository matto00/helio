# HEL-216 — Image connector

**Epic:** HEL-146 (v1.4 Unstructured Data)
**Project:** Helio v1.4 — Unstructured Data
**Linear URL:** https://linear.app/helioapp/issue/HEL-216/image-connector

## Description

Data Source connector for images. Stores images as binary references.
Registers filename, dimensions (width x height), and MIME type as metadata
fields. Supports file upload and URL-based ingestion.

## Acceptance criteria (derived from description + reuse mandate below)

- New Data Source connector type for images (file upload AND URL-based
  ingestion), following the connector pattern established by HEL-215
  (plain text/Markdown connector, merged in `8935b2e` / PR #208).
- Image content is stored as `BinaryRefType` content (the
  `{storageKey, mimeType, filename, sizeBytes}` shape defined by HEL-217 in
  `backend/src/main/scala/com/helio/domain/model.scala`). Persist the binary
  via the existing uploads backend (`HELIO_UPLOADS_*` config, the
  local|gcs storage abstraction) and the `binary_refs` table /
  `BinaryRefRepository` HEL-217 added. Do not invent new storage.
- Registers metadata fields: filename, dimensions (width x height), MIME
  type, and size (bytes) — consistent with `ContentSourceSupport.metadataFields`
  conventions.
- URL-based ingestion MUST go through
  `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala`
  (`fetchUrl` / `validateUrl`) — do NOT write a new HTTP client. This guard
  closes SSRF vectors (scheme allowlist; rejects loopback/link-local incl.
  169.254.0.0/16 metadata range/RFC1918/IPv6-ULA/multicast; DNS-rebinding
  TOCTOU closed via pinned transport; no auto-redirect; no upstream-body
  leak). Any bypass is a security regression and will be rejected at the
  gate.
- Reuse `ContentSourceSupport.metadataFields` / `validateExtension` /
  `filenameFromUrl` where applicable instead of reimplementing.
- Follows the connector pattern HEL-215 established (service wiring, API
  routes, frontend data-source creation UI, tests) — mirror its shape for
  images rather than diverging.

## Explicit reuse mandate (do not reinvent)

1. **Content field types** — HEL-217, `backend/src/main/scala/com/helio/domain/model.scala`
   (`DataFieldType`, `BinaryRefType`).
2. **Connector seam** — HEL-215,
   `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala`.
   URL fetch MUST use `ContentSourceSupport.fetchUrl` / `validateUrl`.
3. **Binary storage** — HEL-217's `binary_refs` table / `BinaryRefRepository`,
   backed by the existing uploads backend (`HELIO_UPLOADS_BACKEND`,
   `HELIO_UPLOADS_BUCKET`, `HELIO_UPLOADS_ROOT` / local|gcs storage
   abstraction). Do not add new storage plumbing.

## Environment / delivery notes (from orchestrator, not part of scope)

- Local `main` was fetched and confirmed up to date with `origin/main`
  (`8935b2e`, includes HEL-215) before branching.
- This ticket runs in parallel with HEL-214 (PDF connector), which also
  extends `ContentSourceSupport` / `DataSourceService`. If the PR shows
  CONFLICTING at delivery, rebase onto `origin/main` before finalizing.
- Repo auto-merge is disabled; the human handles merges. The PR should be
  presented and delivery should pause there — do not merge.
- If a rebase requires a force-push, STOP and ask the human directly rather
  than routing it through a relayed approval.

## Non-goals / do not do

- Do not implement image processing/transformation (resizing, thumbnails,
  format conversion) beyond reading dimensions/MIME/size metadata — that is
  out of scope unless the design phase determines it's required to satisfy
  "registers dimensions as metadata."
- Do not modify HEL-214 (PDF connector)'s in-flight work; if both changes
  touch the same file, resolve via rebase, not by reverting the other
  ticket's changes.

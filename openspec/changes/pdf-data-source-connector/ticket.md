# HEL-214: PDF connector

## Description

Data Source connector for PDF files. Extracts text content per page or as a
full-document string. Registers page number and character count as metadata
fields in the output schema. Supports file upload.

Epic: HEL-146 (v1.4 Unstructured Data), project "Helio v1.4 — Unstructured Data".

## Expanded scope (from orchestrator briefing)

This is the PDF connector — a Data Source connector for `.pdf` files that
extracts text (per page) and registers metadata (filename, size, page count,
etc.). Supports **both** file upload AND URL-based ingestion. It follows the
connector pattern just established by HEL-215 (merged, plain text/Markdown
connector).

## Reuse requirements — do not reinvent

- **HEL-217** gave content field types: `DataFieldType` in
  `backend/src/main/scala/com/helio/domain/model.scala`. Store extracted PDF
  text as `StringBodyType` content (per page, and/or full-document).
- **HEL-215** created a reusable connector seam:
  `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala`.
  - For URL-based ingestion you **MUST** fetch via
    `ContentSourceSupport.fetchUrl` (or its `validateUrl` guard) — do **NOT**
    write a custom HTTP client. This helper carries a hardened SSRF guard
    (scheme allowlist; rejects loopback/link-local incl. 169.254.0.0/16
    metadata range/RFC1918/IPv6-ULA/multicast; DNS-rebinding TOCTOU closed via
    a pinned transport; no auto-redirect; no upstream-body leak). Any new
    URL-fetch code path that bypasses this guard is a security regression and
    will be rejected at the gate.
  - Also reuse `ContentSourceSupport.metadataFields` / `validateExtension` /
    `filenameFromUrl` where applicable.
- Pick a mature JVM PDF text-extraction library (e.g. Apache PDFBox); call out
  the dependency choice explicitly in the design doc.

## Acceptance criteria (derived)

- New Data Source connector type for `.pdf` files.
- Extracts text per page (and/or as a full-document string).
- Registers metadata fields in the output schema: filename, size, page count,
  and other fields consistent with the HEL-215 connector pattern
  (`ContentSourceSupport.metadataFields`).
- Extracted text stored using the `StringBodyType` content field type
  (HEL-217).
- Supports file upload.
- Supports URL-based ingestion via `ContentSourceSupport.fetchUrl` /
  `validateUrl` — no bespoke HTTP client.
- Follows the exact connector registration/wiring pattern established by
  HEL-215 (parity: apply/infer, allowedOps if applicable, Flyway migration if
  schema changes are needed, frontend step/config card parity with the
  existing connector UI).

## Environment / delivery notes

- local `main` was fetched and is up to date with `origin/main` at the time
  branch was cut (`8935b2e`, includes HEL-215).
- Running in parallel with **HEL-216** (image connector) — both extend
  `ContentSourceSupport`/`DataSourceService`. If this PR shows `CONFLICTING` at
  delivery time, rebase onto `origin/main` before finalizing.
- **Delivery protocol:** repo auto-merge is disabled; the human handles
  merges. Present the PR and pause at delivery — do not merge.
- If a rebase requires a force-push, pause and ask the human directly — do
  not route a force-push through a relayed approval.

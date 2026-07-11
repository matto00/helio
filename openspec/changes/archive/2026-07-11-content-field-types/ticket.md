# HEL-217: Content field type in Type Registry

**Team:** Helio Platform
**Project:** Helio v1.4 — Unstructured Data (epic HEL-147)
**Priority:** Medium
**Linear URL:** https://linear.app/helioapp/issue/HEL-217/content-field-type-in-type-registry

## Description

Add a content field type to the Type Registry schema: string-body (large text)
and binary-ref (reference to a stored binary). Distinct from existing
structured field types. Backend schema update + Flyway migration.

## Orchestrator-provided context

This is the **keystone** of the v1.4 Unstructured Data release (epic HEL-147).
It adds content field types to the Type Registry — `string-body` (large text)
and `binary-ref` (reference to a stored binary) — distinct from existing
structured field types. Backend schema update + Flyway migration.

It unblocks the v1.4 connectors (HEL-214 PDF, HEL-215 text/markdown, HEL-216
image) and text pipeline ops (HEL-219/220/221), which all produce or consume
content-typed fields — so **design the type model to be clean and extensible
for those downstream consumers**. Treat this as foundational/contract work:
downstream tickets will build directly on whatever shape is chosen here.

## Acceptance criteria (derived from description — confirm/refine during planning)

- Type Registry schema supports a new field-type category distinct from
  existing structured field types (string, number, boolean, date, etc.).
- Two content field types are introduced:
  - `string-body`: large text content (e.g. extracted document text, markdown
    body).
  - `binary-ref`: a reference to a stored binary (e.g. an uploaded PDF or
    image), not the binary bytes themselves inline in the row.
- Backend schema (JSON Schema / OpenAPI contract in `schemas/` and
  `openspec/`) updated to reflect the new field types.
- Flyway migration added for any DB-level representation changes needed to
  support the new field-type category (e.g. Type Registry field-type enum/
  constraint, row storage considerations for large text vs. reference values).
- Existing structured field types and their behavior remain unaffected
  (backward compatible).
- Type model designed for extensibility: downstream tickets (HEL-214/215/216
  connectors, HEL-219/220/221 text pipeline ops) must be able to produce
  (connectors) and consume (pipeline ops) content-typed field values without
  further schema changes to the core content-type concept.

# HEL-218: Unstructured type indicator in registry list

**URL:** https://linear.app/helioapp/issue/HEL-218/unstructured-type-indicator-in-registry-list
**Project:** Helio v1.4 — Unstructured Data (epic HEL-147) — this is the FINAL ticket of the v1.4 release
**Priority:** Medium

## Description

Type Registry list view shows a distinct badge or icon for unstructured DataTypes
(those containing a content field) to differentiate them from structured types at
a glance.

## Context (from orchestrator brief)

- A DataType is "unstructured" when it has a content field type (`StringBodyType` /
  `BinaryRefType`) — the `FieldTypeCategory.Content` classifier added by HEL-217, in
  `backend/src/main/scala/com/helio/domain/model.scala`.
- The v1.4 connectors (HEL-215 text/md, HEL-214 PDF, HEL-216 image, all merged) now
  produce such DataTypes. This indicator gives them a distinct affordance in the
  registry.
- This is primarily a frontend change (registry list rendering). Check whether the
  DataType wire shape already surfaces field categories, or whether the API/protocol
  needs to include a category/kind hint. Keep any backend change minimal and
  additive.
- Bind to `DESIGN.md` for the frontend indicator (tokens, existing badge/indicator
  patterns) — reuse an existing badge/chip primitive rather than inventing new
  visual language.
- No pipeline op here, so likely no Flyway migration required — confirm during
  planning/implementation.

## Acceptance Criteria (derived)

- Type Registry list view visually differentiates unstructured DataTypes (those
  with a `FieldTypeCategory.Content` field, i.e. `StringBodyType` / `BinaryRefType`)
  from structured DataTypes.
- Indicator reuses an existing badge/chip primitive per DESIGN.md, not new visual
  language.
- Any backend/wire-shape change needed to expose the classification to the client
  is minimal and additive (no breaking changes to existing DataType consumers).

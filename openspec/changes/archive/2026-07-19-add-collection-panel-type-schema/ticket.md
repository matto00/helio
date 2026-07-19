# HEL-310 — create-panel-request schema missing `collection` in type enum

- **Ticket:** HEL-310
- **Type:** Bug
- **Priority:** Medium
- **Project:** Helio v1.5 — Panel System v2
- **URL:** https://linear.app/helioapp/issue/HEL-310/create-panel-request-schema-missing-collection-in-type-enum

## Context

Found during HEL-305 review (pre-existing). `schemas/create-panel-request.schema.json`'s `type` enum does not include `collection` (added in HEL-247, PR #233), so the JSON Schema contract rejects/under-specifies collection panel creation even though the backend supports it.

This matters beyond docs: the schemas are the source of truth for the API contract, and the agent-native layer (helio-mcp `create_panel`) builds on that contract — an agent following the schema cannot create collection panels.

## What

Add `collection` to the `type` enum (and any sibling schema locations that enumerate panel types — audit `panel.schema.json` and the OpenAPI specs for the same gap). Verify `check:schemas` passes and that a `POST /api/panels` with `type: "collection"` validates end-to-end.

## Acceptance criteria

- [ ] `create-panel-request.schema.json` accepts `type: "collection"`
- [ ] Audit note listing every schema/spec location that enumerates panel types, each updated or confirmed correct
- [ ] Contract test (or schema check) covering collection panel creation

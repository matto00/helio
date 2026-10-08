# HEL-1240: Fix stale comment on OutputBindingSpec.Markdown ("free-form template string" binding)

## Description

The comment above `OutputBindingSpec.Markdown` (backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala,
~lines 94-99 — now lines 97-102) says the markdown binding is a "free-form template string against the row shape".
Markdown Outputs have no binding: content is the literal `config.content` (owner ruling on HEL-1139; bound narrative
text is HEL-921's `insight` kind). One-line comment fix; left out of HEL-1139 to avoid moving the reviewed head.

origin_kind: followup
origin_ticket: HEL-1139

## Acceptance Criteria (driver scope, 2026-10-08)

- The `OutputBindingSpec.Markdown` comment states that a markdown Output has no data binding and its text is the
  literal `config.content`; it no longer claims a template string interpolated against the row shape.
- Other live (non-historical) comments/docs/specs repeating the "markdown Output is a template over rows" claim are
  fixed in the same change, each listed with grep evidence; a spec requirement is changed via a proper OpenSpec delta.
- Comment/doc/spec-text only — no behaviour change.

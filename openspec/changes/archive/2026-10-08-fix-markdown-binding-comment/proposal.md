## Why

The comment on `OutputBindingSpec.Markdown` says a markdown Output's binding is "a free-form template string against
the row shape". That is false: per the HEL-1139 owner ruling a markdown Output has no data binding and renders the
literal `config.content`. The wrong comment invites the next reader (human or agent) to rebuild the bound mode HEL-1139
removed. The `pipeline-output-sheet` spec's "Per-kind option sets" requirement also says "a markdown template", which
contradicts the same spec's "Markdown Output Content is literal-only" requirement.

## What Changes

- Rewrite the `OutputBindingSpec.Markdown` comment to state the literal-only contract and point bound narrative text at
  HEL-921's planned `insight` kind.
- MODIFY the `pipeline-output-sheet` "Per-kind option sets" requirement: `markdown` shows a literal Content editor, not
  "a markdown template".
- No code behaviour change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-output-sheet`: "Per-kind option sets" wording for `markdown` corrected to the literal Content editor.

## Non-goals

- Historical design records (`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`, `notes/roadmap.md`,
  archived changes) — they record what was planned at the time; rewriting them would falsify history.
- The `markdown-panel` spec's legacy "bound DataType field" content-panel scenarios — a different claim (content
  panels, retired DataTypes), surfaced as a follow-up, not fixed here.
- Any templated-markdown feature (HEL-1309 / HEL-921).

## Impact

- `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` (comment only)
- `openspec/specs/pipeline-output-sheet/spec.md` (via delta at archive)

## Context

See proposal.md (Why). Ground truth on main `002249226`, each verified by the orchestrator before planning:

- `OutputBindingSpec.Markdown` = `OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)` —
  no slots (`OutputBindingSpec.scala:103-104`).
- `validateFieldMapping` returns `Left` for ANY `fieldMapping` key when a kind has no slots, appending "(a markdown
  Output's text is the literal config.content)" for markdown (`OutputBindingSpec.scala:158-167`); pinned by
  `OutputBindingSpecSpec.scala:59` (`Map("content" -> "notes")` rejected).
- `OutputConfigValidation.KnownKeys`: `OutputKind.Markdown -> (Shared ++ Set("content"))` (HEL-1313, `e93bebc32`).
- Renderer: `frontend/src/features/panels/ui/PanelContent.tsx:337-339` renders `readMarkdownConfig(output.config)`'s
  `content` via `MarkdownRenderer`; it never reads rows for markdown. Editor writes `{ content, fieldMapping: {} }`
  (`buildOutputConfig.ts:123-125`).
- HEL-1139 removed the bound Content mode: `e184391c9 HEL-1139 Remove dead markdown Content binding mode ...`.
- No `insight` kind exists yet: `grep -rniw insight backend/src/main/scala` → 0 hits (HEL-921 is future work).
- Pre-HEL-904 `PanelBindingSpec.DataBindable = Vector(Metric, Chart, Table, Collection, Timeline)` (no text/markdown):
  `git show 2ec2a5bc8^:backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala | grep DataBindable`.

Sweep for the same claim elsewhere (`grep -rniE "template (string|interpolat)|interpolated from rows|against the row
shape|markdown template"` over *.scala/*.ts/*.tsx/*.md/*.json/*.yaml, excluding node_modules and archive):

- `OutputBindingSpec.scala:97-99` — the target; fixed.
- `openspec/specs/pipeline-output-sheet/spec.md:39` — "a markdown template for `markdown`"; fixed via MODIFIED delta.
- `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:76,89`, `notes/roadmap.md:79` — historical
  design records; left unchanged (Non-goal).
- helio-mcp (`tools/outputs.ts:76,112`, `tools/placements.ts`, `tools/proposal.ts`) and the frontend editor
  (`OutputKindFields.tsx:285-288`) already state literal-only — no change.

## Goals / Non-Goals

**Goals:** the comment and the spec sentence match the literal-only contract. **Non-Goals:** see proposal.md.

## Decisions

- D1: Rewrite the whole comment block (lines 97-102), not one phrase — the "design.md: a markdown template interpolated
  from rows" quote is the source of the false claim, so it goes too. Keep the still-true `PanelBindingSpec` history
  sentence. Alternative (delete the comment) rejected: the "why no slots" contract is not derivable from `Vector.empty`.
- D2: Fix the spec via a MODIFIED delta on "Per-kind option sets" rather than editing `openspec/specs/` directly, per
  the OpenSpec workflow; the requirement's scenario is copied unchanged.

## Risks / Trade-offs

- [Comment drifts again if HEL-921 lands an `insight` kind] → the comment names HEL-921 as the home for bound text.

## Planner Notes

- Self-approved: spec delta scope (one sentence) and leaving historical docs untouched.
- `markdown-panel` spec's legacy "bound DataType field" scenario (content panels) is out of scope → follow-up.

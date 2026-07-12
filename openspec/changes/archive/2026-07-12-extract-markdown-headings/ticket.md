# HEL-220: Text pipeline operation: Extract headings

## Description

Pipeline step for unstructured text: extracts Markdown headings from a
string-body field and returns them as an array of strings (one row per
heading, with heading level as a metadata field).

## Context

- Epic: HEL-147 (v1.4 Unstructured Data)
- Project: Helio v1.4 — Unstructured Data
- This is the SECOND of three text pipeline operations. The FIRST, HEL-219
  (`splittext` — split by paragraph/heading), just merged to main
  (commit 3ee2d2d, PR #211). **Mirror its wiring pattern.**
- Reference design doc (read first):
  `openspec/changes/archive/2026-07-12-split-text-by-paragraph/design.md`
- Reference implementation: the `splittext` op (apply path, analyze/infer
  path, allowedOps migration, StepCard/config UI).

## Requirements

Op name (proposed, confirm against existing naming conventions used by
`splittext`): `extractheadings` (or equivalent per existing convention).

- Input: a `StringBodyType` content field (Markdown text).
- Output: one row per Markdown heading line found in the content, with:
  - the heading text (string)
  - the heading level (metadata field, e.g. 1-6 for `#`..`######`)
- Must be wired end-to-end, mirroring HEL-219's pattern:
  1. **Apply/infer parity** — implement the op in BOTH the execution/apply
     path AND the schema-inference (`analyze`) path. HEL-219's evaluator
     caught a 500 in `GET /api/pipelines/:id/analyze` from a missing wire-ADT
     arm in `PipelineService.toAnalyzeStepResponse` / `PipelineProtocol.scala`.
     Add this op's arm to every enumeration/ADT site that `splittext` touched
     (HEL-219's final skeptic spot-checked 8 enumeration sites — find and
     cover the equivalent set here).
  2. **allowedOps** — register the op in the allowed-ops set; requires a
     Flyway migration. Main is at 3ee2d2d (includes HEL-219's migration) —
     pick the next free version number.
  3. **StepCard / step config UI** — add the frontend step config component,
     wire it into the step picker, and gate the field selector to
     string-body content fields only.

## Acceptance Criteria

- New pipeline op extracts Markdown headings (lines starting with 1-6 `#`
  characters followed by a space) from a `StringBodyType` field.
- Output is one row per heading: heading text + heading level metadata.
- Op works in both the apply (execution) path and the analyze (schema
  inference) path — `GET /api/pipelines/:id/analyze` must not 500 for a step
  using this op.
- Op is registered in allowedOps via a new Flyway migration (next free
  version number after HEL-219's).
- Frontend step config UI: new StepCard component for this op, wired into
  the step picker, with the field selector restricted to string-body content
  fields.
- Follows CONTRIBUTING.md and DESIGN.md standards.

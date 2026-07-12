# HEL-219 — Text pipeline operation: Split by paragraph / heading

**Linear URL:** https://linear.app/helioapp/issue/HEL-219/text-pipeline-operation-split-by-paragraph-heading
**Project:** Helio v1.4 — Unstructured Data (epic HEL-147)
**Priority:** Medium

## Description

Pipeline step for unstructured text: splits a string-body field into an array
of segments by paragraph break or Markdown heading level. Output is a row per
segment with a sequence index field.

## Context (from orchestrator brief)

This is a TEXT PIPELINE OPERATION — "split by paragraph / heading": takes a
`StringBodyType` content field and splits it into multiple rows (one per
paragraph or heading-delimited section).

This is the **first of three text ops** (HEL-220 extract headings, HEL-221
chunk by token count follow it, one at a time). It establishes the reusable
unstructured-text-op pattern the other two will mirror — keep the op wiring
clean and explicitly note the seam (the reusable pattern) in the design doc so
HEL-220/HEL-221 can follow it directly.

## Pipeline-op wiring checklist (known checklist for this codebase — follow all of it)

- **apply/infer parity**: the op must be implemented in BOTH the
  execution/apply path AND the schema-inference (`analyze`) path, producing
  consistent output-type/schema.
- **allowedOps**: register the new op in the allowed-ops set. This requires a
  Flyway migration. Current latest migration on main (fa5e4b9) is
  `V49__add_image_source_type.sql` — use **V50** for this change.
- **StepCard / step config UI**: add the frontend step config component and
  wire it into the step picker.
- **Input applicability**: the op should only be offered/valid on content
  (`StringBodyType`) fields produced by the v1.4 connectors (HEL-215 text,
  HEL-214 PDF, HEL-216 image — all merged to main as of fa5e4b9).

## Acceptance criteria (derived)

- New pipeline op "split by paragraph/heading" splits a `StringBodyType`
  field into one row per segment, with:
  - Split mode: paragraph break (blank-line-delimited) or Markdown heading
    level (e.g. split on `#`/`##`/etc.)
  - A sequence index field on each output row
- Op is registered in both apply (execution) and infer/analyze paths with
  matching output schema shape.
- Op is gated to only be valid/offered on `StringBodyType` fields.
- Op appears in the frontend step picker with a step-config UI to choose
  split mode (and heading level, if heading mode).
- New Flyway migration `V50__*.sql` adds the op to the allowed-ops set.
- Design doc explicitly documents the reusable pattern for future text ops
  (HEL-220, HEL-221) to follow.

## Environment notes

- Local main was fetched and up to date at fa5e4b9 before branching.
- Branch cut from up-to-date main; no worktree/migration contention expected
  (serial delivery).

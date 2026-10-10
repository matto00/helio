# HEL-1414: Analyze schema warnings follow-ups: render in pipeline editor, surface in get_workspace_context, lookup key-type + rename warnings, concise doc mismatch

## Description

origin_kind: followup
origin_ticket: HEL-1235

From HEL-1235 (7e1df62a6, non-blocking analyze `warnings: [{stepId, code, message}]`: field-not-in-input-schema, join-key-type-mismatch, join-column-renamed). Verify each.

1. Render analyze warnings in the pipeline editor (frontend has types only). This is a UX/product shape decision: escalate placement/copy if not covered by DESIGN.md.
2. Surface warnings in helio-mcp `get_workspace_context`, which keeps only `steps`.
3. `lookup` (`sourceKey` vs `lookupKey`) has the same key type-mismatch failure mode as join, with no warning.
4. A `lookup` whose secondary is a source never gets a rename warning.
5. Concise warnings can list up to 20 "available" column names, but the `analyze_pipeline` tool description says concise mode has "no column lists". Fix the wording or trim the messages.
6. Doc leftovers in the archived change: the `PipelineAnalyzeSchemaWarningsSpec` header says "verification notes", and files-modified.md note 1.3 gives a stale reason for dropping `compute` from the trusted list.

Constraint to keep: warnings never feed validationError/costVerdict/stepConfigProblem/validateRawConfig (HEL-1235's guard tests).

## Premise validation (orchestrator, 2026-10-09, against origin/main 365d824c8)

- There are now FOUR warning codes: HEL-1403 (#902) added `numeric-op-on-text-field`. Every item below covers all four codes where relevant.
- Items 1–5 confirmed as stated.
- Item 6b: `files-modified.md` is deleted at delivery and does not exist in `openspec/changes/archive/2026-10-08-analyze-schema-warnings/`. The stale `compute` rationale survives in that archive's `tasks.md` 1.3; re-targeted there.

## Acceptance Criteria

- AC1: The pipeline editor renders each analyze warning for its step, in the placement/copy the owner rules on (Planning escalation), visibly non-blocking (copy never says the pipeline "can't run"), in both themes, without changing whether runs fire.
- AC2: helio-mcp `get_workspace_context` surfaces each pipeline's analyze `warnings` (full and concise modes as appropriate), covered by the package's own tests.
- AC3: A `lookup` whose `sourceKey` (input) and `lookupKey` (secondary) have different type families on type-trusted schemas emits a `join-key-type-mismatch`-family warning (or a lookup-specific code, per design), red-first.
- AC4: A `lookup` whose secondary input is a `source` emits `join-column-renamed` warnings for colliding requested columns, red-first.
- AC5: Concise-mode warning text and the `analyze_pipeline` tool description agree (no "no column lists" claim contradicted by a listed-columns message).
- AC6: `PipelineAnalyzeSchemaWarningsSpec`'s header points at a real artifact; the archived HEL-1235 `tasks.md` 1.3 `compute` rationale is corrected to match the code.
- AC7: Warnings still never feed validationError / costVerdict / stepConfigProblem / validateRawConfig / the HEL-1384 RunConfigGate; HEL-1235's guard tests stay green.

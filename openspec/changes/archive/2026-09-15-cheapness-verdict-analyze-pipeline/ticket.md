# HEL-1092: Cheapness verdict on `analyze_pipeline`

## Description

Extend `analyze_pipeline` to emit a cost estimate and a boolean auto-run verdict. Deny on: any AI step, any remote fetch (`rest_api` or URL-backed source), estimated row count above a threshold, step count above a bound.

**Deny is the default for anything the estimator cannot classify.** Start conservative and loosen on evidence.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), section 4.

## Acceptance Criteria

- A **failable** probe: one pipeline the estimator must deny (contains an AI step) and one it must allow, with a mutation showing the deny arm actually fires. A test that can only pass is not evidence.

## Context

Blocks HEL-1108 (AI steps never auto-runnable + tier gating), HEL-1093 (auto-run on dataset write), HEL-1096 ("run to update" affordance). Parent HEL-1091. `analyzewithai`/`generatetext`/`convertformat` are admitted by the V107 op CHECK but not implemented (HEL-1105..1107 Backlog).

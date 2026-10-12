# HEL-1437: validate-expression endpoint ignores analyze type errors; pipeline page's step-config-invalid notice says "can't run" though runs still fire

## Description

Origin: HEL-1423 (matto00/helio#881), lane-reported. Labels: Follow-up. Priority: Low.

1. `POST /api/pipelines/:id/validate-expression` checks only syntax and field names, so it returns `valid: true` for e.g. a mixed-type `coalesce($num, "n/a")` that analyze rejects. Nothing in the UI calls it today, but MCP/API callers might. Either route it through the same `inferCompute` type check or document the narrower contract.
2. The pipeline page's step-config-invalid notice says the pipeline "can't run until that step is fixed", but it's display-only: the Run button still works, and scheduled/auto runs still fire for analyze-only errors (the HEL-1384 RunConfigGate uses `stepConfigProblem` only). The wording predates HEL-1423. Make the copy accurate, or make the behaviour match the copy (a product call if the latter).

## Acceptance Criteria

- validate-expression reports the same expression type errors analyze reports for a compute step (including HEL-1070's comparison / boolean / if() / coalesce branch-type errors and HEL-1314's date-function type errors), against the same node schema; the response shape agreed between client (`frontend/src/features/pipelines/services/outputService.ts`) and server is pinned by a seam test.
- The step-config-invalid notice on the pipeline page states only what is actually true of manual, scheduled and auto runs for each class of error it is shown for (reproduced live before the change).
- Red-first tests for both items.

## Driver context

- Re-derived on main at 50c9b2299 (HEL-1070 merged). See premise-validation evidence.
- Owner rulings collected during Planning are recorded in design.md.

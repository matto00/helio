# HEL-620: Union op: adding step via picker 404s on empty otherDataSourceId default (ACL check rejects unset id)

## Description

`unionCheckF` — the cross-tenant ACL pre-flight check added in HEL-384 (`PipelineService.addStep`/`updateStep`, `findByIdOwned` on `UnionConfig.otherDataSourceId`) — treats an empty/unset `otherDataSourceId` as "not found" and returns 404. But adding a union step via the frontend "+ Add transformation step" picker POSTs `defaultConfigFor("union")` with an empty `otherDataSourceId` (the user hasn't picked a source yet). So:

- Adding a union step from the picker → 404, the step is never persisted.
- It silently vanishes on page reload.
- The user can't create a union step through the normal UI flow at all.

This is a UX-breaking defect on a shipped op. HEL-384's gates missed it because the evaluator/skeptic exercised union by creating steps with a real reference source already set (via API), not by clicking the picker to add a step with the empty default.

## The fix (mirror HEL-386's lookup fix)

HEL-386 fixes the same bug for `lookup`: guard the ACL check so `findByIdOwned` is only called when the second-source id is non-empty; an empty/unset id is allowed to persist (incomplete draft config — nothing to leak, so not a security violation). Only a non-empty id the caller doesn't own returns 404.

Apply the same guard to `unionCheckF` in both `addStep` AND `updateStep`.

**Premise-validation correction (orchestrator, 2026-09-03):** HEL-386's guard shipped inline in the original HEL-386 commit (6cf4c3f4, PR #287) — no separate fix commit, and no shared helper was extracted. `lookupCheckF` already has the exact `.nonEmpty` guard shape at PipelineService.scala:885-892 (addStep) and ~1113-1120 (updateStep). The correct move is to inline the identical guard shape into `unionCheckF`, not introduce a new abstraction.

## Acceptance Criteria

- Adding a union step via the picker (empty `otherDataSourceId` default) PERSISTS successfully — no 404, survives reload.
- The security boundary is preserved: a non-empty cross-user `otherDataSourceId` still returns 404 on both POST (create) and PATCH (update); the existing HEL-384 ACL tests pass unchanged.
- New regression test: union step with empty `otherDataSourceId` persists (POST + PATCH-to-empty allowed); the test that would have caught this.

## Scope constraints (from delivery instructions)

- ONLY touch the union step's backend validation/ACL path and its frontend picker/step-config component, plus their specs/tests.
- DO NOT TOUCH: frontend /api/types callers and proposal protocols (HEL-936/940), the ui-select component + e2e touch-target specs (HEL-818), PipelineRunService route specs (HEL-922), a Flyway data-fix migration (HEL-932).
- Git safety: never git stash, never git add -A / git commit -a — explicit paths only.
- Evidence required (TDD RED→GREEN): a test reproducing the bug via the real frontend picker default/unset value, then the fix, then GREEN + lint/typecheck/scala-quality/existing suite for touched files, PLUS mandatory live browser verification via playwright MCP tools (add a union step through the UI picker, select a second data source, confirm no 404).
- Analysis required in the final report: whether the fix is (a) frontend-only, (b) backend-only, or (c) both — follow whatever HEL-386/lookup actually did (backend-only, confirmed during premise validation). Also check whether any OTHER op among the 9 shipped in HEL-336 has the same picker-selected-second-source defect (checked during premise validation: only `joinCheckF` (HEL-278, predates HEL-336) shares this shape; no HEL-336 op besides union/lookup has a second-datasource ACL check at all — list as follow-up, do not fix).

# HEL-1475: After HEL-1469: other inline-source leak paths (addRoot cycle-guard failure, implicit "Auto:" connector, SourceService.createSql/createRest post-insert failure, patch-set undo of inline-root create)

## Description

Origin: HEL-1469 (matto00/helio#918, 222e855c), lane-reported. HEL-1469 fixed single-call create and the patch-set create path. Remaining leak paths:

1. `POST /api/pipelines/:id/roots` (`addRoot`) with an inline root that then fails the cycle guard leaves the source behind.
2. A rest_api inline root given as a bare `url` creates an implicit "Auto:" Connector, which survives HEL-1469's cleanup delete.
3. `SourceService.createSql`/`createRest` can fail after their own insert has committed (affects `POST /api/sources` directly too).
4. Patch-set undo of an applied inline-root pipeline create doesn't remove the source. Whether it should is a PRODUCT call: escalate.
5. Hardening: `PatchSetApplyRollback.deleteInlineRootSources` should warn when roots don't line up instead of silently skipping; add a test for the pipeline-delete-fails path.
6. The cleanup delete isn't crash-atomic (documented risk).

Red-first per path (count data_sources/connectors by exact owner id before/after, through the real route).

Also: HEL-1441 item 3 is already satisfied (single-call create runs OutputConfigValidation); note it on HEL-1441.

Priority: Medium. Labels: Follow-up, Bug.

## Acceptance Criteria

- AC1 (path 1): `POST /api/pipelines/:id/roots` with an inline root leaves no data source (and no implicit Connector) behind when the response is any 4xx/5xx after the inline source was created. The cycle-guard trigger named in the ticket is reproduced if reachable, otherwise reported (with evidence) as not reachable for a freshly created inline source.
- AC2 (path 2): wherever a call-created inline `rest_api` root given as a bare `url` is compensated (single-call create, addRoot, patch-set mid-set rollback, pipeline-proposal apply's own failure cleanup; the public post-apply `rollback(response)` is a follow-up), its implicit "Auto:" Connector (and its credential row) is removed too; a Connector still referenced by another source is never removed.
- AC3 (path 3): `SourceService.createSql`/`createRest` leave no data source row and no implicit Connector behind when they fail after their own insert; the original failure is still surfaced unchanged. Applies to `POST /api/sources` directly. (`DataSourceService.createStatic` was verified to be one transaction: not a leak.)
- AC4 (path 4): PRODUCT call -- not decided in this change (no behaviour change to undo); a follow-up ticket asks the owner.
- AC5 (path 5): `deleteInlineRootSources` logs a warning and marks the edit `unrecoverable` when the request roots and the forward summary roots do not line up (deleting nothing on a count mismatch); a test covers the pipeline-delete-fails path (no source delete attempted, edit `unrecoverable`).
- AC6 (path 6): the not-crash-atomic risk is documented at the shared cleanup helper.
- Every leak path gets a test that is measured red on the pre-fix tree and asserts the `data_sources` (and `connectors`, where relevant) count for the exact test owner id is unchanged after the failure.
- A read-only prod count query for existing orphans is provided for the PR body; no cleanup migration.
- HEL-1441 is commented that its item 3 is already satisfied.

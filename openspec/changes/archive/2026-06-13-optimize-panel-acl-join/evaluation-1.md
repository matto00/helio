## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues:
- All five acceptance criteria are addressed: (1) findAllByDashboardId is a single db.run; (2) findById is a single db.run; (3) EXPLAIN ANALYZE tests gate the index-scan requirement; (4) existing 39 DashboardPanelAclSpec tests pass unchanged per live test run; (5) public-viewer fallback path preserved via granteeId.isEmpty + role='viewer' EXISTS branch.
- All tasks.md items are marked [x] and match what was implemented (1.1, 1.2, 1.3, 2.1, 2.2, 2.3).
- No scope creep: the only code changes are PanelRepository.scala and the two new test cases in DashboardPanelAclSpec.scala. The openspec/specs/dev-db-repair/spec.md change originated in commit a83d980 (pre-existing orchestration fix), not the HEL-281 commit.
- No API contract changes; no schema changes required.
- OpenSpec artifacts (proposal, design, tasks, spec) are correctly archived and reflect final implemented behavior.
- Minor: tasks.md item 2.2 states the test should "assert the plan string contains 'Index Scan' or 'Index Only Scan'"; the implementation asserts only the negative (no Seq Scan). The archived spec (specs/acl-enforcement/spec.md:55-56) also requires the positive assertion. In practice the negative-only gate catches the regression, and the live run showed both tests pass. This is a paperwork gap in the test, not a functional regression.

### Phase 2: Code Review — PASS
Issues:
- **CONTRIBUTING.md compliance**: The `java.sql.Timestamp` inline FQN at PanelRepository.scala:302-303 (inside the companion object's `instantColumnType` implicit) pre-exists on main and was not introduced by this change. No new inline FQNs were added.
- `LiteralColumn` is available via the wildcard `import slick.jdbc.PostgresProfile.api._` — no qualification needed and none was used.
- PanelRepository.scala is 355 lines, slightly above the 250-line soft budget but below the 400-line hard-split threshold and pre-existing; this change reduced the file by ~5 lines (net negative via PipeOps removal).
- DRY: `PipeOps` helper removed as it is no longer used — clean-up executed correctly.
- The `withSystemContext` choice is well-justified: ACL predicate is embedded in WHERE; no `app.current_user_id` session variable needed; consistent with how `DashboardRepository.findById` and `findByIdInternal` operate.
- Behavioral correctness verified for all four caller paths (owner, grantee, public-viewer, no-grant) for both methods:
  - Owner: `dashTable.filter(owner).exists` is true → panels returned.
  - Grantee: `permTable.filter(grantee).exists` is true → panels returned.
  - Anonymous with public grant: `permTable.filter(null-grantee).exists` is true → panels returned.
  - No-grant / non-existent dashboard: all EXISTS predicates false → 0 rows → Vector.empty / None.
- Orphaned-panel edge case in old `findById` (dashboard doesn't exist → None) is preserved: if the dashboard doesn't exist, the ownerCheck and granteeCheck EXISTS subqueries both return false; the query returns 0 rows → `None` via `.headOption`.
- Type safety maintained; no `Any` usage; all type annotations explicit where needed for Rep[Boolean] widening.
- Error handling unchanged at boundary; no new failure modes introduced.
- No dead code; no unused imports; no TODO/FIXME.
- No over-engineering.

### Phase 3: UI Review — N/A
The diff touches only `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` and `backend/src/test/scala/com/helio/api/routes/DashboardPanelAclSpec.scala`. No `frontend/` files, no `ApiRoutes.scala`, no `schemas/`, no `openspec/specs/` (non-archive) were modified by the HEL-281 commit. Phase 3 trigger conditions not met.

### Overall: PASS

### Non-blocking Suggestions
- The EXPLAIN ANALYZE tests assert only `should not include "Seq Scan on resource_permissions"`. tasks.md and the archived spec (specs/acl-enforcement/spec.md:55) also require a positive `should include "Index Scan"` or `"Index Only Scan"` assertion. Adding the positive assertion would make the CI gate tighter and match the spec letter. This is non-blocking because the negative assertion is sufficient to catch a planner regression in practice, and both tests pass on the live database.

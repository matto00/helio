## Standing Constraints

## 1. Repro (red first, before any production code change)

- [x] 1.1 Start own servers (DEV_PORT/BACKEND_PORT from workflow-state.md); live repro: owned CSV source + upsertsource existingSource -> create, analyze, step preview, Output preview, dry run all succeed; real run fails. Record ids and responses in repro-findings.md
- [x] 1.2 Write failing tests for every surface in the spec delta (save 422, analyze validationError, preview/Output preview/dry run STEP_CONFIG_INVALID, real run fails before write); capture the red run

### Backend

- [x] 2.1 Shared writability predicate (D1); use it in writeExistingDatasetAction
- [x] 2.2 Save-time typed outcome NotFound vs NotWritable; 422 naming target in create/addStep/updateStep (D2)
- [x] 2.3 UpsertSourceStep.evaluate target check -> StepConfigError / plain IAE (D4)
- [x] 2.4 Analyze pre-resolution map, every analyze surface (D5)
- [x] 2.5 Patch-set preview parity only if it already pre-checks upsert targets (D9); report which

### Frontend / MCP

- [x] 3.1 helio-mcp write.ts upsertsource description sentence (D8)
- [x] 3.2 Confirm UI step editor surfaces the save 422; record evidence (no code change expected)

### Tests

- [x] 4.1 Unit: predicate, validateTargetOwnership outcomes, UpsertSourceStep evaluate (dataset/csv/not-found/None owner)
- [x] 4.2 Service/route: all four save paths + apply-proposal; foreign/unknown 404 identical, no kind/name
- [x] 4.3 Route: preview, Output preview, dry run full STEP_CONFIG_INVALID body; sibling-branch preview still 200
- [x] 4.4 Real run: fails, run row failed, zero rows written to any source
- [x] 4.5 Stored invalid step lists cleanly; HEL-1252 reference still blocks delete of its source
- [x] 4.6 Non-BYPASSRLS spec (D6) incl. grantee-editor path
- [x] 4.7 Classify and update existing fixtures that target non-dataset sources; justify each in the report
- [x] 4.8 Mutation: neuter the predicate -> save/analyze/preview tests red; restore
- [x] 4.9 Read-only dev DB count of stored invalid targets with the exact query
- [x] 4.10 Gates: nice -n 19 sbt testFull, frontend lint/typecheck/test, helio-mcp checks; live green re-run of 1.1

### Tests (design-gate round 1 notes, skeptic-design-1.md)

- [x] 5.1 D4: record how evaluate builds the owner identity for findByIdOwned (AuthenticatedUser(UserId(owner)) or repo kind lookup)
- [x] 5.2 Classify ctx-construction tests broken by fail-closed ownerUserId=None as fixture-shape under 4.7
- [x] 5.3 Dev DB count query casts config::jsonb and guards non-JSON rows (config is TEXT)
- [x] 5.4 In 4.6 assert foreign/unknown targets never reach the kind branch (no name/kind disclosed); note disclosure in report
- [x] 5.5 In 4.2 assert a patch-set apply with an invalid target rolls back its earlier edits

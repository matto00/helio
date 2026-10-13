## Standing Constraints

- [C1] Migration cascade tests run every `DELETE FROM users` as the NOSUPERUSER NOBYPASSRLS owner role `helio_migration_test` with `app.current_user_id` unset; counts read via superuser.
- [C2] Never apply a migration to, or boot this branch's backend against, the shared dev DB; VerifiedEmbeddedPostgres only.

## 1. Backend

### Backend
- [x] 1.1 Read the real FK name on `pipeline_run_rate_window.user_id` from a migrated embedded DB; record it in evidence
- [x] 1.2 Add `V133__pipeline_run_rate_window_user_cascade.sql` (D3); verify by task 4.1
- [x] 1.3 Mark the four fields deprecated on `ProposalPanelSchema` with one shared description constant (D1); verify by 4.2
- [x] 1.4 Mark the four fields `"deprecated": true` + reworded description in `dashboard-proposal.schema.json`; `npm run check:schemas` passes
- [x] 1.5 Update `docs/user-reference-inventory.md` (row -> CASCADE, drop "rate-window" from blocked prose); `V119OwnerFkMigrationSpec` passes

## 2. Frontend / MCP / e2e

### Frontend
- [x] 2.1 `@deprecated` JSDoc on the four fields + correct the stale doc comment in `frontend/src/features/dashboards/types/proposal.ts`; Review UIs' Mapping row unchanged (HEL-1547); `npm run lint` and `npm run typecheck` pass
- [x] 2.2 MCP zod `panelSchema`: `.describe(...)` deprecated/ignored on the four fields (D1); helio-mcp build + tests pass
- [x] 2.3 e2e hel1390/hel1304/hel1351: `expect.soft` on each cleanup delete status, statuses read from route code (D6); e2e tsc/lint pass
- [x] 2.4 `e2e/support/userCleanupCore.cjs`: keep the rate-window entry, add the D5 comment; `node e2e/support/userCleanup.selftest.mjs` passes

## 3. Test fixtures

### Tests
- [x] 3.1 Replace `category`/`value` chart mappings with real slots in `buildOutputConfig.test.ts` and `OutputEditorSheet.configPatch.test.tsx` (+ any other chart-kind fixture found; list them); tests pass
- [x] 3.2 One-off mutation per changed chart-fixture behavior shows the test still goes red; revert; record in evidence
- [x] 3.3 Replace `asInstanceOf[JsString]` in `AssistantProposalToolSchemasSpec.scala` incl. `asInstanceOf[JsArray]` at :35 (D8); spec passes

## 4. Verification

### Tests
- [x] 4.1 `V133RateWindowCascadeMigrationSpec` (D4) covering all four user-reference-integrity scenarios + rows surviving the migration; deletes run as `helio_migration_test` (NOSUPERUSER NOBYPASSRLS owner, app.current_user_id unset), counts via superuser; red (V133 made NO ACTION) then green
- [x] 4.2 `AssistantProposalToolSchemasSpec` case: four fields deprecated with description on Scala schema AND JSON schema file, no other property deprecated; red-then-green
- [x] 4.3 Accept/inert test for a proposal carrying the four fields (or cite an existing test that pins it)
- [x] 4.4 MCP test on the emitted tool input schema for the four descriptions
- [x] 4.5 e2e: live run on a scratch DB per D6, or record exactly why not and what ran instead (`--list`, tsc)
- [x] 4.6 Gates: frontend jest (affected files), lint, typecheck, format:check, check:schemas, helio-mcp tests, backend affected specs; split shards <600s, workers <=3, nice -n 19; report exactly what ran

## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 798bd46e432ee12d23c928e78e0e210885973dc9 (branch task/proposal-legacy-fields-followups/HEL-1440).
Diff base: resolved live via resolve-review-base.sh, f63ab8365d2b0e6cac36154a83437b6d26b3a209 (origin/main).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: all four fields carry `"deprecated": true` plus a "Deprecated and ignored ... Output's `config`" description in
  `schemas/dashboards/dashboard-proposal.schema.json` and `AssistantProposalToolSchemas.ProposalPanelSchema` (one shared
  constant + `deprecatedPanelField` helper, per D1). MCP zod `panelSchema` uses `.describe(...)` on the four. The frontend
  `ProposalPanel` gets `@deprecated` on `fieldMapping`/`label`/`unit`; it has no `aggregation` property on main, so there
  is nothing to tag there (not added, which is correct scope). Fields still accepted: `DashboardApplyProposalConfigSpec`
  new case applies a proposal carrying all four -> 201, panel config `{outputId, controls: []}`. `npm run check:schemas` passes.
- AC2: the three specs route every cleanup delete through `e2e/support/expectDeleted.ts` (`expect.soft(status).toBe(204)`).
  I checked the routes: `DashboardRoutes`/`PipelineRoutes` use `ServiceResponse.runNoContent`, `DataSourceRoutes.completeDelete`
  returns `StatusCodes.NoContent`. So 204 is correct for all three. Exact-id deletes and their order are unchanged.
- AC3: V133 + `V133RateWindowCascadeMigrationSpec` + inventory row/prose updated; V119 inventory test green.
- AC4: chart fixtures now use xAxis/yAxis/series/annotation in all three files. The remaining `{category, value}` fixture
  (`chartOverlay.test.ts:251`) is deliberate: it is the "unmapped" case. Metric `value` mappings are correct.
- AC5: `asInstanceOf[JsString]` (x2) and `asInstanceOf[JsArray]` replaced by `convertTo[...]`; none remain in the spec.
- Tasks all [x] and match the diff. Non-goals respected: Review UIs, `helio-mcp/src/types.ts` and chart fields are untouched.
- CONSTRAINTS C1/C2 honored. C1: the spec's `DELETE FROM users` runs on `roleConn` (helio_migration_test, rolsuper/
  rolbypassrls asserted false, `app.current_user_id` never set), and counts are read on the superuser connection.
  C2: everything ran on VerifiedEmbeddedPostgres. Nothing touched the shared dev DB.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator in WORKTREE_PATH:
- `npm run lint`: clean (zero warnings, so no no-deprecated rule fires on the Review UI reads).
- `npm run format:check`: clean.
- `npm run typecheck`: clean. `helio-mcp`: `npm run typecheck` + `tsc --noEmit`: clean. `tsc --noEmit -p e2e`: clean.
- `npm run check:schemas`: in sync (AssistantProposalToolSchemas 14 surfaces). `check:scala-quality`: clean (soft warnings
  are pre-existing). `check:openspec`: clean.
- `npm test`: the root jest ran 50 suites / 459 tests and passed, including `helio-mcp/src/tools/proposalDeprecatedFields.test.ts`.
  The frontend jest ran 584 suites / 7004 tests and passed (the shards later re-ran 195+194 suites, all passing). Workers capped at 3, nice 19.
- `npm --prefix frontend run build`: success.
- `node e2e/support/userCleanup.selftest.mjs`: 40 passed.
- `npx playwright test --list` on the three e2e files: 5 tests in 3 files. Not run live, which is the accepted D6 fallback.
- Backend, targeted only (NOT the whole `sbt testFull`): `testOnly` V133RateWindowCascadeMigrationSpec, V119OwnerFkMigrationSpec,
  FlywayNonSuperuserMigrationSpec, AssistantProposalToolSchemasSpec, DashboardApplyProposalConfigSpec: 50 tests, 0 failed.

The executor's claims, verified independently. All mutations ran in a throwaway detached worktree at 798bd46e4, which
has since been removed. Nothing was mutated in WORKTREE_PATH.
- 42704 root cause of the FORCE-RLS bracket: CONFIRMED. With both `NO FORCE`/`FORCE` statements deleted from V133, the
  migration fails with `SQL State 42704 unrecognized configuration parameter "app.current_user_id"` in the three scenarios
  that have rows present. The bracket is needed: without it, prod Flyway (owner, NOBYPASSRLS) would fail on any existing row.
- Bracket restored in the same transaction: CONFIRMED by mutation. I inserted `SELECT 1/0;` between the constraint swap
  and `FORCE`, so `migrate()` throws. After that, `relforcerowsecurity` is still `true` and the FK is still `a` (NO ACTION).
  Flyway's per-migration transaction rolls back the `NO FORCE`.
- End-state RLS flags identical to before V133: CONFIRMED by a scratch probe that snapshots before and after
  `migrate(133)` as the owner role. Before and after are both `relrowsecurity/relforcerowsecurity = true/true`. The policy
  is unchanged both times: `pipeline_run_rate_window_owner|*|permissive|(user_id = current_setting('app.current_user_id')::uuid)|{0}`.
  The PK and the owner are unchanged too. The only delta is the FK def, which gained `ON DELETE CASCADE`.
- V133 red-then-green: CONFIRMED. With `ON DELETE CASCADE` removed, 3/5 scenarios fail. The blocking-dashboard and
  ghost-FK scenarios correctly stay green.
- Deprecation spec red: CONFIRMED. Marking `sort` deprecated on the Scala schema fails the tool-schema case with
  `HashSet(..., "sort") was not equal to ...`. Removing `"deprecated": true` from the JSON `unit` fails the JSON-file case.
- Chart fixtures still test their behavior: CONFIRMED. Making `withoutAnnotation` a no-op in `buildOutputConfig.ts`
  fails 4 of 64 tests across the three changed files. Changing `OWNED_SLOTS.chart` to `[]` in `configPatch.ts` fails 1 of 64.
  Baseline is 64/64.
- DELETE routes return 204: CONFIRMED (see AC2 above).
- Full root jest passed: CONFIRMED (above).
- Backend subset only: TRUE for both the executor and me. The whole `sbt testFull` was not run by either.

Code quality: no `asInstanceOf`, no FQNs, no dead code. The Scala helper is reasonably DRY: one description constant per
surface (Scala, MCP), and the JSON schema necessarily repeats the text. The migration header comment is accurate and explains the bracket.

### Phase 3: UI Review — PASS
Triggers matched (`frontend/**`, `schemas/**`), but the change has no runtime UI. Evidence: the only non-test `frontend/src`
file changed is `types/proposal.ts` (comments/JSDoc only). I built the production JS bundle at HEAD and again with that
file reverted to base. All 15 emitted JS chunks were sha256-identical. Per the orchestrator's instruction, no dev servers
were started and the shared dev DB was not touched. The Review UIs' Mapping row is unchanged by design (HEL-1547).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/features/dashboards/types/proposal.ts:19-22`: "`fieldMapping`, `label` and `unit` are deprecated and
  ignored ...: the apply path never reads them, and so are the chart fields". This reads as if the chart fields are also
  deprecated, which contradicts the non-goal and their lack of `@deprecated`. Suggested wording: "The chart fields
  (`chartType`/...) are also ignored by the apply path (decoded only); they are not deprecated here."
- `schemas/dashboards/dashboard-proposal.schema.json:47,53`: the retained "Previously:" text now has `—` escapes
  where the original had a literal em dash. This is harmless, but it is a gratuitous byte change, probably from a JSON
  re-serializer.
- `e2e/support/expectDeleted.ts`: a thrown `request.delete` (network error) inside `finally` would still mask a body
  failure. That is pre-existing behavior and outside AC2's status-check scope.
- MCP deprecation test: not mutation-checked by the evaluator (no root node_modules in the throwaway checkout). It guards
  against vacuity with `panels.length > 0` and passes against the real `listTools()` output.
- The PR must park until V131/V132 (#994, #1000) merge, as the design states (the spec log shows "validated 131 migrations").

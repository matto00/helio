## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: 798bd46e432ee12d23c928e78e0e210885973dc9 (`git rev-parse HEAD` after reading the diff; worktree clean
apart from the untracked evaluation-1.md). Diff base resolved live by `resolve-review-base.sh` (main/origin):
f63ab8365d2b0e6cac36154a83437b6d26b3a209. 28 files, +836/-53.

### What I verified (with evidence)

**Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/proposal-legacy-fields-followups/HEL-1440`.

**AC1 (deprecated, still accepted, inert)** — read the diff in full.
- `schemas/dashboards/dashboard-proposal.schema.json`: `"deprecated": true` and a "Deprecated and ignored ... Output's
  `config`" description on fieldMapping/aggregation/label/unit, and nowhere else.
- `AssistantProposalToolSchemas.scala`: `deprecatedPanelField(...)` used on exactly those four.
- `helio-mcp/src/tools/proposal.ts`: `.describe(DEPRECATED_PANEL_FIELD_DESCRIPTION)` on the four. zod 3 emits no
  `deprecated` flag, so a description-only marker is the honest limit there.
- `frontend/.../types/proposal.ts`: `@deprecated` on fieldMapping/label/unit. The type has no `aggregation` field on
  main, so there was nothing to tag.
- Still accepted and inert: `DashboardApplyProposalConfigSpec`'s new case → 201, and the panel config is exactly
  `{outputId, controls: []}`.
- `npm run check:schemas` (run by me) → "AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces
  checked)", exit 0.

**MCP deprecation test, mutation-checked by me** (the evaluator had not done this). I used a throwaway detached
worktree at 798bd46e4 under my scratchpad and removed it afterwards, confirming that `git worktree list` no longer
lists it.
- As committed: 1/1 pass.
- Dropping `.describe` from `unit`: red (`Received has value: undefined`).
- Adding the description to `sort`: red (the "no other field" check fails).

The test is not vacuous.

**AC2 (e2e cleanup statuses):**
- All three specs route every cleanup delete through `e2e/support/expectDeleted.ts`, which calls `expect.soft(status).toBe(204)`. A soft check records the failure without throwing, so it cannot mask the error from the test body, and the later deletes still run.
- I confirmed the 204 in the route code:
  - `DashboardRoutes.scala:98` and `PipelineRoutes.scala:118` both use `runNoContent`.
  - `DataSourceRoutes.completeDelete` (lines 76-78) returns `NoContent` on success.
- `npx tsc --noEmit -p e2e`: exit 0. The specs were not run live, which is the accepted D6 fallback; the evaluator ran `--list`.

**AC3 (V133 cascade): the RLS bracket, judged independently.**
- I probed it on a throwaway PostgreSQL 18.4 cluster in my scratchpad (on 127.0.0.1:55433, since stopped and deleted), never on the shared dev DB. The setup:
  - a NOSUPERUSER NOBYPASSRLS role that owns the tables;
  - a table with FORCE RLS and the V109-shaped bare `current_setting('app.current_user_id')` policy, holding one row;
  - `app.current_user_id` unset.
- Results:
  - (A) Validating `DROP ... , ADD ... ON DELETE CASCADE` → `ERROR 42704 unrecognized configuration parameter
    "app.current_user_id"`, raised from RI_Initial_Check's `SELECT fk.user_id FROM ONLY w fk LEFT OUTER JOIN ONLY users pk ...`.
    The executor's root cause is reproduced. The FK-validation scan runs as the owner and is subject to FORCE RLS.
  - (B) **`ADD ... NOT VALID` then `VALIDATE CONSTRAINT` fails the same way** (42704, same RI query). So the
    NOT VALID + VALIDATE alternative does not avoid the problem. NOT VALID alone would avoid it, but only by leaving a
    permanently unvalidated constraint (`convalidated = false`), which is a worse end state. Setting
    `app.current_user_id` would make the validation scan RLS-filtered and so vacuous. `SET row_security = off` errors
    for a non-BYPASSRLS role when a policy applies. The bracket is the right tool.
  - (C) The V133 bracket commits, `relforcerowsecurity` is back to `t`, and `DELETE FROM users` as that owner role
    under FORCE RLS cascades the row away (users 0, windows 0). RI cascade actions need no bracket, as the header says.
- Prod safety:
  - Flyway runs each Postgres migration in its own transaction, and this repo has no `executeInTransaction`
    overrides (grep).
  - `ALTER TABLE ... NO FORCE` holds an AccessExclusiveLock until commit, so no concurrent session can observe FORCE off.
  - The evaluator's `1/0` mutation shows that a mid-migration failure rolls the `NO FORCE` back.
  - The pattern has six precedents in this repo: V106, V108, V112, V117, V118 and V119.
- Spec: `V133RateWindowCascadeMigrationSpec` runs Flyway and the user deletes as a NOSUPERUSER NOBYPASSRLS owner with
  the GUC unset, and reads counts over the superuser connection. It asserts FORCE is restored, the FK action goes
  `a`→`c`, the cascade happens, other users' rows are untouched, a dashboard still blocks the delete (23503, nothing
  removed), and a ghost FK insert is still rejected.
- `docs/user-reference-inventory.md`: the row is CASCADE and the prose no longer lists rate-window rows.
  `V119OwnerFkMigrationSpec` is green.

**AC4 (chart slots):** the chart fixtures in `buildOutputConfig.test.ts`, `OutputEditorSheet.configPatch.test.tsx` and
`OutputEditorSheet.openingState.test.tsx` now use xAxis/yAxis/series/annotation. I ran the three files: 3 suites,
64/64 pass.

**AC5:** no `asInstanceOf[JsString]` or `asInstanceOf[JsArray]` remains in `AssistantProposalToolSchemasSpec.scala`
(diff lines 89/99/108 replaced by `convertTo`).

**Gates I ran myself in WORKTREE_PATH (nice 19, workers ≤3):** `check:schemas`, `typecheck`, `lint`, `format:check`,
`tsc -p e2e` and `helio-mcp typecheck` all exited 0.

**Backend coverage (is skipping `sbt testFull` adequate?):** I ran three foreground `testOnly` shards. Together they
cover every test file that references `pipeline_run_rate_window`, every test file that consumes the assistant tool
schema, and the proposal-apply and Flyway-as-non-superuser specs:
- Shard 1: V133RateWindowCascadeMigrationSpec, V119OwnerFkMigrationSpec, RlsPolicyGuardSpec,
  PipelineRunGuardRepositorySpec, AssistantProposalToolSchemasSpec, DashboardApplyProposalConfigSpec,
  PipelineAnalyzeProposalRoutesSpec, AssistantServiceSpec. Result: 8 suites, 221 passed, 0 failed.
- Shard 2: PipelineAutoRunDebounceRepositorySpec, AutoRunGuardBurstProofSpec, DatasetWriteAutoRunEndToEndSpec,
  AutoRunGuardNoRetryStormSpec, FireTimeRunConfigGateSpec, DatasetWriteAutoRunDroppedFireSpec,
  FlywayNonSuperuserMigrationSpec. Result: 7 suites, 42 passed.
- Shard 3: AssistantConversationRoutesSpec, AssistantTelemetrySpec, PatchSetTargetKindsSchemaGuardSpec. Result:
  3 suites, 29 passed.

The diff's backend runtime surface is only (a) annotation keys in one JSON tool schema and (b) one FK's delete action.
A cascade can only make previously failing user deletes succeed. Given that, these 18 suites are adequate, and a full
`testFull` would add little signal. CI runs the whole suite before merge regardless.

**UI:** there is no runtime UI change. The only non-test file changed under `frontend/src` is `types/proposal.ts`, and
only its comments and JSDoc changed. The evaluator reports sha256-identical JS chunks against base. I did not boot the
servers: there is nothing visual to judge, and the orchestrator forbade booting this branch against the shared dev DB.

**Claims vs. ground truth:** every executor and evaluator claim I re-checked held:
- the 42704 root cause;
- 204 for every cleanup DELETE;
- the deprecation tests go red under mutation;
- `files-modified.md` matches the diff stat.

The evaluator's report does not rely on mtime-ordering evidence, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- **Merge order is mandatory:**
  - V133 sits above the unmerged V131 (#994) and V132 (#1000), and Flyway (no `outOfOrder`) refuses a lower version
    after a higher one on any persistent DB (prod, the shared dev DB).
  - This PR must merge and release after both, or they must be renumbered.
  - The design records this (Risks). The driver must enforce it.
- `design.md` D3 still says "RLS untouched", but the implementation adds the bracket. The end-state RLS flags are
  unchanged, so this is not a behavior divergence. Still, the archived design will mislead. A one-line amendment would fix it.
- The V119 header comment ("FK validation and RI cascade actions run as the table owner without RLS, so the
  constraint steps need no bracket") is factually wrong about FK validation: probe (A) above disproves it. It was
  harmless there only because V119's bracket happened to cover its constraint steps. V133's header states the correct
  behavior. Consider a follow-up note (do not edit an applied migration file, since that changes its checksum) in
  `MISTAKES.md`, so the next migration author does not trust V119's comment.
- `frontend/src/features/dashboards/types/proposal.ts:19-22`: as the evaluator noted, "...and so are the chart
  fields" reads as if the chart fields were also deprecated. The factual part is correct:
  `FirstRunDashboardService.scala:115-117` confirms that the dashboard apply does not consume `chartType`. The
  wording should be fixed.
- `dashboard-proposal.schema.json`: the "Previously:" text in fieldMapping's description has `—` escapes where
  the original had literal em dashes, while four other lines still use literal em dashes. This is cosmetic only.

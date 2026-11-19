## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); the only exception is scripts/concertino/.concertino.env, which scripts may read but never print. Never copy .env files.
- [C2] Quoted heredocs only (<<'EOF'), or use Write/Edit.
- [C3] No pkill/pgrep/killall. Kill exact PIDs only. Stop servers with scripts/concertino/stop-servers.sh. Delete test residue with buildUserDeleteSql, by exact id. Use plain emails.
- [C4] Caps: jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000. Run `sbt testFull`, never bare `sbt test`.
- [C12] Red first, with mutations. Run full spec files. Write tests before code in every stage, and record the red runs in .concertino/scratch/HEL-1784/.
- [C13] Scratch goes in .concertino/scratch/HEL-1784/.
- [C14] Lane-private DB helio_hel1784 (createdb). Set DATABASE_URL for start-servers.sh AND Playwright (e2e/support/db.cjs silently falls back to the dev DB without it). Pass DB_USER when DATABASE_URL has no credentials. Start every lane backend with ANTHROPIC_API_KEY exported empty.
- [C15] Owner ruling 1: a non-owner's counter never requests /api/data-sources/* (no aggregate, rows or schema). It shows a local tally only.
- [C16] Owner ruling 2: GET /api/panels/:id/form-schema returns ONLY the declarations of the form's bound fields. It re-checks dashboard edit access per panel (404 stranger, 403 viewer) and is proven under RLS as the NOBYPASSRLS role.
- [C17] Owner ruling 3: a non-owner submitter's response carries no `seq` key.
- [C18] Do not edit HEL-1780's files: panel cards, dashboard role reads, PanelDetailModal and its tests. Frontend edits are limited to FormRenderer.tsx, FormPanelView.tsx, panelService.ts, state/formConfigValidation.ts, state/formSubmission.ts, their tests, and a type if needed. Report any other file before touching it.
- [C19] Grep e2e/ for every selector or visible string the change alters, and update the specs that use it.

## 1. Migration and attribution plumbing (red first)

- [x] 1.1 Red: write a repository/firer spec asserting that `upsertDebounce` stores the writer and that a fired auto-run's `pipeline_runs.triggered_by_user_id` is the stored writer (falling back to the owner when NULL). Run it and record the red result.
- [x] 1.2 Add `V146__auto_run_debounce_triggered_by.sql` (design D5). Confirm V146 is still free on origin/main before committing. Add `| pipeline_auto_run_debounce | triggered_by_user_id | SET NULL |` (sorted) plus a SET NULL note sentence to `docs/user-reference-inventory.md`, so `V119OwnerFkMigrationSpec` stays green.
- [x] 1.3 `PipelineAutoRunDebounceRepository.upsertDebounce(pipelineId, fireAt, writer)` takes the writer with NO default. `claimDue`'s RETURNING and return type carry `triggered_by_user_id`. `PipelineAutoRunDebounceFirer.submitAutoRun` passes it. `PipelineRunService.submit` gains `triggeredByUserId: Option[UserId] = None`, threaded `submit` → `runPipeline` → `PipelineRunExecutor.executeRun`, where it replaces ONLY the stored `submitterId`; `ownerRun`, admission and authorization stay keyed on the acting owner. `recordUnrunnable` gets the same treatment. Update every caller, tests included. 1.1 is green.

## 2. Server authorization and write path (red first)

- [x] 2.1 Red: route/service specs for editor 201 without `seq`, owner 201 with `seq`, viewer 403 ViewOnly, stranger 404, downgraded-editor 403, dashboard owner submitting an editor-created form, the file-upload path for an editor, the audit actor + `panelId` + `sourceOwnerId`, a signed-in stranger on a PUBLIC dashboard → 404, a non-owner's fieldErrors naming an unconfigured required field filtered with the generic message (the owner still gets the precise error), a non-owner row-limit message with no number, and a mismatched binding (B duplicates A's form; B's submit → 404, nothing written), a multipart (file-attached) editor submit against a dataset with an unconfigured required field (400 names no unbound field, no file stored), the owner renaming `occurred_at` after configuring a counter form so that an editor's `+` writes nothing and gets the generic message while the owner's direct API gets 400 (D4a), a dropped-`value` variant of that case, and a probe case: an editor's extra key that IS declared-but-unconfigured and an extra key that is NOT declared produce byte-equal 400 bodies (D4 filter rule). Update any existing spec that asserts the old "Only this form's owner" 403 to the new behavior (grep backend/src/test, frontend/src, e2e).
- [x] 2.2 `PanelService.submitForm`: D1 authorization via `authorizeEditorOnDashboard`. Pass `sourceOwner = panel.ownerId` into `appendFormRow` and the file path (D2), and keep the writer for audit/trigger.
- [x] 2.3 `DataSourceService.appendFormRow(id, build, panelId, writer, sourceOwner)`: owner-context lookup and append, a comment naming design D2, audit metadata, and `triggerAutoRunAwaited(id, writer)` storing the writer on the debounce row.
- [x] 2.4 Submit route: a new `FormSubmitResponse`/`FormSubmitRowResponse(seq: Option[Long])` for both the JSON and multipart submit routes. Omit `seq` for a non-owner submitter (D4). Add `FormSubmitError.reason` (D4). Enforce the counter row shape inside `FormSubmission.buildRow` via a public wrapper over `checkCounterRowShape` (D4a). Map non-owner errors in one `PanelService` function that wraps both submit branches (D4). Add `schemas/panels/form-submit-response.schema.json` and keep the schema-drift check green.

## 3. Form-schema route (red first)

- [x] 3.1 Red: route spec for `GET /api/panels/:id/form-schema`: filtering to bound fields in declared order, 403 viewer, 404 stranger, 404 signed-in stranger on a public dashboard, 400 non-form, 404 deleted source.
- [x] 3.2 Implement it in `PanelService`/`PanelRoutes` (D3). Add `schemas/panels/form-schema-response.schema.json`. Capture the route's real JSON for a counter form into a shared fixture (e.g. `shared-test-fixtures/panels/form-schema-counter.json`), asserted byte-equal by the route spec, for the frontend test in 5.1.

## 4. RLS proof as the NOBYPASSRLS role (red first)

- [x] 4.1 New spec using the two-role `helio_app_test` harness (`PipelineRunServiceUpsertSourceRlsSpec` pattern). It covers: an editor submit lands one row in the owner's source; the same append in the editor's own context writes nothing; the form-schema read works in owner context and returns nothing in editor context; the debounce row stores the editor; the fired run is the owner's (counted by `countOwnerInFlightRealRunsInternal(owner)`) with `triggered_by_user_id = editor`. Demonstrate red by mutation, e.g. by running the append in the editor's context, and record it.

## 5. Frontend (red first)

- [x] 5.1 Red: jest tests. `FormRenderer.roles.test.tsx`: editor sees the form; viewer sees "Only editors can submit this form". `FormPanelView` non-owner: the schema comes from `/api/panels/:id/form-schema`; a compact counter fed the shared fixture from 3.2 is enabled with no issue and `+` submits; a STACKED form (counter + text field) fed the fixture submits for a non-owner (the `skipCounterRowShape` option is threaded through `formConfigValidation.ts` and all four `computeFormIssues` call sites in `formSubmission.ts`); there is no `/api/data-sources/*` call, the counter tally moves locally, an indeterminate failure announces "Couldn't confirm…", and a definite rejection rolls back. The owner path is unchanged, including reconciliation.
- [x] 5.2 Implement D6 in `FormRenderer.tsx`, `FormPanelView.tsx` and `panelService.ts` (`fetchFormSchema`). Confirm by grep that no client code reads `seq` from the submit response.

## 6. e2e

- [x] 6.1 `e2e/hel1784-editor-form-submit.spec.ts` against the lane DB (DATABASE_URL set). Cover owner, editor, viewer and stranger as design D7 describes. Include an editor's compact counter (enabled, `+` lands a row). Assert no `/api/data-sources/*` request from the editor page. Run the whole spec file; record the red run first (before 5.2, the editor sees no form).
- [x] 6.2 Update `e2e/shard-weights.tsv` if the repo's convention requires new specs to be listed (check HEL-1772's tooling).

## 7. Gates

- [x] 7.1 `sbt testFull` (with -J-Xmx3g, nice), frontend lint/typecheck/format/jest, Playwright runs of the new spec and every e2e spec that touches form panels (`e2e/hel108*`, `hel109*`, `hel1169*`, `hel1773*`).
- [x] 7.2 Update CLAUDE.md's `POST /api/panels/:id/submit` key-endpoint line (admission, `seq`) and add the `GET /api/panels/:id/form-schema` line.
- [x] 7.3 Write files-modified.md for squash-branch.sh.

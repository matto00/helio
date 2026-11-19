## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `90c2f787301999cf16b8c3257dfbee80dada09bd`: the merge of `origin/main` (b2603ab79, which includes HEL-1780) onto the feature commit a775a7cfc. Base resolved live with `resolve-review-base.sh` = `b2603ab7998f3e9b4bdca5089a18f89da16fdc8b` (exit 0). The diff `b2603ab79...HEAD` touches 56 files.
Evidence: durable copies are under `/home/matt/Development/helio/.concertino/runs/HEL-1784/evidence/.concertino/scratch/HEL-1784/skf-*`. Every claim below rests on content (test output, HTTP bodies, DB rows, code lines), not on mtimes.

### What I verified (with evidence)

**Gates, run myself on the merged HEAD**
- `nice -n 19 sbt -J-Xmx3g testFull`, one unchunked run:
  - Result: `Suites: completed 742, aborted 0` / `Tests: succeeded 10052, failed 0, canceled 5` / `All tests passed.` / hel1468 guard `failed=0 aborted=0 unreadable=0` / exit 0.
  - The run took 19 m 49 s (`skf-sbt-testFull.log`).
  - Deviation: I ran it with `run_in_background`, not as a 600 s foreground call. A 600 s foreground timeout would have killed a 20-minute run.
  - The count is consistent with the evaluator's pre-merge run (741 suites, 10047 tests): HEL-1780 adds `DashboardGranteePanelRoutesSpec`, which is +1 suite and +5 tests.
- Frontend jest (`HELIO_JEST_MAX_WORKERS=3 nice -n 19 npm --prefix frontend test`):
  - Result: `Test Suites: 859 passed, 859 total` / `Tests: 10178 passed`, exit 0 (`skf-jest.log`).
  - This is the merged tree, including every HEL-1780 test.
- Playwright on my own fresh servers:
  - Servers: started by `start-servers.sh` at 03:42, after the 03:10 merge commit. The backend log shows Flyway on `jdbc:postgresql://localhost:5432/helio_hel1784`.
  - Environment: `DATABASE_URL`/`DB_USER` exported for the servers and for Playwright, `ANTHROPIC_API_KEY` empty, 2 workers.
  - Specs: `hel1784-editor-form-submit`, every `hel1773*`, `hel1780-shared-dashboard-panel-features` and `hel1087*`.
  - Result: **23 passed** (`skf-playwright.log`).
  - Servers stopped with `stop-servers.sh` (`STOPPED ports=7216,10123`). Nothing is listening afterwards.

**1. The beyond-ticket counter-shape 400**
- Code:
  - `FormSubmission.buildRow` appends `FormSchemaConsistency.counterRowShapeViolation` errors (FormSubmission.scala:143-146).
  - The rule fires only when `config.fields.exists(_.control == "counter")` (FormSchemaConsistency.scala:58), and it is the configure-time rule itself (shared private `counterShapeViolation`).
  - It runs inside the in-lock `build` closure and the file path's pre-lock pass. `buildRow` has no other callers (grep).
- Justified:
  - Before this change, a counter form whose dataset later dropped, renamed or retyped `occurred_at`/`value` (allowed by `updateDatasetSchema`) wrote rows with no usable timestamp.
  - The owner's UI already disabled that control, so only a direct API call reached the write.
  - It is also necessary for this ticket. A non-owner's client cannot judge the shape, because the form-schema route omits `occurred_at`/`value` (`skipCounterRowShape`). The server must therefore enforce the shape.
- Correctly bounded:
  - Only counter forms are affected, and only when the dataset's shape is already broken.
  - The field error names `occurred_at`/`value` for the owner. A non-owner gets the generic masked message, because those names are not configured fields.
- Tests are adequate:
  - `FormSubmissionSpec` covers three cases: renamed `occurred_at`, dropped or required `value`, and a bad delta plus a broken shape reported together.
  - The `FormSubmitEditorRoutesSpec` "counter shape" block covers editor generic vs owner precise, with zero rows written, the dropped-`value` case for both submitters, and the intact-dataset 201.
- Documentation: it is named as a behavior change in proposal.md:20, design.md D4a (:153-166) and the CLAUDE.md submit entry. **The PR body must carry it** (see note 1).

**2. Acceptance criteria, end to end**
- **Editor admitted; client shows the control.**
  - Server: `PanelService.submitForm` → `authorizeEditorOnDashboard` (Owner/Editor → Right; PanelService.scala:341-349). The write goes to `DataSourceService.appendFormRow(..., writer, panel.ownerId)` in the owner's context.
  - Client: `FormRenderer` gates on `useCanEditPanels()`, which is unchanged by the merge (dashboardAccessContext.tsx:28-31).
  - Live check as a fresh editor: JSON submit 201 and counter submit 201. The editor UI renders the form and an enabled counter in dark and light, identical to the owner's view (`skf-editor-dark.png`, `skf-editor-light.png` vs `skf-owner-dark.png`).
- **Viewer and stranger refused, with an e2e for all three roles.**
  - Live viewer: `form-schema` 403 and `submit` 403, both "You have view-only access to this dashboard". The viewer UI shows "Only editors can submit this form" (`skf-viewer-light.png`).
  - The e2e covers the editor (:197, :213, :229), the viewer (:247, UI plus a direct POST 403, no row) and the stranger (:262, "Dashboard not found", submit 404, form-schema 404, no row). All passed in my run.
- **Attribution.**
  - Audit row from my live probe in the lane DB: `audit_events` actor = the editor id, metadata `{"panelId", "sourceOwnerId": <owner>}`.
  - Auto-run: the writer is stored on `pipeline_auto_run_debounce.triggered_by_user_id` (V146, additive, nullable, no backfill, `ON DELETE SET NULL`).
  - The firer submits as the owner (`AuthenticatedUser(ownerId, System)`) with `triggeredByUserId = writer` (PipelineAutoRunDebounceFirer.scala:536-539). Only `submitterId` changes (PipelineRunExecutor.scala:582); admission and caps stay owner-keyed.
  - `FormSubmitEditorRlsSpec` "store the editor on the debounce row..." asserts three things:
    - the run row is `(editor, auto_run)`;
    - a rate-window row exists for the owner;
    - no rate-window row exists for the editor.
  - This mirrors HEL-1492.
- **RLS checked as helio_app.**
  - `FormSubmitEditorRlsSpec` runs the app pool under `SET ROLE helio_app_test` (NOBYPASSRLS, the established two-role harness) and the privileged pool under `helio_privileged`.
  - It proves:
    - the editor's own context writes and reads nothing;
    - the owner's context lands the row;
    - a form whose owner does not own the bound source writes nothing.
  - The evaluator's BYPASSRLS mutation (`eval-1-mutation-rls-bypass.log`) shows these assertions depend on the policies. I read that log's claim and the spec; I did not re-run the mutation.
- **A test that fails first.**
  - `red-2.1-editor-routes.txt` shows 6 `*** FAILED ***` against the old code (editor 403≠201, viewer message, public-dashboard stranger 403≠404, downgrade, owner-on-editor-form, file submit).
  - Frontend and e2e reds are recorded in `red-5.1` and `red-6.1`.

**3. No non-owner read path leaks rows or undeclared names.** I probed this live as the editor on a dataset that declares `note` and `secret`, with a form that binds only `note`:
- `GET /api/panels/:id/form-schema` → `{"fields":[{"name":"note",...}]}`, so `secret` is absent. The counter form returns only `delta`, with no `occurred_at`/`value`.
- Submit response: `{"deniedPipelines":[],"rows":[{"id","updatedAt"}],"updatedAt"}`, with **no `seq`** (`FormSubmitResponse.fromDomain`, gated on `writerIsFormOwner`).
- Error masking, JSON: submitting `secret` (declared but unconfigured) and `nonexist` (undeclared) return **byte-identical** 400s: `"This form no longer matches its dataset. Ask its owner to update it."` A missing configured field still gets its precise `fieldErrors` (`note: required`).
- Error masking, multipart: the same two probes with file parts return the same byte-identical generic 400. Admission runs before `storeFormFiles`, so a viewer cannot store objects.
- The row-cap message is masked (`FormSubmitErrorMasking.RowLimit`, no number). The route spec asserts the owner still sees "500".
- `GET /api/data-sources/:id/schema` as the editor → 404 (unchanged).
- Frontend: Playwright network capture of the editor's page load plus a counter "+" shows only `GET /api/panels/*/form-schema` and `POST /api/panels/*/submit`, with **zero `/api/data-sources/*` requests** and 0 console errors. The e2e watcher asserts the same (`dataSourceRequests == []`).
- The `deniedPipelines` list stays writer-relative: `AutoRunTriggerService.handleDenied` drops pipelines the writer has no grant on.

**4. Merge with HEL-1780**
- `git diff-tree --cc 90c2f7873` prints no conflict hunks.
- The only file both sides touched is `PanelDetailModal.test.tsx`. This branch adds one `auth.currentUser` line to `renderFormModal`, under the human "allow-edit" answer.
- HEL-1780 removed `useCanUseOutputRoutes` and left `useCanEditPanels` intact. Its `PanelContent.tsx` changes contain no form code.
- On the merged tree:
  - jest is 859/859 green;
  - `DashboardGranteePanelRoutesSpec` is green in testFull;
  - the hel1780 and hel1773 e2e specs pass alongside hel1784.
- Nothing broke.

**UI / design judgment**
- No CSS, token or markup structure changes.
- Editors get the exact `FormPanelView` the owner has. Light/dark parity is confirmed by screenshot.
- The viewer state reuses `panel-content--state` / `panel-content__state-label`, matching HEL-1773's prior treatment. It is centred, muted and consistent across both panels.

### Verdict: CONFIRM

### Non-blocking notes
1. The PR body must name the counter-shape behavior change explicitly: the owner's direct-API counter submit to a dataset that has lost the `occurred_at`/`value` shape goes from `201` (a row with no usable timestamp) to `400`. The PR body should also name:
   - the public-dashboard signed-in non-grantee's submit going from `403` to `404`;
   - the stage-3 test-ordering deviation the evaluator recorded.
2. The viewer copy "Only editors can submit this form" is accurate (owners count as editors), and it is a reasonable owner-facing default. No change is needed.
3. The non-owner counter tally resets to 0 on reload, even after the user's own clicks. This follows ruling 1 (no aggregate read). It may surprise users and is worth a future follow-up, but it is not a defect here.
4. The evaluator's suggestions 2-4 still stand (tasks/design wording on the owner-count proof, the dead `recordUnrunnable` parameter, an `ExistenceNotLeakedRoutesSpec` row for `form-schema`). None blocks shipping.
5. Process disclosure: one MCP screenshot was first written to the main checkout's `.concertino/scratch/HEL-1784/` (a relative path resolved against the MCP root). It was mislabeled "light" and was actually dark. I copied it into the worktree as `skf-owner-dark.png`, persisted it, and deleted the original by exact path. My probe users (3) were deleted from `helio_hel1784` by exact id and email via `buildUserDeleteSql` (0 `skf1784-%` users remain).

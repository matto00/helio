## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `a1cfd19dc09bca372654deae23d5fac376bf1157` (the change dir is untracked; no code changes yet).
Owner rulings 1–3 treated as settled scope. D2 and D5 judged on their merits.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/editors-submit-form-panels/HEL-1784`.
- **Submit is owner-only today:** `PanelService.scala:113-131`. `panel.ownerId != user.id` leads to `Forbidden("Only this form's owner can submit to its data source")`. Confirmed.
- **`authorizeEditorOnDashboard` exists and does what D1 says:** `PanelService.scala:315-323` maps Viewer to `403 ViewOnly` and Owner or Editor to `Right`. Confirmed.
- **`appendFormRow` context:** `DataSourceService.scala:859-882`. `findByIdOwned` (`DataSourceRepository.scala:180-182`), `appendBuiltRow` (`:656-663`) and `getDeclaredSchema` (`:952-954`) all run in `ctx.withUserContext(user.id)`. Confirmed. The audit call and `triggerAutoRunAwaited(id, user)` are at `:876-877`. Confirmed.
- **File path:** `PanelFormFileSubmission.scala:43-77` reads `getDeclaredSchema(…, user)` before the lock, then calls `appendFormRow`. Confirmed. Storage keys are UUIDs with no per-user ownership, so owner context does not change file ownership.
- **Debounce:** `PipelineAutoRunDebounceRepository.upsertDebounce` (`:35-46`) runs in system context and has exactly one production caller (`AutoRunTriggerService.scala:78`). `triggerAutoRun` is reached only from `DataSourceService` (`:116`, `:128`), and every path there has the writer `user`. HEL-1739 `write_generation = EXCLUDED.write_generation`, the HEL-1504 `guard_retry_count = 0` reset, `rearmAfterGuardRejection`, `unclaim` and `cancelIfGeneration` are all independent of a new column. D5 leaves them intact. Confirmed.
- **Firer:** `PipelineAutoRunDebounceFirer.submitAutoRun` (`:116-121`) submits as the pipeline owner (`AuditSource.System`). Confirmed. `claimDue` (`:67-79`) currently returns only `(pipeline_id, claimed_at)`.
- **`triggered_by_user_id` readers:** none. A grep of `backend/src/main` finds only writes, so storing a non-grantee editor there cannot affect any re-authorization. Good for D5.
- **`ownerId` emission:** `PublicPanelListResolver.scala:98-102` sends `ownerId` only to the dashboard Owner or the panel's own creator. `PanelResponse.fromDomain` defaults `includeOwnerId = true` (`PanelProtocol.scala:176`), and the create, PATCH and duplicate responses go to the actor. So D6's `isFormOwner = panel.ownerId === currentUser.id` is correct for every caller, and it fails closed when `ownerId` is absent.
- **Can an editor widen the bound fields, and so the form-schema output?** No. `PanelUpdateValidation.validate` runs `rejectInconsistentForm(effectiveConfig, user)` against the patcher. That calls `findByIdOwned(source, patcher)` (`FormBindingValidator.scala:41-63`), so a non-source-owner cannot change the fields of a form bound to someone else's source.
- **Can a panel's `ownerId` name someone other than the user who created, duplicated or imported it?** No. `PanelCreateBuilder:74`, `PanelMutationRepository` duplicate (`:70`), `DashboardSnapshotRepository.duplicate` (`:56-58`) and `importSnapshot` (`:179-184`) all set `ownerId` to the acting user. The binding is copied verbatim, though, so the Context sentence "A form panel's owner is its bound source's owner" is not an invariant. D2 is still safe: the write is fenced to `panel.ownerId`'s own sources, so a mismatched binding gives `404`. That is D2's main benefit over a privileged-pool write, and I agree with D2 on the merits.
- **Panel moved between dashboards:** not possible. `UpdatePanelRequest` (`PanelProtocol.scala:93-98`) has no `dashboardId`, and no repository path rewrites `panels.dashboard_id`.
- **PAT and scoped tokens:** `AuthDirectives.confineScopedToken` (`:141-162`) answers `403` to any scoped PAT outside `/hooks`. An unscoped PAT is the user, so behavior is the same as a session. Share tokens exist only in `PublicDashboardRoutes`, not on the authenticated `/api/panels` tree.
- **RLS harness:** `PipelineRunServiceUpsertSourceRlsSpec.scala:29-32` uses the two-role NOBYPASSRLS harness. D7 and task 4.1 use that pattern, with mutation red, so the RLS proof plan is adequate.
- **Migration slot:** the highest migration on `main` is V145, and V142/V143 are absent. V146 is free locally (driver-confirmed reservation).

### Verdict: REFUTE

### Change Requests

1. **The non-owner counter would render disabled. The Context claim behind this is false.**
   - **The claim:** design.md Context says "`computeFormIssues` checks only the form's configured fields against the declarations".
   - **The code:** `frontend/src/features/panels/state/formConfigValidation.ts:177-178` also runs `checkCounterRowShape` (`:187-230`). That function requires `occurred_at` (a timestamp) and `value` (numeric, not required) in the schema.
   - **The effect:** D3 filters the form-schema response to `panel.config.fields.map(_.sourceField)`, which never includes `occurred_at` or `value`. Every non-owner counter field therefore gets the issue "counter field requires the bound dataset to declare a field named 'occurred_at'". `FormFieldControl.tsx:70` renders an issue as a disabled control. The headline editor use case (a compact counter) would ship broken. A jest test with a hand-built schema mock would not catch this.
   - **Required:** decide and write down one of these:
     - (a) The form-schema route also returns the `occurred_at` and `value` declarations when the form has a counter field. They are fields the form's counter submit writes (`FormSubmission.scala` injects both), so arguably the form binds them. State this reading of ruling 2 explicitly in D3 and in the spec requirement.
     - (b) The non-owner path skips `checkCounterRowShape`. That stays strictly within ruling 2, because the server re-validates under lock.
   - **Tests:** add a jest case (and an e2e case, task 6.1) in which a non-owner editor uses a compact counter whose schema response is exactly what the real route returns. Assert that it is enabled and that `+` submits. Correct the Context sentence.

2. **D1's public-dashboard claim is wrong.**
   - **The claim:** design.md D1 says "A public dashboard yields `Viewer` for a non-grantee, so the response is `403`". Both spec requirements (submit and form-schema) say `403` for "view-only access (a named viewer grant or public visibility)".
   - **The code:** `AccessCheckerImpl.scala:70-79`. For a signed-in caller who is not the owner, `requireAccess` uses `findGrant`, which matches only `grantee_id = user.id` (`ResourcePermissionRepository.scala:80-90`). With no named grant it returns `NotFound("Dashboard not found")`. The public-grant arm (`:81-85`) applies only to an anonymous caller, and the authenticated `/api/panels` tree never has one. Meanwhile `panelRepo.findById` *does* return the panel through `publicPred` (`PanelRepository.scala:170-183`).
   - **The effect:** a signed-in stranger on a public dashboard gets `404 Dashboard not found`, not `403`.
   - **Required:** correct D1 and both spec requirements to say that public visibility alone gives `404`. Add that case to the route specs (2.1, 3.1). Do not change `AccessChecker` to make the text true. That would change every panel-mutation route.

3. **D5 names the wrong code site for the stored trigger user.**
   - **The claim:** D5 says "`insertRun` stores `triggeredByUserId.getOrElse(user.id)`".
   - **The code:** a real run, the auto-run included, is admitted by `insertRunIfUnderConcurrencyCap` or `insertGranteeRunIfUnderOwnerCap` with `submitterId = Some(user.id.value)`, computed in `PipelineRunExecutor.executeRun` (`PipelineRunExecutor.scala:119-121, 179, 182`). `PipelineRunService.insertRun` (`:225`) is only `recordUnrunnable`.
   - **Required:** D5 must say that the new `triggeredByUserId` threads `submit` → `runPipeline` → `executeRun`, and replaces only the stored `submitterId`. `ownerRun` (`:119`) and every authorization and persistence choice must keep keying on the acting `user` (the owner). D5 must also say that `claimDue`'s `RETURNING` (`PipelineAutoRunDebounceRepository.scala:73-78`) gains `triggered_by_user_id`, and that its return type changes accordingly. Update task 1.3 to match.

4. **V146 will turn `V119OwnerFkMigrationSpec` red unless the inventory is updated.**
   - **The code:** `docs/user-reference-inventory.md:9-11` says its FK table "is parsed by `V119OwnerFkMigrationSpec`, which compares it to the foreign keys of a fully migrated database". V146 adds a new `REFERENCES users(id) ON DELETE SET NULL`.
   - **Required:** task 1.2 must add the row `| pipeline_auto_run_debounce | triggered_by_user_id | SET NULL |` (in sorted position) and a sentence to the SET NULL note. V124 did the same for `pipeline_runs`.

5. **The submit error path can disclose unbound declarations to a non-owner. This contradicts the design's own Goal.**
   - **The goal:** "The editor learns nothing about the dataset beyond the bound fields' declarations and their own row's id/updatedAt".
   - **The code:** `FormSubmission.buildRow` validates the positional row against the *whole* effective declaration (`FormSubmission.scala:160-177` → `DatasetRowValidator.validateRowStructured`, `:130-150`). Suppose the owner later adds a required, default-less field the form does not configure, or a declared default fails validation (`DatasetRowValidator.scala:90`). The editor's `400` then carries `fieldErrors: [{"field": "<unbound name>", "reason": "required"}]`, which names a declaration outside the form.
   - **Required:** D4 must decide this explicitly. Either:
     - for a non-owner submitter, replace field errors whose `field` is not a configured `sourceField` with a generic, name-free error (for example "This form no longer matches its dataset"); or
     - accept the disclosure, with a stated rationale that reconciles it with the Goal and ruling 2.
   - **Also:** state the stance on the row-limit `400` (`DataSourceRepository.scala:687`, "Payload exceeds the maximum of N rows"), which tells a non-owner that the dataset is at the cap.
   - **Tests:** add a route test for whichever choice is made (task 2.1).

### Non-blocking notes

- **Attribution timing.** D5 reads the writer at `claimDue` time. A write landing after the claim but before the HEL-1739 generation snapshot is consumed by that run (the run's success deletes the row) yet attributed to the claim-time writer. Consider reading `triggered_by_user_id` together with `pendingWriteGeneration` so the recorded "last writer before it fired" matches the generation the run actually covered. This is minor, and the column is never exposed.
- **Mid-request revocation.** Authorization (D1) and the write are separate transactions, so a grant revoked inside that window of a few milliseconds is not honored for that one request. This is the same as every other panel mutation and is acceptable. Say so in Risks.
- **Mismatched-binding test.** Add an RLS or route case: B duplicates A's form (so `panel.ownerId = B` while the binding is still A's source), and B's submit gets `404` with nothing written. This is D2's fence, and a test makes it explicit.
- **Response type for D4.** Keeping `row-write-row-response.schema.json` unchanged while omitting `seq` needs a separate Scala response type for the form route. A shared `Option[Long]` field would drift the shared schema. Name the type in D4.
- **Test callers of `upsertDebounce`.** Changing the signature will break test callers. A default parameter is not advisable, because it would let a production caller silently omit the writer. Just budget for the test edits.
- **Counter `value` pass-through.** A counter submit passes the client's `value` through to a declared `value` field (`FormSubmission.scala:151-155`). Editors can now write arbitrary numbers there. This is pre-existing behavior ("non-authoritative") but newly reachable by non-owners. Worth one line in Risks.
- **Gate defect check (mtime evidence):** not applicable. No evidence directory or mtime-ordering claims were involved.

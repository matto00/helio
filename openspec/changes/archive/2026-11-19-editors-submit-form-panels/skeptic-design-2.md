## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `a1cfd19dc09bca372654deae23d5fac376bf1157`. The change dir is untracked and there is no code change yet.
I treated owner rulings 1–3 (escalation `HEL-1784-1795077466035-790706`) as settled scope.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/editors-submit-form-panels/HEL-1784`.

**Round-1 revisions**

- **R1 (counter disabled by `checkCounterRowShape`): addressed.**
  - The design.md Context sentence is corrected (lines 27-30).
  - D6 picks option (b): non-owners skip the check.
  - D7 and task 5.1 add a jest case fed a fixture captured from the route. Task 6.1 adds an e2e compact-counter case.
  - The decision, though, rests on a false safety claim. See CR 1.
- **R2 (public dashboard → 404): addressed** in design D1 (lines 73-77), both spec requirements (submit and form-schema), D7, and tasks 2.1 and 3.1.
  - I re-read `AccessCheckerImpl` (`:70-79`). A signed-in caller who is not the owner and has no named grant gets `NotFound`. Confirmed.
  - **Not addressed:** proposal.md "What Changes" still says "A viewer (named or public) gets `403`". See CR 4.
- **R3 (trigger-user site): addressed.**
  - D5 now threads `submit` → `runPipeline` → `executeRun`, and replaces only `submitterId`.
  - Checked against `PipelineRunExecutor.scala:120-121, 179, 182`: `ownerRun` and `submitterId` are where D5 says.
  - `claimDue`'s `RETURNING pipeline_id, claimed_at` is at `PipelineAutoRunDebounceRepository.scala:70-78`. The D5 change and task 1.3 match it.
- **R4 (user-reference inventory): addressed.**
  - Task 1.2 and D5 add the row plus a SET NULL note.
  - `docs/user-reference-inventory.md:40,51` shows the V124 precedent.
  - V145 is the highest migration both locally and on `origin/main`, so V146 is free.
- **R5 (non-owner error disclosure): addressed in intent.** D4 filters unbound `fieldErrors`, uses a generic message, and drops the number from the row-limit message. A spec requirement and tests 2.1 cover it. Two gaps remain in how it would be implemented: CR 2 and CR 3.

**Question 1: does skipping `checkCounterRowShape` hide a state a non-owner can't recover from? Yes.**

- **Where the check runs:** the counter row shape is enforced only when a form is configured.
  - The server check is `FormBindingValidator.scala:56` → `FormSchemaConsistency.checkCounterRowShape`, which has no other caller.
  - The client check is `formConfigValidation.ts:179`.
- **The submit path does not re-check the shape.** `FormSubmission.buildRow` (`FormSubmission.scala:150-158`) injects `occurred_at` only `if declaredByName.get("occurred_at")` exists. It never rejects a missing or wrongly typed `occurred_at` or `value`.
- **The owner can break the shape after configuration.** `PATCH /api/data-sources/:id/schema` (`DataSourceService.updateDatasetSchema`, `:1046`; `DatasetSchemaMigration.scala:75-195`) allows renames, retypes, and drops (with `confirmDrop`). It never consults bound forms.
- **What each user sees after `occurred_at` is renamed, dropped or retyped to text:**
  - The owner's counter is disabled with a configuration issue, which the owner can act on.
  - A non-owner's counter, with the check skipped, stays enabled. Every `+` succeeds (`201`) and appends a counter event with no `occurred_at` (or with a text timestamp). No one is signalled: the non-owner sees success, and the owner sees only a disabled control on their own view.
- **D6's claim is false for this case.** D6 says (line 181-182): "the server re-validates the row shape under lock, so a misconfigured dataset still fails safely: it surfaces as D4's generic message". Only a `required` `value`, or an `occurred_at` retyped to a non-string type, would fail. That is CR 1.

**Question 2: is D4's error mapping complete for the JSON and multipart submit paths?**

- **Both paths reach `PanelService.submitForm`.**
  - JSON: `PanelRoutes.scala:132-139`.
  - Multipart: `submitFormMultipartRoute`, `:150-163`.
  - Both complete through the shared `completeSubmit` (`:43-53`).
- **The multipart path has a second disclosure source.** `PanelFormFileSubmission.submitFormWithFiles` runs a pre-lock `FormSubmission.buildRow` against the **whole** declaration (`:51-55`) and returns `FormSubmitError.fromFieldErrors`.
- **What that means for D4:** a mapping applied to `submitForm`'s combined result covers both paths. A mapping applied only inside the JSON branch, or only to `appendFormRow`'s result, misses the pre-lock file-path errors. D4 ("the mapping lives in `PanelService`") does not say which. Task 2.1 tests the disclosure filter without naming the multipart path. That is CR 2.
- **The row-limit error is untyped when it reaches `PanelService`.** `appendFormRow` (`DataSourceService.scala:873-874`) collapses the typed `FormRowBuildFailure.RowLimitExceeded(msg)` into a plain `FormSubmitError(ServiceError.BadRequest(msg))`. `PanelService` would therefore have to string-match "Payload exceeds the maximum of" to apply D4's row-limit rewrite. That is CR 3.
- **No other refusal paths disclose anything:**
  - not-found → "Data source not found";
  - non-dataset → "row writes are only supported for dataset sources";
  - storage failure → failed future;
  - a malformed multipart `values` part → parse exception.
- **The client sends only `{sourceField: delta}` for a counter** (`FormPanelView.tsx:217`), never `value`. So the Risks note on `value` pass-through concerns direct API use only. That is accurate.

**Other checks**

- **`computeFormIssues` has callers outside `FormPanelView`.**
  - `formSubmission.ts:112, 167, 212, 247` call it too: `validateForSubmit`, `buildSubmitValues`, `buildSubmitFiles`, and the summary helper.
  - A form with 2+ fields that include a counter uses the stacked layout (`FormPanelView.tsx:345-349`). Its submit goes through those helpers.
  - D6 says only "`computeFormIssues` skips `checkCounterRowShape`".
  - The function lives in `formConfigValidation.ts`, but C18 limits frontend edits to `FormRenderer.tsx`, `FormPanelView.tsx`, `panelService.ts` and tests. That is CR 5.
- **Things I confirmed:**
  - `authorizeEditorOnDashboard` (`PanelService.scala:315-323`) is reusable as D1 says.
  - `submitForm`'s current owner-only check is at `:122-123`.
  - `appendFormRow`'s signature and audit are at `:859-878`, matching the D2 and D4 starting points.

### Verdict: REFUTE

### Change Requests

1. **D6's counter safety claim is false. Close the silent-write state it hides.**
   - **The problem:** `FormSubmission.buildRow` does not re-check the counter row shape. With `occurred_at` renamed, dropped or retyped to text (all allowed by `updateDatasetSchema`, which never re-validates forms), a non-owner's `+` returns `201` and writes counter events with no usable timestamp. Neither user is told. The owner's view is disabled at the same moment.
   - **Required:** pick one of these and write it into D6, D4 and the `form-panel-submit` spec:
     - (a) The submit path enforces the counter row shape under the lock. When the config has a counter field, `buildRow` (or the `build` closure) runs `FormSchemaConsistency`'s counter check against the locked declaration and rejects it. For a non-owner, D4 maps the rejection to "This form no longer matches its dataset…". This also changes the owner's direct-API behavior from silent success to `400`, so state that.
     - (b) The form-schema route returns a server-computed, declaration-free readiness signal, and the client disables the non-owner counter on it. If you choose (b), say why it stays within ruling 2 (it is not a declaration).
   - **Fix the text:** correct D6 lines 181-182.
   - **Tests:** add a route test (task 2.1) in which the owner renames `occurred_at` after configuring a counter form, and an editor's `+` then writes nothing and gets the generic message (under (a)) or is disabled (under (b)). It must be red first.
2. **State D4's mapping point for both submit paths and test the multipart one.**
   - **Required wording:** D4 "Where" must say the non-owner mapping wraps the result of **both** `submitForm` branches. That includes `PanelFormFileSubmission.submitFormWithFiles`'s pre-lock `buildRow` `Left` (`PanelFormFileSubmission.scala:54-55`), which validates against the whole declaration before any lock.
   - **Required test:** task 2.1 must include a multipart (file-attached) submit by an editor against a dataset with an unconfigured required field. Assert that the `400` neither names that field nor stores a file.
3. **Make the row-limit refusal typed. Do not string-match it.**
   - **The problem:** `appendFormRow` turns `FormRowBuildFailure.RowLimitExceeded` into an untyped `BadRequest(msg)` (`DataSourceService.scala:873-874`). D4's rewrite in `PanelService` therefore has nothing to match on except the message text.
   - **Required:** D4 must say how the case is identified. Either:
     - `FormSubmitError` gains a discriminator (for example a `rowLimit: Boolean` or a reason ADT) set by `appendFormRow`; or
     - the rewrite moves into `appendFormRow`, which now receives both `writer` and `sourceOwner`.
   - **Also:** say whether "row writes are only supported for dataset sources" is rewritten for a non-owner. It is low risk, but D4 should list it.
4. **Correct the stale proposal.md line.** "A viewer (named or public) gets `403`" contradicts D1 and both spec requirements, where public visibility alone gives `404`. Change it to "a named viewer gets `403`; a signed-in user with no named grant (including on a public dashboard) gets `404`".
5. **Name every `computeFormIssues` call site, and fix C18's file allowlist to match.**
   - **The problem:** skipping `checkCounterRowShape` for non-owners has to reach:
     - `formConfigValidation.ts`, where the function lives;
     - all four call sites in `formSubmission.ts` (`:112, 167, 212, 247`), not only `FormPanelView`.
     Otherwise a stacked form (2+ fields including a counter) is still blocked for an editor.
   - **Required:**
     - D6 and C18 must list both files.
     - Choose and name the mechanism (for example a `{ skipCounterRowShape }` option, or a non-owner variant).
     - Task 5.1 must add a jest case for a non-owner stacked form with a counter plus a text field, fed the route fixture, that submits.

### Non-blocking notes

- **Misleading message for an unknown key.** A non-owner's request with a key that is not part of the form gets `FieldError(k, "not part of this form")` (`FormSubmission.scala:75`), which D4's filter rewrites to "This form no longer matches its dataset". That message is misleading for a malformed client request, but it discloses nothing. Consider filtering only names that the declaration contains.
- **The editor's own retry loop.** Under CR 1(a), an editor clicking `+` repeatedly would get the generic error and a rollback on every click. That is acceptable, but the e2e could assert that the announced text is the generic one.
- **Gate defect check (mtime evidence):** not applicable. No evidence directory or mtime-ordering claim is involved.

## Context

Verified on `a1cfd19dc`:

- `PanelService.submitForm` refuses any caller whose id is not `panel.ownerId` (`403 "Only this form's owner can submit
  to its data source"`). HEL-1084 checks at config time that the configuring user owns the bound source, and only the
  source's owner can change a form's fields (`FormBindingValidator`). But a duplicate or import copies the binding
  verbatim while setting `ownerId` to the acting user, so "panel owner = source owner" is **not** an invariant. D2
  fences the mismatched case.
- `DataSourceService.appendFormRow` runs `findByIdOwned(id, user)` and `DataSourceRepository.appendBuiltRow(..., user)`,
  both in `ctx.withUserContext(user.id)` on the app pool (RLS evaluated). `dataset_rows` RLS (V106) admits only the
  source's owner (`data_sources.owner_id = app.current_user_id`). So an editor's own context cannot read or write the
  owner's rows, and must not be made to.
- The file path (`PanelFormFileSubmission.submitFormWithFiles`) reads `getDeclaredSchema(id, user)` in the caller's
  context, then calls the same `appendFormRow`.
- `appendFormRow` then calls `AutoRunTriggerService.triggerAutoRun(id, user, now)`. That upserts
  `pipeline_auto_run_debounce` in **system** context (`PipelineAutoRunDebounceRepository.upsertDebounce`) and computes
  the denied-pipeline list relative to the **writer** (HEL-1096 D1: what the writer may see). The debounce row does not
  record who wrote. When it fires, `PipelineAutoRunDebounceFirer.submitAutoRun` submits as the pipeline owner
  (`AuditSource.System`), and `PipelineRunService.submit` stores `triggered_by_user_id = Some(user.id)`, which is the
  owner.
- HEL-1492 attributes an editor's manual run by storing `pipeline_runs.triggered_by_user_id = editor` while the run is
  counted against the owner. It is never exposed in any API response.
- Frontend: `FormRenderer` (HEL-1773) renders "Only the owner can submit this form" for every role but `owner`.
  `FormPanelView` calls `GET /api/data-sources/:id/schema` on mount, and for a counter field it calls
  `GET /api/data-sources/:id/rows/aggregate` once a click burst settles. Both are owner-only.
- `computeFormIssues` checks the form's configured fields against the declarations, and for a `counter` field it
  also runs `checkCounterRowShape` (`formConfigValidation.ts:177-230`). That check requires `occurred_at` (and a
  numeric, non-required `value`) in the schema. A schema filtered to the configured fields omits both, so the check
  would disable every non-owner counter (`FormFieldControl.tsx:70`). D6 handles this.
- `requireAccess("dashboard", …)` for a signed-in non-owner matches only a named grant (`findGrant`); with no named
  grant it returns `404 Dashboard not found`, even when the dashboard is public. `panelRepo.findById` does return a
  public dashboard's panel.
- A real run, the auto-run included, stores its submitter through `PipelineRunExecutor.executeRun`
  (`submitterId = Some(user.id)`, `:119-121, 179, 182`) into `insertRunIfUnderConcurrencyCap` /
  `insertGranteeRunIfUnderOwnerCap`. `PipelineRunService.insertRun` is only `recordUnrunnable`.
- `FormSubmission.buildRow` validates against the WHOLE declaration, so a `400`'s `fieldErrors` can name a declared
  field the form does not configure. The row-limit `400` says "Payload exceeds the maximum of N rows".
- `docs/user-reference-inventory.md` lists every FK to `users`, and `V119OwnerFkMigrationSpec` compares it to the
  migrated database.

Owner rulings (escalation `HEL-1784-1795077466035-790706`, answered by a human in chat):

1. A non-owner editor's counter shows `+`/`-` and a local tally of their own clicks, with no aggregate read.
2. A new per-panel route returns only the declarations of the fields the form binds. It re-checks dashboard edit
   access per panel, answers `404` to strangers, and is proven under RLS as the NOBYPASSRLS role. We read "the fields
   the form binds" strictly, as the form's configured `sourceField`s. `occurred_at`/`value`, which a counter submit
   writes server-side, are NOT returned (D6 covers how the client copes).
3. A non-owner submitter's response carries no `seq`.

## Goals / Non-Goals

**Goals:** dashboard editors (and the dashboard owner, for a form an editor created) can submit forms. Viewers and
strangers are refused. The editor learns nothing about the dataset beyond the bound fields' declarations and their own
row's `id`/`updatedAt`. RLS bounds the write, proven as `helio_app` (the NOBYPASSRLS test role). Attribution:
submitter → audit, pipeline owner → run accounting, submitter → `triggered_by_user_id`.

**Non-Goals:** any read of dataset rows or aggregates by a non-owner. Exposing `triggered_by_user_id` in an API. Public
or share-token submits. Changing who may *configure* a form (HEL-1084 is unchanged). Changing the panel card, role or
`PanelDetailModal` files the in-flight HEL-1780 lane owns.

## Decisions

### D1. Authorization: dashboard access, re-checked on every request

`submitForm` and the new schema route both do the following:

1. Resolve the panel with `panelRepo.findById(panelId, Some(user))`. If it is not visible → `404 Panel not found`.
2. If it is not a `FormPanel` → `400`.
3. Call `accessChecker.requireAccess("dashboard", panel.dashboardId, Some(user), "Dashboard not found")`. `Viewer` →
   `403 DashboardAccessMessages.ViewOnly`. `Left` → that error. `Owner | Editor` → proceed.

This is the existing `authorizeEditorOnDashboard` helper, reused rather than copied. The `panel.ownerId != user.id`
check is removed. Responses: a named viewer → `403 ViewOnly`. A signed-in user with no named grant → `404`. That
includes a public dashboard: `findById` returns the panel through the public predicate, but `requireAccess` then
answers `404 Dashboard not found`, because for a signed-in caller it matches named grants only. `AccessChecker` is
NOT changed; doing so would affect every panel-mutation route. Authorization and the write are separate transactions,
so a grant revoked within that window of a few milliseconds is not honored for that one request. This is the same as
every other panel mutation.

### D2. The write runs in the FORM OWNER's database context on the app pool (owner context, not HEL-1503 system context)

`appendFormRow` gains a `sourceOwner: UserId` parameter, which is `panel.ownerId`, kept separate from `writer`, the
caller. The source lookup and the append run as `withUserContext(sourceOwner)`: `findByIdOwned(id, ownerPrincipal)`
and `appendBuiltRow(..., ownerPrincipal)`, where `ownerPrincipal = AuthenticatedUser(sourceOwner, source = writer.source,
tokenId = None)` is used only for DB context. The file path's pre-lock `getDeclaredSchema` uses the same principal.

**Why owner context and not HEL-1503's system context.** HEL-1503 D2 read the owner's source on the privileged pool
with an explicit `owner_id` filter, "without impersonating the owner's session". That fits a read whose ACL was already
decided, but here it would be the weaker guarantee. On the privileged pool, nothing in the database stops a write to
any source: the only fence is application code getting the `id`/`owner_id` pair right, and the AC requires
"RLS checked as `helio_app`". In owner context on the app pool, the V106 `dataset_rows` policy and the V35
`data_sources` policy still evaluate. If the panel's `dataSourceId` ever pointed at a source the form owner does not own
(a stale binding, an ownership change, a bug), the write finds no source and writes nothing (`404`).

The cost is that `app.current_user_id` names a user other than the HTTP caller for one transaction. That is acceptable
for three reasons:

- authorization (D1) has already been decided on the caller;
- `SET LOCAL` scopes the setting to that transaction (`DbContext`);
- the actor in the audit event is still the caller (D4).

No other request-path code is changed to run as another user. This is the only owner-context call, and it carries a
comment that names this decision.

### D3. New `GET /api/panels/:id/form-schema`

D1's authorization applies. The service then:

1. reads `getDeclaredSchema(panel.config.dataSourceId, ownerPrincipal)` in owner context. If the source is gone →
   `404 Data source not found`;
2. filters to declarations whose `name` is one of `panel.config.fields.map(_.sourceField)`, keeping the declared order;
3. responds `200 {"fields": [...]}`. Each item is the same declaration JSON `GET /api/data-sources/:id/schema` emits.

No `dataset_rows` query runs. New contract: `schemas/panels/form-schema-response.schema.json`. The route lives in
`PanelRoutes` next to the submit route, under the same authenticated tree and the same `confineScopedToken`.

### D4. Response `seq` and attribution

- **`seq`.** The submit route keeps `RowWriteResponse` for a submitter who is the form owner (`writer.id ==
  panel.ownerId`). For anyone else it emits the same object with `seq` omitted from each row. A new
  `schemas/panels/form-submit-response.schema.json` documents `seq` as optional for this route only. The shared
  `schemas/sources/row-write-row-response.schema.json` used by `/api/data-sources/:id/rows` is unchanged.
- **Audit.** The existing `audit("data_source.rows.append", ..., user, {panelId})` call keeps the writer as `user`. Its
  metadata also gains `"sourceOwnerId"`. `dataset_rows` gains no author column: owner rows have none either, and adding
  one would change the row read API.
- **Response type.** A new `FormSubmitResponse(rows: Vector[FormSubmitRowResponse], updatedAt, deniedPipelines)` with
  `FormSubmitRowResponse(id, seq: Option[Long], updatedAt)`, where spray-json omits `None`. It is used only by
  `PanelRoutes`'s submit routes (JSON and multipart). `RowWriteResponse` and the shared row schema are unchanged.
- **Error messages to a non-owner** (owner submitter: unchanged).
  - **`fieldErrors`:** any entry whose `field` is not one of the form's configured `sourceField`s is removed. If any
    were removed, the response's `message` becomes "This form no longer matches its dataset. Ask its owner to update
    it." Entries for configured fields are kept as they are, since they name only bound fields.
  - **Row limit:** the `400` message becomes "This form's dataset can't accept more entries", with no number. A refusal
    necessarily reveals that the dataset is full; the cap's value is withheld.
  - **Not-found:** the source-not-found `404` stays "Data source not found" (no detail).
  - **Filter rule, independent of the declaration:** for a non-owner, EVERY field error whose `field` is not one of the
    form's configured `sourceField`s is dropped. That includes `"not part of this form"` request-key errors and D4a's
    `occurred_at`/`value` errors. When any error is dropped, the message is the generic one. The mapping therefore
    needs only the configured names, so a non-owner cannot probe which names the dataset declares: a declared-but-
    unconfigured extra key and an undeclared extra key produce byte-equal `400` bodies.
  - **Wrong source kind:** a non-owner gets the generic message instead of "row writes are only supported for dataset
    sources".
  - **Typed, not string-matched:** `FormSubmitError` gains a `reason` discriminator
    (`FieldErrors | RowLimit | SourceKind | Other`), set where each failure is produced: `appendFormRow` for
    `RowLimitExceeded` and the kind check, and both `buildRow` call sites for field errors.
  - **Where:** the non-owner mapping is one function in `PanelService`. It wraps the result of BOTH `submitForm`
    branches: the plain-JSON `appendFormRow` path, and `PanelFormFileSubmission.submitFormWithFiles`, including its
    pre-lock `buildRow` `Left` (`:54-55`), which validates against the whole declaration before any file is stored.
    It needs only the configured `sourceField`s (from the panel) and the writer. `reason` is assigned at every
    failure: `FieldErrors` (both `buildRow` passes), `RowLimit` and `SourceKind` (`appendFormRow`), and `Other` for
    every `NotFound` (source gone, unbound binding, panel gone).
- **D4a. Counter row shape enforced under the lock.** When the form config has a `counter` field,
  `FormSubmission.buildRow` itself runs `FormSchemaConsistency`'s counter row-shape check (through a new public
  wrapper over the private `checkCounterRowShape`) against the declaration it is given. Putting it inside `buildRow`
  means one edit covers the JSON closure, the file path's in-lock closure and its pre-lock pass, and the in-lock call
  receives the LOCKED declaration. The enforced shape is exactly the configure-time rule (`FormSchemaConsistency.scala:49-62`,
  `formConfigValidation.ts:196-227`): a field named `occurred_at` of type `timestamp` AND a field named `value` that is
  numeric and not required. The shape error is APPENDED to `buildRow`'s
  collected errors (no short-circuit), so an owner with both a bad `delta` and a broken shape sees both;
  `FormSubmissionSpec` asserts this. On failure it returns a field error (reason `FieldErrors`, naming `occurred_at`/`value`), so nothing is
  written. Today `buildRow` does not run this check, so a counter form whose dataset dropped, renamed or retyped
  `occurred_at` (allowed by `updateDatasetSchema`) silently writes rows with no usable timestamp. This adds that check
  for every submitter. **Behavior change:** the owner's direct-API submit to such a form goes from `201` to `400`. The
  owner's UI already disables that control, so no UI flow changes. A non-owner gets D4's generic message, because
  `occurred_at`/`value` are not configured fields.
- **Denied pipelines.** `triggerAutoRun(id, writer, now)` keeps the writer. The returned denied list is already
  writer-relative (HEL-1096 D1): an editor with no pipeline grant learns of no pipeline.

### D5. Auto-run trigger attribution: Flyway V146

```sql
ALTER TABLE pipeline_auto_run_debounce
  ADD COLUMN triggered_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;
```

- `upsertDebounce(pipelineId, fireAt, writer: UserId)` sets the column on insert and on conflict (`= EXCLUDED`). The
  last writer wins, consistent with the write-generation semantics of the coalesced debounce (HEL-1739). Every caller
  passes its writer.
- `claimDue`'s `RETURNING` gains `triggered_by_user_id`, and its return type carries `Option[UserId]` per claimed
  pipeline. `submitAutoRun` passes it to `PipelineRunService.submit` through a new
  `triggeredByUserId: Option[UserId] = None` parameter. That parameter is threaded `submit` → `runPipeline` →
  `PipelineRunExecutor.executeRun`, where it replaces ONLY the stored `submitterId`
  (`triggeredByUserId.orElse(Some(user.id))`). `ownerRun`, the owner-cap admission choice, rate windows and every
  authorization still key on the acting `user`, who is the owner. `recordUnrunnable`'s `insertRun` gets the same
  override. A NULL column falls back to the owner. That covers a row written before V146, and is the behavior every
  existing caller gets today.
- The writer is read at claim time, not at the HEL-1739 generation snapshot. A write landing between the claim and the
  snapshot may be consumed by the run and attributed to the earlier writer. The column is never exposed, and the window
  is one tick, so this is accepted.
- `upsertDebounce`'s `writer` parameter has NO default, so a production caller cannot silently omit it. Test callers
  are updated.
- `docs/user-reference-inventory.md` gains the row `| pipeline_auto_run_debounce | triggered_by_user_id | SET NULL |` in
  sorted position, plus a sentence in the SET NULL note, as V124 did for `pipeline_runs`.
- The run is still submitted as the pipeline owner, so the HEL-505 guard, rate window, concurrency cap and run history
  are all the owner's. That is unchanged.
- `write_generation`, `guard_retry_count` and the HEL-1504 re-arm path are untouched. Re-arming keeps the stored
  writer.

### D6. Frontend

- `FormRenderer`: render `FormPanelView` when `role` is `owner` or `editor`. For `viewer`, the status text becomes
  "Only editors can submit this form". `FormRenderer.roles.test.tsx` is updated: viewer only, editor now sees the form.
- `FormPanelView` gains `isFormOwner = panel.ownerId === currentUser.id`. The prop comes from `FormRenderer`; the
  current user comes from the existing auth selector.
  - `isFormOwner`: unchanged, using `fetchDatasetSchema`/`fetchFieldAggregate`.
  - Otherwise: the schema comes from a new `fetchFormSchema(panelId)` in `panelService.ts`. The counter's
    `reconciliationTail` is skipped (no aggregate request), and `computeFormIssues(config, schema, { skipCounterRowShape: true })` skips `checkCounterRowShape`. The option is added
    in `formConfigValidation.ts` and threaded through all four `computeFormIssues` call sites in `formSubmission.ts`
    (`:112, 167, 212, 247`), so stacked forms (a counter plus other fields) also submit for a non-owner. The default is
    `false`, so the owner and every other caller are unchanged. The filtered schema has no `occurred_at`/`value`; the
    server enforces the counter row shape under the lock (D4a), so a misconfigured dataset is refused there and
    surfaces as D4's generic message, never as a silent write. A definite rejection rolls back that click's delta, as
    today. An indeterminate failure leaves the tally and announces "Couldn't confirm the current value. It may not be up
    to date.", the existing string.
  - An unknown `ownerId` (absent) is treated as not the owner, which fails closed on reads. The panel list emits
    `ownerId` only to the dashboard owner and the panel's creator (`PublicPanelListResolver`, HEL-1197/1216), so an
    editor never has it, and the form's owner always does. The current user is `state.auth.currentUser.id`.
- Files touched: `FormRenderer.tsx`, `FormPanelView.tsx`, `panelService.ts` (and the `panel.ts` type only if a new
  response type is needed there), plus their tests. None of the HEL-1780 files.

### D7. Tests (red first)

- **Backend unit/route.** Editor `201` with no `seq`. Owner `201` with `seq`. Viewer `403` ViewOnly. Stranger `404`.
  Editor downgraded to viewer → `403` on the next submit. Dashboard owner submits an editor-created form → the row lands
  on the editor's source. Form-schema route: filtering, `403`/`404`/`400`. Audit actor and `panelId`. Signed-in stranger on a PUBLIC dashboard → `404` (submit and form-schema). Non-owner
  `fieldErrors` naming an unconfigured required field → filtered, with the generic message. Byte-equal probe: a
  declared-but-unconfigured extra key and an undeclared extra key give identical `400` bodies. A counter form whose
  dataset renamed `occurred_at`, or dropped `value` → `400` (generic for the editor, precise for the owner). Non-owner row-limit
  message has no number. Mismatched binding: B duplicates A's form, so `panel.ownerId = B` with A's source, and B's
  submit → `404` with nothing written.
- **RLS spec (NOBYPASSRLS `helio_app_test` two-role harness, as in `PipelineRunServiceUpsertSourceRlsSpec`).**
  - An editor submit through the real service lands one row.
  - The same `appendBuiltRow` in the editor's context writes nothing.
  - The form-schema read in owner context returns declarations; in the editor's context it returns nothing.
  - The debounce row stores the editor, and a fired auto-run's `pipeline_runs` row has `triggered_by_user_id = editor`
    and is counted by `countOwnerInFlightRealRunsInternal(owner)`.
- **Frontend jest.** Editor sees the form. A non-owner compact counter fed the exact JSON the real form-schema route
  returns (a fixture captured from the route spec, not a hand-built schema) is enabled and `+` submits. Viewer sees the status. A non-owner counter makes no `/api/data-sources/*`
  request. The owner counter still reconciles.
- **e2e** (`e2e/hel1784-editor-form-submit.spec.ts`): owner, editor, viewer and stranger, each with a real lane DB.
  - Editor submits through the UI, and the row is verified via the owner's API.
  - An editor's compact counter is enabled, and `+` lands a row.
  - Viewer sees no submit control, and a direct POST gets `403`.
  - Stranger gets "Dashboard not found", and a direct POST gets `404`.
  - No `/api/data-sources/*` request is made from the editor's page.

## Risks / Trade-offs

- **Owner-context DB session for a non-owner caller (D2).** Mitigation: authorization is decided before it, it is one
  transaction, and it has the comment D2 requires. The RLS spec proves the bound.
- **A non-owner's counter shows a session-local tally, not the dataset total.** This is the owner's ruling. An owner who
  wants editors to see the total can add an Output panel for it.
- **`seq` removal is per-caller,** so a client must not depend on `seq` from this route. The web client does not read
  it (to be confirmed by grep in tasks).
- **Counter `value` pass-through.** Editors can now write an arbitrary number into a declared `value` field. This is
  pre-existing, documented as non-authoritative, and never read back by the server; it is now reachable by editors,
  which the owner's ruling (editors may submit) accepts.
- **Migration ordering.** V146 is reserved for this lane (driver-confirmed). The shared dev DB is not touched; the lane
  uses `helio_hel1784`.
- **HEL-1780 overlap.** It is none by file, but HEL-1780 may also edit the role tests' helpers (`renderWithStore`). If a
  merge conflict appears there, rebase onto whichever lands first.

## 1. Groundwork

- [x] 1.1 Use `AuditSource.Ui` uniformly at every call site in this ticket (design.md Decision 3 —
      a documented, known-wrong-for-PAT/MCP placeholder pending the attribution ticket; do not
      invent a new `AuditSource` member).
- [x] 1.2 Build a shared test fixture: a stub/no-op `AuditService` (or a real one backed by an
      in-memory/failing repo) for reuse across every service spec touched below, so constructor
      signature changes don't require bespoke stubbing per file.

## 2. Dashboards

- [x] 2.1 Wire `AuditService` into `DashboardService`; call `record` on `create`, `update`,
      `delete` with actions `dashboard.create`/`dashboard.update`/`dashboard.delete`.
- [x] 2.2 `DashboardService.duplicate` does NOT route through `create` (verified,
      DashboardService.scala:116-129) — add its own call site emitting exactly one
      `dashboard.duplicate` (resource id = new dashboard's id, metadata records source dashboard
      id); do not additionally emit `panel.create` for the copied panels (design.md Decision 7).
- [x] 2.3 Update existing `DashboardService`/`DashboardServiceValidation` specs for the new
      constructor param.
- [x] 2.4 `DashboardService.create` returns `Future[(Dashboard, Boolean)]`, not `Either` — fire
      `dashboard.create` only when the returned `created` flag is `true`; the `ifExists = "return"`
      match returning an existing dashboard (`created = false`) writes no audit row (design.md
      Decision 2).
- [x] 2.5 Wire `AuditService` into `DashboardService.importSnapshot` (`:231`); emit one
      `dashboard.import` event (not `dashboard.create`), `resource_id` = new dashboard id,
      `metadata` carrying the imported panel count — no per-panel events (design.md Decision 9).
- [x] 2.6 Wire `AuditService` into `DashboardContentsService.replaceContents` (its only public
      method); emit one `dashboard.contents.replace` event, `resource_id` = the dashboard id,
      `metadata` carrying the new panel count — no per-panel events (design.md Decision 9).
- [x] 2.7 Wire `AuditService` into `AutoLayoutService.autoLayout`; emit one `dashboard.update`
      event on success (design.md Decision 9 — layout is a dashboard-owned field, reuses the
      existing action rather than inventing a new one).

## 3. Panels

- [x] 3.1 Wire `AuditService` into the panel-mutating service; call `record` on
      create/update/delete with actions `panel.create`/`panel.update`/`panel.delete`.
- [x] 3.2 Check whether panel `duplicate` routes through `create` or is its own repository call
      (same question as 2.2); if standalone, emit one `panel.duplicate` per design.md Decision 7 —
      no extra events for anything it copies.
- [x] 3.3 Dashboard `delete` cascades panel deletion at the DB level — do NOT emit a separate
      `panel.delete` per cascaded panel; only the single `dashboard.delete` call site fires
      (design.md Decision 7).
- [x] 3.4 Wire `AuditService` into `PanelService.batchCreate` (`:379`) and `batchUpdate` (`:315`);
      emit one `panel.batch_create`/`panel.batch_update` event per call (not one per panel),
      `metadata` carrying the panel count and ids (design.md Decision 9).
- [x] 3.5 Wire `AuditService` into `BoundPanelService.create` (`:50`); emit one `panel.create`
      event on success, `resource_id` = the resulting panel's id — same action as 3.1's plain
      create, since the underlying data source/pipeline creation this wizard performs is not a
      separately-audited resource creation (design.md Decision 9).

## 4. Pipelines (+ steps/runs)

- [x] 4.1 Wire `AuditService` into the pipeline service; call `record` on pipeline
      create/update/delete (`pipeline.create`/`pipeline.update`/`pipeline.delete`).
- [x] 4.2 Call `record` on pipeline step create/update/delete
      (`pipeline.step.create`/`.update`/`.delete`).
- [x] 4.3 Call `record` on run submission (`pipeline.run.submit`) only — not on every run status
      transition (design.md Decision 5).
- [x] 4.4 Call `record` on schedule create/update/delete if in scope of the service's public
      mutation surface (`GET/PUT/DELETE /api/pipelines/:id/schedule` — `PUT` upserts).

## 5. Data sources & data types

- [x] 5.1 Wire `AuditService` into `DataSourceService`; call `record` with `data_source.create` on
      every create variant (`createStatic`, `createCsv`, `createTextUpload`, `createTextUrl`,
      `createPdfUpload`, `createPdfUrl`, `createImageUpload`, `createImageUrl`), `data_source.update`
      on `update`, and `data_source.delete` on `delete` (design.md Decision 8 — full enumeration,
      not a grep-discovered subset).
- [x] 5.2 Wire `AuditService` into `SourceService`; call `record` with `data_source.create` on
      `createSql` and `createRest` — both produce the same `DataSource` domain type as 5.1's
      methods via `CreateSourceResponse`, so no separate `source.create` action (design.md
      Decision 8, resolved).
- [x] 5.3 Wire `AuditService` into the data-type service; call `record` on update/delete
      (`data_type.update`/`.delete`) only — data types are never created directly by a user via the
      current routes (`GET/PATCH/DELETE /api/types/:id`), so no `data_type.create` action.
- [x] 5.4 Wire `AuditService` into `ImageUploadService.upload` (`:48`); emit `image_upload.create`
      on success, `resource_id` = the resulting `ImageUploadId` — NOT `data_source.create`;
      `ImageUpload` has no data source id and never touches `DataSourceService` (design.md
      Decision 9, corrected round 3).

## 6. Auth & tokens

- [x] 6.1 Wire `AuditService` into `AuthService`; call `record` on `register` success
      (`auth.register`); on `login`: `Right(SessionEstablished)` → `auth.login`,
      `Right(MfaRequired)` → `auth.login.challenged`, `Left(...)` → `auth.login.failed` (metadata:
      attempted identifier only, never a password — design.md Decision 6); on `logout` →
      `auth.logout`, binding the actor from `userRepo.findSession(token)` (currently discarded as
      `case Some(_) =>`) rather than writing a null-actor row.
- [x] 6.2 Wire `AuditService` into `MfaService.verifyLogin`; the `establishSession` success path →
      `auth.login` (this, not 6.1's `auth.login.challenged`, is the actual session-establishing
      event for an MFA-enrolled user); the `recordFailedAttempt`/failure path → `auth.login.failed`
      (design.md Decision 6).
- [x] 6.3 Wire `AuditService` into `ApiTokenService`; call `record` on `create` (`token.create`)
      and `revoke` (`token.revoke`).
- [x] 6.4 Locate `OAuthRoutes`'s backing `completeOAuth` call site (applies the same `LoginOutcome`
      gate per design.md Decision 6, verified) and instrument it with the identical
      `auth.login`/`auth.login.challenged`/`auth.login.failed` split as 6.1, unless it already
      routes through `AuthService.login` itself.

## 6a. Patch-set apply/undo and proposal apply fan-out

- [x] 6a.1 `PatchSetApplyForward.applyOne` and `PatchSetUndoService.undo` call the already-
      instrumented `panelService`/`dashboardService`/`dataSourceService`/`dataTypeService`/
      `pipelineService` methods per edit — no additional wiring needed; N audit rows per apply/undo
      call is the accepted, ruled-on behavior (design.md Decision 10). Confirm no double-counting
      (i.e. these fan-out call sites do not also wrap the whole apply/undo in its own top-level
      event).
- [x] 6a.2 Add `DashboardService.deleteInternal(dashboardId, user): Future[Either[ServiceError,
      Unit]]` — identical to the public `delete` but never calls `AuditService.record`; doc-comment
      it "rollback-only, do not call from a route." Update `DashboardProposalService.createAll`'s
      rollback branch (`:93`) to call `deleteInternal` instead of `delete`, so a failed proposal
      apply does not write a false `dashboard.delete` row for a dashboard that was never
      successfully created (design.md Decision 10).
- [x] 6a.3 `DashboardProposalService.apply`'s successful path (`dashboardService.create` +
      `panelService.create`/`.update` per panel) needs no special handling beyond what §2/§3
      already wire — each call already emits its own row via the normal instrumented methods.

## 6b. MFA lifecycle

- [x] 6b.1 Wire `AuditService` into `MfaService.confirmEnrollment` (`:75`); emit `auth.mfa.enable`
      on success (design.md Decision 11).
- [x] 6b.2 Wire `AuditService` into `MfaService.disable` (`:88`); emit `auth.mfa.disable` on
      success (design.md Decision 11).
- [x] 6b.3 Wire `AuditService` into `MfaService.regenerateBackupCodes` (`:85`); emit
      `auth.mfa.backup_codes.regenerate` on success (design.md Decision 11).
- [x] 6b.4 `MfaService.startEnrollment` (`:49`) is explicitly out of scope — no audit call
      (design.md Decision 11); confirm this is a deliberate no-op, not an oversight, in the
      completion notes.

## 7. Wiring & verification

- [x] 7.1 Update `Main.scala` constructor calls for every touched service to pass `auditService`.
- [x] 7.2 Integration tests (route testkit + real/embedded audit repo) asserting exactly one audit
      row per mutation across every resource type above, per acceptance criteria.
- [x] 7.3 Integration test: failed login writes `auth.login.failed` with no plaintext
      password/secret in `metadata`.
- [x] 7.4 Integration test: a failing/stubbed `AuditService` does not fail the underlying mutation
      request (per spec's "audit write never changes the outcome" requirement).
- [x] 7.5 Exhaustive route-file audit: enumerate every `post`/`put`/`patch`/`delete` directive
      under `backend/src/main/scala/com/helio/api/routes/` and record, for each, either the audit
      action it maps to (per §2-6/design.md Decisions 7-9) or an explicit reason it is out of
      scope (e.g. a read-only-adjacent endpoint, or scope explicitly excluded by the ticket). This
      is the completion check for the whole change — a route with neither an action nor a stated
      reason is a gap, full stop.
- [x] 7.6 Integration tests: `dashboard.duplicate` and `dashboard.delete` (with panels) each write
      exactly one audit row, not one-per-copied/cascaded-panel (design.md Decision 7).
- [x] 7.7 Integration test: an MFA-enrolled login writes `auth.login.challenged` at the initial
      `AuthService.login` call and `auth.login` (not a duplicate `auth.login.challenged`) once
      `MfaService.verifyLogin` succeeds (design.md Decision 6).
- [x] 7.8 Integration tests: `panel.batch_create`/`panel.batch_update` each write exactly one
      audit row per call regardless of panel count; `dashboard.import` and
      `dashboard.contents.replace` each write exactly one row (design.md Decision 9).
- [x] 7.9 Integration test: a proposal apply that fails partway through panel creation rolls back
      via `deleteInternal` and writes `dashboard.create` but NOT `dashboard.delete` for the rolled-
      back dashboard (design.md Decision 10).
- [x] 7.10 `sbt compile test` green.

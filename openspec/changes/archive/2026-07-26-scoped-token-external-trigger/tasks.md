## 1. Backend — migration + domain

- [x] 1.1 Confirm `V74` is the next free Flyway version (re-check immediately before writing).
- [x] 1.2 Write `V74__api_token_scope_and_run_audit.sql`: nullable `api_tokens.scoped_pipeline_ids
      TEXT[]`; nullable `pipeline_runs.triggered_by_token_id UUID REFERENCES api_tokens(id) ON
      DELETE SET NULL`. No RLS-policy changes (existing owner-only policies unaffected).
- [x] 1.3 Add `TokenScope(tokenId: ApiTokenId, allowedPipelineIds: Set[String])` to
      `domain/model.scala`; add `scopedPipelineIds: Option[Set[String]] = None` to `ApiToken`.

## 2. Backend — token minting + scope resolution

- [x] 2.1 `ApiTokenRepository`: map the new `scoped_pipeline_ids` array column; add
      `findPrincipalByTokenHash(hash): Future[Option[(AuthenticatedUser, ApiTokenId,
      Option[Set[String]])]]` (privileged, mirrors `findUserByTokenHash` — leave that method and
      `resolveApiToken`/`authenticate` untouched).
- [x] 2.2 `CreateApiTokenRequest`/`ApiTokenResponse` (`ApiTokenProtocol.scala`): add
      `scopedPipelineIds: Option[Seq[String]]`; bump `jsonFormat` arities.
- [x] 2.3 `RequestValidation.validateCreateApiTokenRequest`: reject a present-but-empty
      `scopedPipelineIds`; reject blank ids.
- [x] 2.4 `ApiTokenService.create`: take a `PipelineRepository` dependency; when
      `scopedPipelineIds` is present, verify each id resolves to editor-or-owner access for the
      caller (owner check, or `findGrantRole(_, user) == Some("editor")` — NOT `findByIdShared`
      alone, which also admits viewer grantees who could never trigger a run anyway) and return
      `ServiceError.BadRequest` on the first miss; otherwise persist the allow-list. Wire the new
      dependency in `ApiRoutes.scala`.

## 3. Backend — scoped-auth enforcement

- [x] 3.1 `AuthDirectives`: add `findPrincipalByTokenHash`-backed `confineScopedToken:
      Directive1[Option[TokenScope]]` — if a `helio_session` cookie is present, `provide(None)`
      without inspecting the `Authorization` header (mirrors `resolveIdentity`'s existing
      session-over-header precedence); else if no `helio_pat_...` bearer header is present,
      `provide(None)`; else resolve via `findPrincipalByTokenHash` — unresolved or unscoped →
      `provide(None)` (let the branch's own `authenticate`/`optionalAuthenticate` handle it
      normally); resolved-and-scoped → check the first path **segment** of `extractUnmatchedPath`
      for exact equality to `"hooks"` (not a `startsWith`/prefix test — must reject `/hooksomething`
      too), `provide(Some(TokenScope(...)))` if it matches, else `complete(StatusCodes.Forbidden,
      ...)`.
- [x] 3.2 `ApiRoutes.scala`: wrap the **entire three-way `concat(...)`** under `pathPrefix("api")`
      (the `pathPrefix("auth")`, `optionalAuthenticate`, AND `authenticate` branches — verify no
      other branch exists before wiring) in `authDirectives.confineScopedToken { tokenScope => ... }`,
      placed between `requireCsrfHeader` and the `concat`. Pass the extracted `tokenScope` into the
      new `HookRoutes` inside the `authenticate` branch. Do NOT modify `authenticate`'s or
      `optionalAuthenticate`'s signatures — every other route class keeps taking bare
      `authenticatedUser`/`Option[AuthenticatedUser]` exactly as today.

## 4. Backend — run-lifecycle audit fields

- [x] 4.1 `PipelineRunRepository`: add `triggeredByTokenId: Option[String] = None` param to
      `insertRun`/`insertRunInternal`, persisted into the new column; map the column on read into
      `PipelineRunRow`. Add `findActiveRunInternal(pipelineId): Future[Option[PipelineRunRow]]`
      (same predicate as `hasActiveRunInternal`, returning the row instead of a boolean).
- [x] 4.2 `PipelineRunService.submit`/`executeRun`: add `triggeredByTokenId: Option[String] = None`
      param (default preserves every existing call site), thread into `insertRun`; add
      `runId: Option[String] = None` to `RunResultResponse`, populated from the generated `runId` in
      `executeRun`'s success/failure branches (`previewStep` leaves it `None`).
- [x] 4.3 `PipelineRunRecord`/`PipelineProtocol.scala`: add `triggeredByTokenId: Option[String]`;
      bump `jsonFormat8`→`jsonFormat9` (`PipelineRunRecord`) and `jsonFormat4`→`jsonFormat5`
      (`RunResultResponse`); thread the field through `PipelineRunService.history`.

## 5. Backend — hook trigger endpoint

- [x] 5.1 Add `HookTriggerResponse(runId: String, pipelineId: String, status: String)` +
      `HookRunRequest(pipelineId: String)` to a new `HookProtocol.scala`.
- [x] 5.2 New `HookTriggerService` (in `services/`): scope check (403 if `pipelineId` not in
      `tokenScope.allowedPipelineIds` when scope present) → `hasActiveRunInternal` check (return the
      in-flight run via `findActiveRunInternal` if true) → else
      `pipelineRunService.submit(pipelineId, isDry = false, user, triggerSource =
      TriggerSource.External, triggeredByTokenId = tokenScope.map(_.tokenId.value))`.
- [x] 5.3 New `HookRoutes` (in `api/routes/`) — `POST /api/hooks/run`; thin shell over
      `HookTriggerService`, following `PipelineRunSubmitRoutes`'s `ServiceResponse.run` pattern.
- [x] 5.4 Wire `HookTriggerService`/`HookRoutes` into `ApiRoutes.scala` (see task 3.2).

## 6. Schemas + openspec

- [x] 6.1 Update `schemas/create-api-token-request.schema.json` and `schemas/api-token.schema.json`
      for `scopedPipelineIds`.
- [x] 6.2 Add `schemas/hook-run-request.schema.json` / `schemas/hook-run-response.schema.json`.
- [x] 6.3 Update `schemas/pipeline-run-record.schema.json` for `triggeredByTokenId`.

## 7. Docs

- [x] 7.1 `docs/agent-native.md`: add a section covering minting a scoped token
      (`scopedPipelineIds`), the `POST /api/hooks/run` contract, and the known
      no-rate-limiting exposure — pointed at from the existing PAT section.

## 8. Tests

- [x] 8.1 `ApiTokenAuthSpec` (or a new spec): minting a scoped token, listing it, scoped token 403
      on an unrelated authenticated route (e.g. `GET /api/dashboards`), unscoped PAT still
      authorizes every route unchanged, session cookie + simultaneously-attached scoped-PAT header
      still resolves via the session (chokepoint doesn't interfere — mirrors the existing
      "prefer session cookie" test).
- [x] 8.2 **Required regression test — the specific bypass the design-gate skeptic found**: a scoped
      token (allow-listing some pipeline, unrelated to the dashboard under test) presented as
      `Authorization: Bearer` to `GET /api/dashboards/:id/panels` (the `optionalAuthenticate` /
      `PublicDashboardRoutes` branch) against a dashboard the token's owner legitimately owns MUST
      be rejected (403), not silently resolved to full owner access. This is the test that would
      have caught the round-1 gap; do not substitute a generic "unrelated route" test for it.
- [x] 8.3 New `HookRoutesSpec`/`HookTriggerServiceSpec`: unscoped-PAT trigger success + runId
      returned; scoped-PAT in-scope trigger success; scoped-PAT out-of-scope pipeline 403;
      missing/invalid/revoked token 401; pipeline the user cannot access 404; duplicate trigger
      while a run is in flight collapses to the existing runId (no second `pipeline_runs` row).
- [x] 8.4 `PipelineRunHistorySpec` (or existing pipeline-run spec): a run triggered via the hook
      records `triggerSource: "external"` and the triggering token's id, both visible via
      `GET /api/pipelines/:id/run-history`.
- [x] 8.5 Mint-time validation test: scoping a token to a pipeline the caller only has viewer access
      to (or no access to) returns `400 Bad Request` and does not create the token.
- [x] 8.6 Run `sbt test` (backend) and confirm the full suite is green before handoff.

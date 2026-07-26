## Context

`helio-news` points a full-access PAT at the MCP over stdio. `AuthDirectives.authenticate` resolves
any valid `helio_pat_` bearer to the *same* `AuthenticatedUser` a browser session gets — a PAT today
carries 100% of the user's authority across every authenticated route in `ApiRoutes.scala`'s single
flat `concat(...)` tree. `PipelineRunService.submit` already threads a `triggerSource` string
(`TriggerSource.{Manual,Scheduled,External}` — `External` reserved for this ticket, unused today)
and is the run-lifecycle path both manual API calls (`PipelineRunSubmitRoutes`) and HEL-415's
scheduler (`PipelineSchedulerService.fire`) share. `pipeline_runs` already has `trigger_source`
(V63); there is no run-history read surface that omits it.

## Goals / Non-Goals

**Goals:**
- A token can be minted with an optional pipeline allow-list; presence of the list additionally
  confines the token to a single capability (triggering runs), not just those pipelines.
- One new route, `POST /api/hooks/run`, reusing `PipelineRunService.submit` — no second
  run-invocation path.
- External triggers are visible on the existing `GET /api/pipelines/:id/run-history` read path.
- Unscoped PATs and session auth are entirely unaffected.

**Non-Goals:**
- A general resource/verb permission system (dashboards, panels, etc. scoping). Scope here is
  exactly one capability (`hooks:run`) plus a pipeline-id allow-list — deliberately narrow.
- Request-level rate limiting or a client-supplied idempotency key. Mitigated instead by collapsing
  a trigger into an already-in-flight run for the same pipeline (see Decision 5) and by scope +
  revocability limiting blast radius. Documented as a known limitation.
- Any scheduler/cron logic (HEL-340).

## Decisions

**1. Scope shape: `scoped_pipeline_ids` allow-list, capability implied by presence.**
`api_tokens` gains a nullable `scoped_pipeline_ids TEXT[]` column (Postgres array — no JSON parsing
needed, unlike `condition` on `alert_rules`). `NULL` = today's token (full account access, every
route). Non-null (even a single-element array) means: (a) the token authenticates ONLY
`POST /api/hooks/run` — every other authenticated route 403s for it, enforced by Decision 2's single
chokepoint — and (b) within that route, the requested `pipelineId` must be a member of the array,
else 403. This is a resource allow-list plus an implied single capability, not a general ACL — the
honest, bounded version of "scoped token" for one ticket. `CreateApiTokenRequest.scopedPipelineIds:
Option[Seq[String]]`; `RequestValidation` rejects an empty (but present) array and validates each id
via `PipelineRepository.findGrantRole` / ownership — **editor or owner only, not any shared access**
(round-1 skeptic finding: `findByIdShared` alone admits viewer grantees, who can never actually
trigger a run per `PipelineRunService.submit`'s own editor-or-owner check, so a viewer-scoped token
would mint successfully but always 403 at trigger time — fail closed, but confusing; tightening the
mint-time check to match `submit`'s real requirement avoids ever minting a token that cannot work).

**2. Enforcement point: a single chokepoint ahead of `ApiRoutes`'s three-way branch split, not a
second directive layered onto one branch.**
Round-1 design put `restrictScopedToken` only inside the `authenticate` branch — **insufficient**.
`pathPrefix("api")` (`ApiRoutes.scala` line 213, confirmed by re-reading the file) has exactly three
siblings under one `concat(...)`, wrapped by `requireCsrfHeader`: `pathPrefix("auth") { ... }`
(login/register/oauth), `authDirectives.optionalAuthenticate { ... }` (mounts
`PublicDashboardRoutes`/`PublicUploadRoutes` — e.g. `GET /api/dashboards/:id/panels`, per
`CLAUDE.md`'s note that this route is "not available on the authenticated route tree"), and
`authDirectives.authenticate { ... }` (everything else). `optionalAuthenticate` shares the exact same
`identity`/`resolveApiToken`/`findUserByTokenHash` resolution chain `authenticate` uses — deliberately
left untouched — so a scoped token handed to the `optionalAuthenticate` branch resolves to the *same*
full `AuthenticatedUser` and, per `AclDirective.authorizeResourceWithSharing`'s unconditional
owner-match branch, gets full owner-level read access to any dashboard its owner has — bypassing the
pipeline allow-list entirely. Fixing only the branch named "authenticate" fixes the two branches that
exist *today*; the same bug reappears the moment a third bearer-token-resolving branch is added (this
class of gap has already recurred twice in this codebase — HEL-384's cross-tenant ACL gap, HEL-363's
403-vs-404 existence leak).

Add `AuthDirectives.confineScopedToken: Directive1[Option[TokenScope]]` (new `TokenScope(tokenId:
ApiTokenId, allowedPipelineIds: Set[String])` in `domain/model.scala`), wrapped around the entire
three-way `concat(...)` — i.e. between `requireCsrfHeader` and `concat(...)`, so it runs before any
branch gets a chance to independently resolve identity:
  - If a `helio_session` cookie is present at all (valid or not), `provide(None)` immediately,
    without inspecting the `Authorization` header — this mirrors `resolveIdentity`'s existing
    session-takes-priority-over-header precedence exactly (see the existing "prefer the session
    cookie over a simultaneously-present PAT header" test), so a session-authenticated request is
    never affected by this directive regardless of what bearer header also happens to be attached.
  - Else, if no `Authorization: Bearer helio_pat_...` header is present, `provide(None)` — anonymous
    and non-PAT-bearer requests pass through completely untouched; **this preserves
    `optionalAuthenticate`'s public-access semantics** (an unauthenticated request must still reach
    `PublicDashboardRoutes` exactly as today — the chokepoint never requires a credential to exist).
  - Else, resolve the token via `findPrincipalByTokenHash` (Decision 3). If it does not resolve
    (invalid/expired/revoked) or resolves but is **unscoped** (`scoped_pipeline_ids IS NULL`),
    `provide(None)` — let the branch's own `authenticate`/`optionalAuthenticate` do its normal
    resolution and produce the normal 401 (invalid) or full-access behavior (unscoped); this
    directive only ever acts on a token that positively resolves to a *scoped* row.
  - Else (resolves, and is scoped): check the first path **segment** of `extractUnmatchedPath`
    (split on `/`, compare the first non-empty segment for exact string equality to `"hooks"` — not
    a prefix/`startsWith` test, so `/api/hooksomething` cannot slip through) — if it is `hooks`,
    `provide(Some(TokenScope(...)))`; otherwise `complete(StatusCodes.Forbidden, ...)` immediately,
    before any of the three branches run.

Because the directive wraps all three branches in the same lexical scope, the extracted
`Option[TokenScope]` is available to whichever inner branch wants it (only the `authenticate`
branch's new `HookRoutes` does — Decision 4) without needing a second, parallel
`authenticateScoped` directive or touching `authenticate`'s signature at all. Every existing route
class keeps taking a bare `AuthenticatedUser` from the untouched `authenticate` directive.
`AuthDirectivesSpec`'s existing fake-repo tests of `authenticate`/`optionalAuthenticate`/
`findUserByTokenHash` are untouched — this is purely additive, applied one level higher in
`ApiRoutes.scala`, not inside `AuthDirectives`'s existing directives.

**3. Repository: new `findPrincipalByTokenHash`, `findUserByTokenHash` untouched.**
`ApiTokenRepository.findPrincipalByTokenHash(hash): Future[Option[(AuthenticatedUser, ApiTokenId,
Option[Set[String]])]]` — same privileged (`withSystemContext`) pre-auth lookup as
`findUserByTokenHash`, additionally selecting `id` and `scoped_pipeline_ids`. Only
`confineScopedToken` (Decision 2) calls this; `resolveApiToken`/`findUserByTokenHash`/`authenticate`/
`optionalAuthenticate` are unchanged, so the existing unit tests and every non-`ApiRoutes` caller
keep working byte-for-byte (double-lookup trade-off noted in Risks).

**4. `POST /api/hooks/run` — thin route, `HookTriggerService` owns logic, reuses `submit`.**
`ApiRoutes.scala`'s `authenticate` branch passes both its own `authenticatedUser` and the
`Option[TokenScope]` extracted by Decision 2's `confineScopedToken` (in scope from the outer wrap)
into `new HookRoutes(hookService, authenticatedUser, tokenScope)` under `api/routes`; body
`{ "pipelineId": "<id>" }`. `HookTriggerService.trigger(pipelineId, user, tokenScope)`:
  - `tokenScope.exists(!_.allowedPipelineIds.contains(pipelineId))` → `ServiceError.Forbidden`.
  - else delegates straight to `pipelineRunService.submit(pipelineId, isDry = false, user,
    triggerSource = TriggerSource.External, triggeredByTokenId = tokenScope.map(_.tokenId.value))`
    — the pipeline ACL (owner/editor-grantee) inside `submit` is the same check every other run
    path gets; a scoped token cannot trigger a pipeline the resolved user doesn't own/edit even if
    it were (mis-)configured with that id.
  - Response: `HookTriggerResponse(runId, pipelineId, status)` — `runId` now populated because
    Decision 5 makes `submit` return it.

**5. Thread `triggeredByTokenId` through `submit`, and finally expose `runId` on `RunResultResponse`.**
`PipelineRunService.submit`/`executeRun` gain `triggeredByTokenId: Option[String] = None`
(default preserves every existing call site — `PipelineRunSubmitRoutes`, `PipelineSchedulerService`,
`BoundPanelService`). `PipelineRunRepository.insertRun`/`insertRunInternal` gain the same optional
param, persisted into a new nullable `pipeline_runs.triggered_by_token_id UUID REFERENCES
api_tokens(id) ON DELETE SET NULL` column (SET NULL, not CASCADE — revoking a token must not erase
run history). `RunResultResponse` gains `runId: Option[String] = None`, populated in `executeRun`'s
success/failure branches from the `runId` already generated there (today it's discarded after
`insertRun`); `previewStep`'s direct construction leaves it `None` — no run is persisted for a
preview. `PipelineRunRecord`/`PipelineRunRow` gain `triggeredByTokenId: Option[String]`, so
`GET /api/pipelines/:id/run-history` becomes the audit read path the ticket asks for — no new
endpoint. `jsonFormat8` → `jsonFormat9` for `PipelineRunRecord`, `jsonFormat4` → `jsonFormat5` for
`RunResultResponse`.

**6. Duplicate-trigger handling: collapse into the in-flight run (no new idempotency-key system).**
Before calling `submit`, `HookTriggerService` calls the already-existing
`PipelineRunRepository.hasActiveRunInternal(pipelineId)` (HEL-415's overlap guard). If a run is
in flight, look it up (new `findActiveRunInternal`, mirrors `hasActiveRunInternal`'s query without
the `.exists`) and return its `runId`/status `200 OK` instead of starting a second run — a rapid
retry from an external scheduler is a no-op rather than a duplicate rebuild. This is the concrete,
scoped answer to "idempotent-friendly"/"replay considerations" — not a general dedup-key mechanism.

## Risks / Trade-offs

- [No rate limiting on `/api/hooks/run`] → Mitigated by scope (a compromised scoped token can only
  re-trigger its allow-listed pipelines) + Decision 6's in-flight collapse + revocability
  (`DELETE /api/tokens/:id`, already shipped). Documented in `docs/agent-native.md` as a known
  exposure; a follow-up ticket can add per-token rate limiting if abuse is observed.
- [Postgres `TEXT[]` column is a new Slick array-mapping pattern in this codebase — most JSON-shaped
  columns here use `jsonbStringType` + `JsValue`] → Slick's `PostgresProfile` has first-class
  `TEXT[]` support (`ArrayType`); confirm with a small repository unit test rather than assuming.
  If friction appears, fall back to the `jsonbStringType` pattern (`condition` on `alert_rules`)
  storing `{"pipelineIds": [...]}, ` — functionally equivalent, more code churn only.
- [Scope check happens twice — once in `confineScopedToken` (route-family level, gates entry to any
  non-`/hooks` path) and once inside `HookTriggerService` (pipeline-id level, gates which pipelines
  a scoped token may trigger)] → Intentional defense in depth, mirrors the existing `AclDirective`
  (ACL gate) + service-level ACL recheck pattern already used in `PipelineRunService`.
- [A scoped-PAT request pays for two token-hash-to-row lookups per request — `confineScopedToken`'s
  speculative resolution ahead of the branch split, then the branch's own `authenticate`/
  `optionalAuthenticate` resolving the same token again] → Accepted: PAT bearer traffic is the
  minority case (session cookies dominate normal browser use), the lookup is a single indexed
  `token_hash` equality query already on the privileged pool, and correctness (one real confinement
  chokepoint that cannot be bypassed by a future fourth branch) is worth more here than shaving one
  query off an already-cheap auth path.

## Migration Plan

Flyway `V74__api_token_scope_and_run_audit.sql`: add `api_tokens.scoped_pipeline_ids TEXT[]`
(nullable, no default — existing rows stay `NULL`/unscoped) and `pipeline_runs.triggered_by_token_id
UUID REFERENCES api_tokens(id) ON DELETE SET NULL` (nullable). Purely additive; no backfill, no
existing-row rewrite, no RLS-policy change on either table (both already have owner-only policies
that don't reference these columns). Re-confirm `V74` is still the next free number immediately
before writing the migration and again before pushing (v1.6 has several concurrent tickets).

## Planner Notes

- Self-approved: reusing `TriggerSource.External` (already reserved, unused) rather than inventing a
  fourth trigger-source literal.
- Self-approved: `docs/agent-native.md` (not a new doc file) gets the scoped-token + hook section —
  it is already the canonical PAT/agent-automation doc and links to `helio-mcp/README.md`.
- Self-approved: no frontend UI for scope on token creation in this ticket — `POST /api/tokens` is
  the only mint surface today (no token-management UI exists yet in `frontend/`), so scope is
  API-only, consistent with the rest of the PAT surface.

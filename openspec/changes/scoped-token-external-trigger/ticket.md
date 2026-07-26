# HEL-369: Add recurring external-run hooks: stable trigger endpoint + scoped token auth for scheduled external rebuilds

## Context

`helio-news` runs unattended every morning from a systemd user timer (`deploy/news.service`), authenticating to Helio with a Personal Access Token (`HELIO_PAT`) it hands to the MCP server (`~/Development/helio-news/news/helio_client.py` `_load_pat_env`; README "Setup"). The auth story works — PATs already exist (`AuthDirectives.resolveApiToken` matches the `helio_pat_` prefix; `ApiTokenService`; `V42__api_tokens.sql`; `ApiTokenRoutes`) — but there is **no first-class notion of an external, recurring workflow trigger**: no way to mint a token scoped to "rebuild these dashboards", no stable trigger endpoint an external scheduler (cron/systemd/Cloud Scheduler) can hit, and no run-audit record tying a rebuild to the credential that launched it. The user wants to build more workflows like this, so the *external trigger + auth* surface should be a supported primitive rather than "point a full-access PAT at the MCP over stdio".

This ticket owns the **external trigger + authentication** half. The actual scheduler (cron expressions, in-cluster timers, auto-refresh) is the Scheduled Runs epic (HEL-340) — this hook is what such a scheduler, or an outside one, calls.

## Scope

* **Scoped run token** — extend the existing PAT model (`backend/src/main/scala/com/helio/services/ApiTokenService.scala`, `ApiTokenRoutes.scala`, protocol under `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala`, and a Flyway migration V60+ if new columns are needed) so a token can carry an optional **scope/label** identifying the workflow it drives (e.g. a `scope` or `workflow` attribute), for least-privilege external automation and for audit. Keep `helio_pat_` bearer resolution in `AuthDirectives` unchanged for existing tokens.
* **Stable trigger endpoint** — a documented, idempotent-friendly entrypoint an external caller hits to launch a workflow's rebuild, authenticated by the scoped token. Two acceptable shapes (decide in design):
  * a generic "run this pipeline / refresh this dashboard" trigger, or
  * a webhook-style `POST /api/hooks/run` that records the invocation and returns a run id.
    New route under `backend/src/main/scala/com/helio/api/routes/`; wire into `ApiRoutes.scala`; logic in a service. Never inline fully-qualified names.
* **Run audit** — record each external trigger (who/which token, when, what it targeted, outcome) so recurring runs are observable. Reuse pipeline-run history infrastructure where it fits (`PipelineRunRepository`, `PipelineRunHistoryRoutes`).
* **Docs** — document the external-trigger + token-minting flow (a section in `docs/` and/or the MCP README) so a new workflow can wire itself up the way helio-news does, but with a scoped credential.
* Update `schemas/` + `openspec/` for the token scope field and trigger endpoint.

## Acceptance criteria

- [ ] A user can mint a token carrying a workflow scope/label; it authenticates like an existing PAT (bearer, `helio_pat_` resolution) and is visible/revocable via the token routes.
- [ ] A documented trigger endpoint, authenticated by that token, launches the target workflow rebuild and returns a run/invocation id.
- [ ] Each external trigger is recorded (token/user, timestamp, target, outcome) and readable via a run/audit read path.
- [ ] Existing unscoped PATs keep working unchanged (backward compatible); scope is optional.
- [ ] Auth failures (missing/invalid/revoked token) return 401; a token used outside its scope returns 403 (if scope enforcement is implemented).
- [ ] ScalaTest coverage: scoped-token auth success, revoked/invalid 401, trigger records an audit row, unscoped-PAT still authorized.
- [ ] Flyway migration (if any) applies cleanly; coordinate the V-number with other v1.6 backend tickets (next free V60+).

## Out of scope — belongs to HEL-340 (Scheduled Runs)

* The **scheduler** itself: cron expressions, in-cluster timers, auto-refresh cadence, and any UI to configure a schedule. This ticket provides only the trigger endpoint + auth those mechanisms (or an external scheduler like systemd/Cloud Scheduler) call.
* Retry/backoff policy for scheduled runs.

## Dependencies

* Coordinates with HEL-340 (Scheduled Runs epic) — the scheduler drives this hook; keep the split clean. Flag to that lane so they consume this trigger rather than inventing a parallel one.
* Builds on the existing PAT system (HEL-148 agent-native layer); no hard blocker.

## Backward compatibility

Additive: token scope is optional and existing `helio_pat_` tokens authenticate exactly as today; the trigger endpoint is new. helio-news' current full-PAT-over-stdio flow keeps working until it adopts a scoped token + trigger.

## Orchestrator pre-brief notes (security surface)

This is a security-surface ticket touching authentication and adding an externally-reachable trigger endpoint. The design gate must settle explicitly:

1. **Scoped tokens vs. existing PATs.** Decide the scoping model concretely (per-resource? per-capability? expiry?), and be honest if full scoping is too large for this ticket — a narrower, well-specified step beats a half-built permission system. State which is being done.
2. **Do not weaken existing auth.** Nothing added may bypass `AuthDirectives`, RLS, or owner scoping.
3. **Replay / abuse considerations.** Consider idempotency, rate limiting, or at minimum document the exposure. HEL-340's scheduler runtime already ships in-app scheduled pipeline runs — reuse its run-invocation path rather than opening a second one with different guarantees.
4. **Token handling hygiene.** Secrets must never be logged or returned after creation beyond the single reveal-on-create. Match `ApiTokenService`'s current behavior.
5. If a Flyway migration is needed, re-confirm the max V-number at write time AND again pre-push.

Scope discipline: only HEL-369. HEL-624 (pie/scatter chart aggregation) is queued behind and must not be absorbed.

## Context

See proposal.md. `ChatAccessService` (services/auth/ChatAccessService.scala) exposes `guard(user)` (free -> Left
`TierForbidden`, else `Right(tier)`) and `checkConverseCap(user, tier)` (beta atomically increments the shared
`assistant_daily_usage` row via `incrementIfUnderCap`, owner uncounted). The assistant route composes the two
(AssistantConversationRoutes.scala ~l.205, ~l.269) and maps errors with its private `completeTierError`
(TIER_FORBIDDEN 403 / CHAT_LIMIT_REACHED 429, body `TierErrorResponse`). `AiPipelineQuotaGate.Live` (HEL-1108) reuses the
same repos/config for pipeline AI steps.

### ClaudeClient consumer sweep (backend/src/main, all four construction sites)

| Site | Consumer | Reachable by | Gate |
| --- | --- | --- | --- |
| ApiRoutes.scala:400 | `ClaudeAiStepClient` (pipeline AI steps) | pipeline run/schedule | GATED (`AiPipelineQuotaGate`, HEL-1108) |
| ApiRoutes.scala:686 | `DashboardAuthoringService` (`send`, `stream`) | `POST /api/authoring/dashboard` | UNGATED -> fixed here |
| ApiRoutes.scala:710 | `RefinementService` (`send`) | `POST /api/refinements` | UNGATED -> fixed here |
| ApiRoutes.scala:729 | `AssistantService` (`sendWithTools`, the only caller) | `.../converse` | GATED (ChatAccessService) |

`HttpClaudeTransport` is constructed only alongside those four. No other caller of `send`/`stream`/`sendWithTools`
exists outside `infrastructure/ai` and the services above. Non-model sub-routes (`GET /api/authoring/conversations/:id`,
`POST /api/authoring/requests/:id/outcome`) never call Claude and stay unmetered.

## Goals / Non-Goals

**Goals:** one gating mechanism shared with the assistant; no model call reachable by `free`; beta draws from the shared
counter. **Non-Goals:** route removal (owner scope decision; `/api/authoring/dashboard` has no frontend or helio-mcp
caller, confirmed by grep of `frontend/src` and `helio-mcp/src`, but remains a valid HTTP API), new tiers, limit changes.

## Decisions

1. **One new method on `ChatAccessService`: `guardAndCount(user): Future[Either[ChatAccessError, Unit]]`** =
   `guard(user).flatMap(tier => checkConverseCap(user, tier))`. No logic is copied; the assistant keeps calling the two
   primitives (it needs `tier` and a replay check in between). Alternative (a Pekko directive duplicating the chain in each
   route) rejected: two places to drift.
2. **Gate placement: inside the routes, after the 503 check and after body parsing (`entity(as[...])`), before any service
   call.** A missing key therefore 503s without charging, and a malformed body 400s without charging. For authoring the
   gate sits above the `stream` branch, so `?stream=true` and buffered share one gate call (no streaming bypass). The
   outcome and conversation-read sub-routes are not gated (no Claude call).
3. **Unit of charge: one HTTP request = one message**, for both routes. Internal repair retries inside a single request
   (`DashboardAuthoringService.send` ~l.307/327, `RefinementService` ~l.143/162; at most one repair call) are NOT charged
   separately: the cap bounds requests, and the repair retry is bounded at 1 by the services themselves. A client-side
   retry is a new request and is charged again; these routes carry no idempotency key (unlike converse), so there is no
   replay short-circuit to skip the counter. Charging happens before the model call, so a model failure still consumes
   the unit, identical to converse.
4. **Error mapping:** extract the assistant's `completeTierError` into a shared helper (`TierErrorCompletion`, same
   package as `ServiceResponse`) used by all three routes; wire shape is unchanged (`TierErrorResponse`).
5. **Wiring:** `DashboardAuthoringRoutes`/`RefinementRoutes` take `Option[ChatAccessService]` from
   `chatAccessServiceOpt` (ApiRoutes.scala:565, declared before both mount sites). `None` while a service exists is
   impossible in prod (both already require `DbContext`) and FAILS CLOSED with 503, never ungated.
6. **Frontend/MCP:** `RefinementRequestError` already carries the server `message`; add a test and, if the 403/429 body is
   not surfaced, read `message`/`code` from it. The `propose_patch_set` MCP description documents the real 403/429
   codes, verified by a live probe (not assumed; cf. HEL-1143).

## Risks / Trade-offs

- [Gate placed after body parse lets a free user cost a JSON parse] -> negligible next to a model call; the 120/min
  limiter still applies.
- [Stream started before failure still charged] -> same as converse; acceptable.
- [Bypass surface: streaming, outcome route, retry] -> streaming covered by decision 2; outcome route makes no model call;
  retry covered by decision 3. The design-gate skeptic is asked to attack these.

- [Charge-before-validate] A beta request failing service-side validation (unknown conversationId, refinement target
  404/403) burns a unit without a model call, unlike converse. Self-inflicted, not a bypass; accepted.
- [helio-mcp retries every 429] `httpClient.ts` retries 429 up to 5 times with backoff; a CHAT_LIMIT_REACHED 429 will
  not clear by retrying. Task 3.3 makes the client surface a 429 whose body code is CHAT_LIMIT_REACHED immediately.
- [StrictMode double POST] `useRefinement` fires on mount/dep change without abort; dev-only double-invoke charges twice.
  Noted, not changed.

## Planner Notes

- Self-approved: request-as-message charging, extraction of `completeTierError`, fail-closed 503 on missing gate.
- No migration (V113 unused). Route removal explicitly not chosen (owner scope decision).

## Execution Notes (HEL-1205)

- Sweep re-verified against the final tree: `new ClaudeClient` appears only at the four ApiRoutes sites in the table above; after this change three are gated (AiPipelineQuotaGate / ChatAccessService x2 route families + assistant), none ungated.
- `/api/authoring/dashboard` has no frontend or helio-mcp caller (grep of `frontend/src`, `helio-mcp/src`); it is gated, not removed (owner scope decision).
- Charge-before-validate (skeptic note 2): a beta request that fails service-side validation (unknown conversationId, refinement target 404/403) burns one unit without a model call. Self-inflicted only, not a bypass; accepted.
- StrictMode (skeptic note 4): `useRefinement` fires its POST on effect mount without abort, so dev-only StrictMode double-invoke charges a beta user twice. Dev-only; not changed.
- Evidence: `evidence/red-proof-main.txt` (red on unmodified main), `evidence/mutation-proof.txt` (gate removed -> 7 failures), `evidence/live-probe.txt` (real local backend, free+beta only, fake key), `evidence/sbt-test-full.txt`.

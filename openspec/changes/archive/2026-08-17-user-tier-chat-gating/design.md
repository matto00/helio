# Design: user-tier-chat-gating

## Context

Auth resolves `AuthenticatedUser(id)` only — `SlickUserSessionRepository.findValidSession` selects just `user_id`;
no user row is loaded on the hot path (`backend/src/main/scala/com/helio/api/AuthDirectives.scala`). Exactly two
paths create users: `AuthService.register` (`userRepo.insert`) and `AuthService.completeOAuth` → `upsertGoogleUser`
(which already updates `avatar_url` for returning users — the one existing "update on login" precedent). Assistant
chat lives in `AssistantConversationRoutes` (list/create/get/messages/converse/patch; no DELETE), constructed
per-request with the bare `AuthenticatedUser`. Transcripts are one JSON blob per conversation via the uploads
backend; `assistant_conversations` holds metadata only — **there are no per-message rows or timestamps anywhere**,
so a daily cap cannot be counted from existing storage. Error bodies are `ErrorResponse(message)`; the only
machine-readable precedent is `AuthoringErrorResponse(kind, message)` (`DashboardAuthoringProtocol.scala:52`).

## Goals / Non-Goals

Goals: tier column (`free|beta|owner`, default `free`); env-var owner allowlist applied on both auth paths at
signup and login; 403 + machine-readable code on all assistant endpoints for `free`; per-UTC-day converse cap for
`beta`; unlimited `owner`; `tier` in auth user payloads; frontend request-access + limit-reached states.
Non-goals: per proposal.md — no beta-assignment tooling, no demotion, no billing, no gating elsewhere, and no
change to the auth hot path's shape (`AuthenticatedUser` stays id-only).

## Decisions

**D1 — Storage: `TEXT` + `CHECK`, not a Postgres enum.** V88 adds
`tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','beta','owner'))` to `users`. The `auth_provider` enum
(V9) is precedent for `CREATE TYPE`, but enums make adding tiers a migration-with-lock affair and Slick maps
strings anyway; a CHECK is equally strict and cheaper to evolve. Scala side: `sealed trait UserTier`
(`Free|Beta|Owner`) with wire names, on `User` and `UserRow` (7-tuple widens to 8; `insert`/`upsertGoogleUser`
row builds updated).

**D2 — Migration number is V88, not V87.** In-flight HEL-698 holds `V87__assistant_conversation_idempotency_key`
(confirmed live in its worktree; main tops out at V86). Merge-order constraint recorded under Risks.

**D3 — Tier is resolved per-request in the assistant path only.** A new `ChatAccessService` (backend `services/`)
does `userRepo.findById` → tier → verdict. Alternative — joining `users` into `findValidSession` or widening
`AuthenticatedUser` — was rejected: it touches every authenticated request and a broadly-shared type for one
feature's need. One indexed PK lookup per assistant call is noise next to a Claude round-trip.

**D4 — Allowlist config: `UserTierConfig.fromEnv()`** (pattern: `ClaudeConfig`/`CookieConfig`) reading
`HELIO_OWNER_EMAILS` (comma-split, trim, lowercase, drop empties — mirroring `Main.scala`'s
`CORS_ALLOWED_ORIGINS` split). Applied in `AuthService`: `register` assigns tier at insert; `login` promotes via
new `UserRepository.updateTier` when allowlisted and not already owner; `completeOAuth` assigns on create /
promotes on return (beside the existing avatar refresh). `AuthService` gains the config as a second constructor
arg, passed explicitly where it is built (`ApiRoutes.scala:148` uses `fromEnv()`; specs inject their own — keeps
the 14-required-arg `ApiRoutes` constructor untouched). OAuth's `google:<sub>@helio.invalid` email fallback can never
match a real allowlist entry — correct by construction.

**D5 — Cap storage: new table `assistant_daily_usage`** (`user_id UUID REFERENCES users(id)`, `usage_date DATE`,
`message_count INT NOT NULL`, PK `(user_id, usage_date)`), also in V88. Enforcement is one atomic statement at
converse entry: `INSERT ... ON CONFLICT (user_id, usage_date) DO UPDATE SET message_count = +1` guarded by
`WHERE message_count < :limit`, `RETURNING` — no row returned ⇒ at cap ⇒ 429, nothing incremented, no model
call, no turns persisted. Race-safe without transactions. The table carries **full RLS** (`ENABLE` + `FORCE ROW
LEVEL SECURITY`, owner policy `user_id = current_setting('app.current_user_id')::uuid`), matching every recent
per-user table (`api_tokens` V42, `agent_memory` V82, sibling `assistant_conversations` V80): every access
happens strictly post-`authenticate`, so unlike `users`/`user_sessions` there is no pre-identity exemption.
`AssistantDailyUsageRepository` therefore routes through `DbContext.withUserContext` (never raw `db.run`, per
CONTRIBUTING.md), and `"assistant_daily_usage"` is added to `RlsPolicyGuardSpec.rlsTables` (a positive
allowlist — omission would silently skip coverage). Alternative (counting transcript blobs) is impossible — no
per-message timestamps.

**D6 — Cap scope: converse only; limit from `HELIO_BETA_DAILY_MESSAGE_LIMIT`** (int, default **50**, UTC day),
read `sys.env...toIntOption.getOrElse` per the `AgentMemoryService` precedent (values < 1 treated as 0 = always
capped). `POST /:id/messages` (appendTurn) invokes no model, so it is not counted/capped — but `free` users are
blocked from it wholesale by D7's gate, so it is not an access loophole; only already-trusted beta/owner reach it.

**D7 — Error contract: `TierErrorResponse(code: String, message: String, limit: Option[Int])`.** Codes:
`TIER_FORBIDDEN` (403, free, every assistant endpoint) and `CHAT_LIMIT_REACHED` (429, beta over cap, converse).
Mirrors the `AuthoringErrorResponse` kind/message precedent; named `code` (not `kind`) deliberately — this is a
new cross-feature client contract, and `code` is the conventional axios-side name. The gate lives inside
`AssistantConversationRoutes` as a directive-style wrapper taking `ChatAccessService`, so
`AssistantConversationRoutesSpec`'s literal-user harness tests it with zero auth plumbing (the gate must wrap
every inner route, including future ones). Status mapping reuses `ServiceResponse.statusCodeFor` where possible
(429 has no `ServiceError` case — completed directly). **Both** test-side constructor call sites are in scope:
`AssistantConversationRoutesSpec` *and* `AssistantTelemetrySpec.scala:129`, whose telemetry fixtures must use a
tier/quota that still reaches the model call being measured (owner, or beta far under cap).

**D8 — `tier` rides the existing user payloads.** `User` gains `tier`, so register/login/OAuth/`/api/auth/me`
responses all carry it via the shared user JSON format (`JsonProtocols`). Frontend `User` type
(`features/auth/types/user.ts`) gains `tier: "free" | "beta" | "owner"`; flows through the existing
`/api/auth/me` → `authSlice.setAuth` rehydration untouched.

**D9 — Frontend: proactive + reactive.** Proactive: `ActiveConversationPanel` (the single surface behind both
`/chat` and the quick launcher) renders a request-access `EmptyState` when `currentUser.tier === "free"` —
**title/description only, no `cta`** (`EmptyStateCta.onClick` is non-optional and the prompt is informational
per proposal Non-goals; copy directs the user to contact the workspace owner), and the composer is not rendered.
The `fetchConversations` dispatch is guarded on `tier === "free"` so the locked state never races a 403 into the
list-error branch. Reactive handling is **scoped to the converse path only**: `extractErrorMessage` widens to
return `{ code?, message, limit? }` for the converse thunk (`rejectValue` widens from `string` there; the other
four thunks keep their string contract), and `MessageComposer`'s local catch switches on it — `CHAT_LIMIT_REACHED`
renders a distinct limit-reached notice (transcript stays visible), `TIER_FORBIDDEN` renders an inline
access-revoked message (stale-tier edge; near-unreachable under promotion-only). The
`activeConversation.status === "failed"` raw-string branch is explicitly out of scope — with the fetch guard a
free user never reaches it. `converse.rejected` stays un-reduced (composer-local), per the existing slice comment.

**D9 correction (cycle-2, evaluation-1.md CR1) — there is a THIRD `fetchConversations` dispatch site, and it
was missed the first pass.** `ChatPage.tsx`'s own doc comment already said it out loud: "the list itself renders
in the desktop sidebar via `SidebarBody.tsx`'s `chat` branch, not here." `SidebarBody.tsx` drives the sidebar's
"chat" section from its own `useEffect` (shared with sources/pipelines/registry/metrics), independent of both
`ChatPage.tsx` and `QuickLauncherOverlay.tsx` — gating those two, as originally written, left this one ungated.
The live symptom: a free-tier user landing on `/chat` never reached `ActiveConversationPanel`'s locked state at
all cost-free — the sidebar's own ungated fetch 403'd, and with nothing gating the *render* either,
`SidebarItemList` fell through to its generic `error`-prop branch and printed the raw
`"Failed to load conversations."` string, in direct violation of the `tier-gated-assistant-access` spec's "no raw
error message ... is shown" scenario.

Fix, mirroring the proactive half's own shape: `SidebarBody.tsx` reads `currentUser` the same way
`ChatPage.tsx`/`QuickLauncherOverlay.tsx` do, gates its "chat" branch of the effect on `!isFreeTier`, and —
**this is the part D9's original text didn't anticipate** — a gated fetch alone is not sufficient here, because
`SidebarItemList`'s *empty*-state branch (not its *error* branch) is what a free user would otherwise hit
instead: `conversations.status` stays `"idle"` with zero items, which `SidebarItemList` renders as its own
generic "No conversations yet" + "+ New chat" `EmptyState` (misleading — starting a conversation is not actually
possible). So `SidebarBody.tsx` short-circuits BEFORE reaching `SidebarItemList` at all for `section === "chat"
&& isFreeTier`, rendering a bespoke, CTA-less, `variant="sidebar"` `EmptyState` directly — no heading, no filter
box, no "+" button, none of `SidebarItemList`'s list chrome, since none of it applies to a section the user
cannot use. Its copy is byte-for-byte identical to `ActiveConversationPanel`'s own locked state by construction:
both now read a single exported `TierRequestAccessCopy` constant (`assistantConversationsSlice.ts`) instead of
each carrying its own string literal, so the sidebar and the main pane can never again drift out of sync on why
chat is unavailable.

**D10 — Deploy plumbing + AC #3 closure path.** Document `HELIO_OWNER_EMAILS` + `HELIO_BETA_DAILY_MESSAGE_LIMIT`
in `CLAUDE.md`'s env table and `infra/.env.deploy.example`; wire through `infra/deploy-backend.sh` alongside its
existing env passing. Prod value for the allowlist: `mattheworr018@gmail.com` (set at deploy time, not committed
as a default). AC #3 ("verified end-to-end against the real deployed config") closes in two tracked steps:
(a) in-run — local end-to-end through the *same* env-var mechanism prod uses (`HELIO_OWNER_EMAILS` set in the
worktree's `backend/.env`, real signup/login, owner converse past the beta limit); (b) post-deploy — an explicit
manual verification checklist in the PR body and the Linear closing comment (set the var on Cloud Run, log in as
`mattheworr018@gmail.com`, confirm unlimited converse). This run's pipeline verifies dev, not prod, so (b) is
deliberately a tracked human step, not an implied one.

## Risks / Trade-offs

- [V87/V88 merge order] If this PR merges before HEL-698, Flyway's default `outOfOrder=false` will not apply a
  later-arriving V87 → HEL-698 must renumber (or this ticket renumbers to V87 if 698 is abandoned). → Stated in
  the PR body; expected order (698 first) is the safe one. Dev-side already isolated on DB `helio_hel703`.
- [Promotion visibility] An already-authenticated owner promoted mid-session sees the new tier only after the
  next login/`/me` fetch. → Acceptable; promotion is a login-time mechanism by ticket scope.
- [Failed model calls after increment] A converse that increments then fails in transport has consumed one unit.
  → Accepted for this pass (conservative cap, small limit values; refunds add state for marginal gain).
- [No beta-assignment surface] Testing beta requires a direct DB `UPDATE users SET tier='beta'`. → Documented in
  tasks; HEL-704's invite flow is the real assignment surface.

## Migration Plan

V88 is purely additive (column with default + new empty table): deploy backend, then set env vars. Rollback =
revert the code; the column/table are inert without it. Existing rows backfill to `free` via the column default.

## Open Questions

None blocking. (Merge-order coordination with HEL-698 is tracked under Risks, not open for design.)

## Planner Notes (self-approved)

V88 numbering; isolated dev DB `helio_hel703` (worktree `.env` only); error field named `code` over `kind`;
cap default 50/UTC-day; full RLS on `assistant_daily_usage` (revised per design-gate round 1); CTA-less
request-access state; converse-only reactive error plumbing; `tier`
added to `/api/auth/me` payload (needed for proactive UI; additive, non-breaking). No new external dependencies,
no breaking API changes, no scope beyond ticket ⇒ no human escalation required at the planning gate.

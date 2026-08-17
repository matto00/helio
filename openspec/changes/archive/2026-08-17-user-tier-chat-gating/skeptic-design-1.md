## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Migration numbering (V88).** `ls backend/src/main/resources/db/migration | sort -V | tail` in this
  worktree tops out at `V86__pipeline_steps_enabled.sql`; the worktree HEAD (`0f3eaf1b`) matches `main`'s
  HEAD exactly (`git worktree list`). The sibling worktree
  `.claude/worktrees/bug/chat-send-idempotent-retry/HEL-698` has
  `V87__assistant_conversation_idempotency_key.sql`. V88 is genuinely the next free number here — confirmed,
  not just asserted.
- **Isolated dev DB.** `backend/.env` (gitignored, `git check-ignore -v` confirms) points
  `DATABASE_URL` at `helio_hel703`. Matches the run-specific context given.
- **No per-message transcript storage.** `V80__assistant_conversations.sql`: the table is metadata-only
  (`id, owner_id, title, pinned, gcs_body_ref, created_at, updated_at`); the transcript itself is a JSON
  blob at `assistant-conversations/{userId}/{conversationId}.json` via the uploads `FileSystem` abstraction.
  No per-turn row, no per-turn timestamp anywhere — design.md's stated reason for a new counter table is
  real, not hand-waved.
- **Auth hot path is id-only.** `AuthDirectives.scala`/`UserSessionRepository.scala`:
  `SlickUserSessionRepository.findValidSession` selects only `.map(_.userId)`; `AuthenticatedUser(id: UserId)`
  (`domain/model.scala:33`) carries nothing else. `AuthService` currently takes one constructor arg
  (`userRepo: UserRepository`) — consistent with D4's "gains the config as a second constructor arg."
  `ApiRoutes.scala:148` is indeed `new AuthService(userRepo)`.
- **`AssistantConversationRoutes` route surface.** Read the file in full: list / create / `POST /:id/messages`
  (append) / `POST /:id/converse` / `GET /:id` / `PATCH /:id` — exactly the six endpoints tasks.md 3.3 lists,
  no DELETE. Matches design.md's claim precisely.
- **`AuthoringErrorResponse(kind, message)` precedent** (`DashboardAuthoringProtocol.scala:52`) and its bespoke
  completion helper reusing `ServiceResponse.statusCodeFor` (`DashboardAuthoringRoutes.scala:59`, confirmed
  `private[routes]`) — real precedent for D7's planned `TierErrorResponse(code, message, limit)` shape and
  route-local completion.
- **`ClaudeConfig.fromEnv()` / `CookieConfig.fromEnv()` pattern** — read both files; `UserTierConfig.fromEnv()`
  matches the established shape (comma-split/trim/lowercase mirrors nothing existing verbatim, but
  `AgentMemoryService`'s `sys.env.get(...).flatMap(_.toIntOption).getOrElse(default)` is a real precedent for
  D6's int-env parsing).
- **RLS posture of `users`.** Grepped every migration for `ENABLE ROW LEVEL SECURITY` — `users` has none.
  Confirmed the "same posture as users" half of D5's claim is factually true.
- **`RlsPolicyGuardSpec`** (`backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala`) is an
  explicit *allowlist* of 20 tables that must carry RLS — it will NOT fail CI merely because a new table is
  added without RLS; only omission from the list plus omission of RLS together are silent. This matters for
  Change Request 1 below.
- **`ApiRoutes` constructor.** Counted the full parameter list: 14 required (non-default) params followed by
  19 defaulted (nullable-repo / string-default) params, 33 total. D4's "14-arg ApiRoutes constructor" is
  accurate only under that reading (see non-blocking note).
- **Frontend ground truth.** Read `features/auth/types/user.ts` (no `tier` yet — to be added, matches D8/task
  5.1), `assistantConversationsSlice.ts` (`extractErrorMessage` currently returns `string`;
  `converse.rejected` is genuinely NOT wired into `extraReducers` today — matches D9's "stays un-reduced" claim
  verbatim), `ActiveConversationPanel.tsx`, `MessageComposer.tsx`, and `shared/ui/EmptyState.tsx`.
- **RLS precedent comparison** — read `V82__agent_memory.sql`, `V42__api_tokens.sql`, `V80` again with this
  lens: every recent per-user accounting/state table (`agent_memory`, `agent_preferences`, `api_tokens`,
  `assistant_conversations` itself) carries full `ENABLE/FORCE ROW LEVEL SECURITY` + an owner policy, including
  `api_tokens`, whose own migration comment explicitly discusses the pre-identity lookup case and *still* RLS's
  the table for the post-auth list/revoke path, bypassing only the literal authentication-time hash lookup via
  the privileged pool. This is the closest analog to `assistant_daily_usage` in the codebase and it does the
  opposite of what D5 proposes.
- **Compile-surface check for the new `ChatAccessService` constructor param.** `grep -rl "new
  AssistantConversationRoutes("` under `backend/src/test` found two files, not one:
  `AssistantConversationRoutesSpec.scala` (which design.md D7 explicitly calls out) and
  `AssistantTelemetrySpec.scala:129` (`new AssistantConversationRoutes(conversationService, assistantOpt,
  user).routes`), which design.md/tasks.md never mention.
- **`ServiceError` sealed trait** (`services/ServiceError.scala`) has 9 cases, none mapping to 429 — confirms
  the 429 (`CHAT_LIMIT_REACHED`) path cannot go through `ServiceResponse.statusCodeFor` as-is; task 3.2's
  "where applicable" hedge already anticipates this, so I'm not treating it as a defect, just recording that I
  checked it.
- **`DbContext.scala` / `CONTRIBUTING.md` §"Database transactions & RLS context"** — read both. The binding
  rule is explicit: "never call `db.run(...)` directly in a repository" and "Any new table that holds
  user-owned data must" get RLS + policies + an `RlsPolicyGuardSpec` allowlist entry. `UserRepository`/
  `UserSessionRepository` are pre-existing, structurally-exempt violations (users/sessions are read *before*
  an authenticated identity exists — the RLS session variable has nothing to key on yet). `assistant_daily_usage`
  has no such structural exemption: every access happens strictly after `AuthDirectives.authenticate` resolves
  a real user (D3: `ChatAccessService` runs "per-request in the assistant path," post-auth).

### Verdict: REFUTE

### Change Requests

1. **`assistant_daily_usage` must not skip RLS — D5's justification is a false equivalence, and it contradicts
   this codebase's own most-analogous precedent.** (`design.md` D5, `tasks.md` 1.1/1.5)
   D5 argues "No RLS on this table: it is backend-internal accounting keyed by user_id, never queried on
   behalf of a user (same posture as users itself, which is not RLS-enabled)." Both halves of that claim are
   wrong on inspection:
   - It absolutely *is* queried/written on behalf of a specific, already-authenticated user — the entire
     mechanism (`INSERT ... ON CONFLICT (user_id, usage_date) DO UPDATE ... WHERE message_count < :limit
     RETURNING`) runs inside a single converse request, keyed by that request's own `AuthenticatedUser.id`.
   - `users`/`user_sessions` are exempt from RLS for a structural reason that doesn't apply here: they are the
     tables that establish identity, read *before* any `app.current_user_id` exists to key a policy on. Every
     access to `assistant_daily_usage` happens strictly *after* `AuthDirectives.authenticate` — there is no
     chicken-and-egg problem.
   - The nearest real precedent, `api_tokens` (V42), explicitly discusses the pre-identity case in its own
     migration comment ("The authentication-time lookup by token_hash necessarily runs BEFORE any user
     identity exists... goes through the privileged pool") and *still* enables full `RLS + FORCE RLS` for the
     table's normal, post-auth, user-scoped operations. Every other recent per-user table in this feature area
     (`agent_memory` V82, `agent_preferences` V81, and `assistant_conversations` itself — the sibling table
     added 8 migrations earlier for this exact chat feature) is RLS'd the same way. `assistant_daily_usage`
     would be the one deliberately-uncovered exception, immediately adjacent to a covered sibling table, with
     no structural reason to be one.
   - `RlsPolicyGuardSpec.rlsTables` is a positive allowlist, not an exhaustive negative check, so this gap
     will not fail CI — it is exactly the kind of silent regression the design gate needs to catch before
     implementation, not after.
   Required revision: add `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + an owner policy
   (`user_id = current_setting('app.current_user_id')::uuid`) to `assistant_daily_usage` in V88, route
   `AssistantDailyUsageRepository` through `DbContext.withUserContext` (not a raw `db.run` mirroring
   `UserRepository`), and add `"assistant_daily_usage"` to `RlsPolicyGuardSpec.rlsTables`. If there is a real
   reason to keep it RLS-free, design.md needs an argument that actually distinguishes it from `api_tokens`/
   `agent_memory` — the current one doesn't.

2. **`AssistantTelemetrySpec.scala` is a second, unaccounted-for call site of `AssistantConversationRoutes`'s
   constructor.** (`backend/src/test/scala/com/helio/api/routes/AssistantTelemetrySpec.scala:129`)
   Design.md D7 and tasks.md 3.3/6.4 only mention updating `AssistantConversationRoutesSpec`'s "literal-user
   harness." `AssistantTelemetrySpec.scala:129` independently does
   `new AssistantConversationRoutes(conversationService, assistantOpt, user).routes` with the current 3-arg
   signature. Once `ChatAccessService` becomes a required 4th constructor parameter, this file stops
   compiling; once it's patched to compile, its telemetry assertions (which exercise `converse`) also need a
   `ChatAccessService`/fixture user with enough tier/quota to actually reach the model call being measured, or
   the telemetry tests start failing on the new gate instead of testing telemetry. Add this file explicitly to
   tasks.md's scope (3.3 or 6.4).

3. **The "request-access" `EmptyState` CTA action is unspecified, and `EmptyStateCta.onClick` is
   non-optional.** (`design.md` D9; `frontend/src/shared/ui/EmptyState.tsx`)
   D9 says the request-access state uses `EmptyState`'s "existing `cta` slot." `EmptyStateCta` requires a
   non-optional `onClick: () => void`. Neither design.md, tasks.md, nor the ticket says what clicking it does —
   and proposal.md's own Non-goals explicitly rule out a billing/upgrade flow this pass ("the 'request access'
   prompt is informational only"). That leaves an implementer to invent a target (mailto: link? external
   contact form? a no-op?) with no guidance, which different implementers would resolve differently. Either
   specify the actual click behavior, or state plainly that this state renders `title`/`description` only
   (omitting `cta`), since task 5.3's own wording never mentions a CTA at all — only design.md D9 does,
   creating an internal inconsistency between the two artifacts.

4. **Ticket AC #3 ("owner unlimited, verified end-to-end against the real deployed config") has no
   corresponding task.** (`ticket.md` AC #3; `tasks.md` 4.1)
   Tasks.md's only deploy-related item (4.1) covers documenting `HELIO_OWNER_EMAILS`/
   `HELIO_BETA_DAILY_MESSAGE_LIMIT` and wiring them into `infra/deploy-backend.sh` — plumbing, not
   verification. Nothing in tasks.md closes the loop on actually deploying and confirming, against the real
   Cloud Run backend with the real `mattheworr018@gmail.com` account, that owner access is unlimited — which
   the AC explicitly requires ("not just a unit test default"). Since this ticket's delivery pipeline verifies
   against a dev worktree, not prod, this AC needs an explicit task (even a manual, post-merge one) so it has
   a trackable path to being satisfied, rather than being implicitly assumed.

### Non-blocking notes

- D9 also claims "a `TIER_FORBIDDEN` from any thunk falls back to the same request-access state," but tasks.md
  5.2/5.3 don't extend this to `fetchConversations`/`selectConversation`/`togglePinned`/`renameConversation`'s
  reject-value shape, nor to `ActiveConversationPanel.tsx`'s `activeConversation.status === "failed"` branch
  (lines 83-94), which today renders `activeConversation.error` as a raw string. In practice this looks close
  to unreachable under this ticket's promotion-only tier model — a free user's `items` stays empty (their
  `fetchConversations` 403s), so `effectiveId` resolves to `null` and the primary `EmptyState` branch (already
  covered by task 5.3) handles it — so I'm not blocking on it, but the design should either scope this
  defensive path out explicitly or spell out the plumbing so it isn't half-specified.
- D4's "keeps the 14-arg `ApiRoutes` constructor untouched" is accurate only when read as "14 *required*
  params" (verified: 14 non-defaulted + 19 defaulted = 33 total params). Worth a one-word tweak
  ("14-required-arg") so a future reader doesn't misread it as the total signature length.

### Process note

This worktree's `scripts/concertino/` is missing `next-report-number.sh`/`persist-evidence.sh`/
`emit-event.sh` (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `README.md`,
`.concertino.env` are present — an older/narrower sync than main's current `scripts/concertino/`, which has
the full set and an identical, worktree-agnostic `.concertino.env`). I invoked the required scripts by their
absolute path from the main checkout (`/home/matt/Development/helio/scripts/concertino/...`) rather than
guessing a fallback filename or skipping the report — they are pure, argument-driven, side-effect-free-other-
than-file-IO scripts (verified by reading them) with no worktree-local state, so this is safe and does not
touch any file under review. Flagging so the worktree's tooling sync can be refreshed.

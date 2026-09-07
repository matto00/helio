## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Companion-object claim (the whole test strategy rests on it) — TRUE.**
   `backend/src/main/scala/com/helio/services/auth/AuthService.scala:259` opens `object AuthService`;
   `:295` `private val csrfStateStore = new ConcurrentHashMap[String, Long]()`, `:296`
   `CsrfStateTtlSeconds = 300L`, `:299` put, `:308-309` `remove`-and-check. Class methods `:214`/`:218`
   are literal forwarders to the companion. So two `new AuthService(...)` share one map, and a
   two-AuthService test is indeed a vacuous green. Design/ticket are right; the "inject the store"
   decision is load-bearing, not tidying.

2. **Call-site line refs — accurate.** `OAuthRoutes.scala:102` `redirect(buildGoogleAuthUrl(authService.generateCsrfState()), Found)`;
   `:114-115` `if (!stateOpt.exists(authService.validateCsrfState)) complete(BadRequest, ErrorResponse("Invalid or missing OAuth state parameter"))`.
   `ApiRoutes.scala:250` is where `new AuthService(...)` is constructed. All as stated.

3. **Migration head — accurate.** `ls backend/src/main/resources/db/migration` sorted numerically ends
   at `V104__pipeline_run_truncation_signal.sql`. The "derive the number at write time, never edit an
   applied file" caution matches this repo's shared-dev-DB reality.

4. **Cross-site topology (option-1 rejection) — the *premise* is real, the *inference* is overstated.**
   `CookieConfig.scala:6-17` and `Main.scala:194-196` confirm `COOKIE_SECURE` drives `Secure` and
   derives `SameSite=None` iff secure, with the stated rationale "every API call is genuinely
   cross-site". `docs/deployment.md:12-14` confirms `Lax` "cannot function in this app's cross-site
   prod topology". But that documented reasoning is scoped to **`fetch`/XHR** calls from
   `helioapp.dev` to the Cloud Run origin. The OAuth state cookie would be set and read on
   **top-level GET navigations to the backend's own origin** (`/api/auth/google` → Google →
   `/api/auth/google/callback`), which is exactly the case `SameSite=Lax` permits, and is not the
   embedded third-party context that browser third-party-cookie restrictions target. See CR4 —
   the *decision* survives, the *argument as written* does not.

5. **RLS-guard exemption — CORRECT, and the guard cannot be silently bypassed.**
   `RlsPolicyGuardSpec.scala` (HEL-923 completeness check, header lines 41-56) asserts the set of
   `public` tables with `relrowsecurity = true` is EXACTLY `rlsTables.keySet`. A table that does not
   enable RLS is therefore legitimately absent, and a table that *does* enable RLS without a map entry
   fails the spec. `share_tokens` (V101) and `connector_completion_tokens` (V103) are on the list, but
   both carry a `user_id`/owner column; `oauth_states` has none to scope a policy to. The exemption is
   argued, not convenient. Task 1.3 correctly pins the guard.

6. **Single-use claim — sound.** `DELETE ... WHERE state = ? AND expires_at > now() RETURNING` in
   Postgres takes a row lock; concurrent deletes of one row yield exactly one `RETURNING` row. It is a
   genuine strengthening over per-process `ConcurrentHashMap.remove`. Task 2.1 correctly forbids
   read-then-delete. Not hand-waved.

7. **Where the plan would pass locally and fail in production — a documented, repeated trap it misses.**
   `V102__share_tokens_privileged_grant.sql` exists *solely* because V101 shipped a near-identical
   unauthenticated short-lived token table without an explicit grant; its header states "this repo has
   had three prod-only RLS/grant incidents (HEL-974) that local/CI/prod-dump testing as a superuser
   cannot catch", and V98:15 records that Flyway runs as the non-superuser, NOBYPASSRLS `helio` role.
   Every repository under `infrastructure/persistence/auth/` picks a `DbContext` explicitly
   (`withUserContext` in `InviteCodeRepository:47`, `ConnectorCredentialRepository:50`+;
   `withSystemContext` = the privileged pool, `DbContext.scala:63`). The plan names neither the grant
   nor the context. See CR2.

8. **Vacuity risk in the load-bearing test — real.** Tasks 4.1/4.2 require two independently
   constructed *store* instances and a proven red arm, but never require those instances to be the
   real Postgres-backed implementation. An in-memory test double satisfying the same interface would
   pass 4.1 and even go red on 4.2, while proving nothing about cross-process durability. See CR3.

### Verdict: REFUTE

The option choice, the security semantics, the RLS argument, and the companion-object diagnosis all
hold up under independent checking. Four gaps must close first; all are cheap edits to `design.md` /
`tasks.md` and none require re-planning the approach.

### Change Requests

1. **Specify the synchronous→asynchronous signature change, and forbid blocking.**
   `AuthService.validateCsrfState(state: String): Boolean` and `generateCsrfState(): String` become
   database calls, i.e. `Future[Boolean]` / `Future[String]`. `OAuthRoutes.scala:102` uses the result
   inline inside `redirect(...)`, and `:114` uses `stateOpt.exists(authService.validateCsrfState)` —
   neither compiles against a `Future`. `tasks.md` 3.2 currently says "keeping the call sites in
   `OAuthRoutes` behaviourally identical", which as written invites an `Await.result` on the Pekko
   dispatcher — explicitly forbidden by `CLAUDE.md` ("Avoid blocking operations in actor execution
   paths"). Add a design decision naming the async signatures and the route restructuring
   (`onSuccess`/`onComplete` around both `path("google")` and `handleCallback`), and state that
   `Await`/blocking is not an acceptable implementation. Note that the *observable* behaviour that
   must stay identical is the `400` body and the no-code-exchange-before-validation ordering, not the
   call-site syntax.

2. **Name the database grant and the `DbContext` the new store runs under, and verify under the
   non-superuser role.** The OAuth path is unauthenticated, so there is no `user_id` for
   `withUserContext`; the plan must state whether the store uses `ctx.withSystemContext`
   (`helio_privileged` pool) or the ordinary pool with no user context, and the migration must issue
   the matching explicit `GRANT SELECT, INSERT, DELETE ON oauth_states TO <role>` rather than relying
   on V38's `ALTER DEFAULT PRIVILEGES` — this is exactly the V101→V102 sequence, whose own header
   records three prod-only incidents that superuser-run local/CI testing cannot catch. `tasks.md` 1.2
   says "confirm the table is usable by the ordinary application role with no user context set" but
   gives no method; it must specify verification as the non-superuser role (the role Flyway and the
   app actually use in production), not as the embedded-Postgres superuser, or it will certify
   nothing.

3. **Bind task 4.1 to the real Postgres-backed store.** Add to 4.1 that the two independently
   constructed store instances must be the production implementation running against a real
   (EmbeddedPostgres + Flyway-migrated) database — an in-memory double implementing the same trait
   satisfies the task text as written, passes, and goes red on 4.2, while proving nothing about
   cross-instance durability. Also make 4.2's red arm explicit about *which* arm is reintroduced (a
   per-process map behind the same interface) so the red proves state loss rather than a compile
   error or missing wiring.

4. **Correct the option-1 rejection in `design.md` — keep the decision, fix the reasoning.** The claim
   that "`SameSite=Lax` never attaches a cookie on that path" is imported from the XHR case
   (`CookieConfig.scala`, `docs/deployment.md`) and does not hold for the OAuth flow, which is a
   top-level GET navigation to the backend's own origin — precisely the case `Lax` allows, and not the
   embedded third-party context that third-party-cookie restrictions target. Leaving the argument as
   written puts a false technical claim into the permanent design record of a security change. The
   decision itself is still right, and the honest disqualifier is already in the document one paragraph
   later: a stateless cookie cannot express **single-use** without storage, and the ticket's bar is
   explicitly "CSRF protection must not be weakened". Restate the rejection on that ground.

### Non-blocking notes

- `connector_completion_tokens` (V103) is a very close prior art for this table — short-lived,
  single-use, expiry enforced *in the mutating statement's predicate* rather than in memory. Citing it
  in `design.md` and mirroring its shape would shorten review and inherit its already-litigated
  decisions.
- Pruning "on the write path" (task 2.4) means every `GET /api/auth/google` issues an extra `DELETE`.
  Task 1.1's expiry index covers the cost; worth stating the intended cadence (every write vs.
  probabilistic) so the executor does not have to guess.
- `tasks.md` 5.4 (delete rows this run created, confirm by query) is well-aimed given the shared dev
  database — keep it.

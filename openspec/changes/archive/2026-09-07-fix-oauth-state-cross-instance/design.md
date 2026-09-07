## Context

`object AuthService` holds OAuth CSRF state in a `ConcurrentHashMap` (`AuthService.scala:295`), with
`CsrfStateTtlSeconds = 300L`. `generateCsrfState()` puts; `validateCsrfState` does
`Option(map.remove(state)).exists(_ > now)` — the `remove` is what makes state single-use today. The
class methods at `:214`/`:218` are thin forwarders to the companion.

Because the store is in the **companion object**, it is a JVM-wide singleton. Production runs
`--max-instances=2 --min-instances=0`, so two processes have two disjoint stores, and a process may be
reclaimed during the 30-60s consent wait. Either condition loses the state and yields
`400 "Invalid or missing OAuth state parameter"` at `OAuthRoutes.scala:115`.

**A consequence that shapes the whole test strategy:** two `new AuthService(...)` instances *share*
the companion's map. A test that constructs two `AuthService` instances therefore proves nothing — it
is a vacuous green. The fix must make the store an injected collaborator so that two genuinely
independent instances can be constructed, which is what makes the cross-process test meaningful.

## Goals / Non-Goals

**Goals.** Restore Google login. Preserve CSRF strength exactly: forged, unknown, expired, and
replayed states all still rejected with the same `400`. Keep the 300-second TTL. Make the defect
provable by a test that can distinguish two independent stores, and provably able to go red.

**Non-Goals.** `min-instances` / cold-start latency (separate concern; setting `min-instances=1`
masks this bug while the two-instance race survives). Password, PAT, MFA, and session-cookie paths.
A general distributed cache.

## Decisions

### Decision: database-backed state (ticket option 2)

A short-lived Postgres row keyed by the state value. Issue inserts; validation performs a single
atomic `DELETE ... WHERE state = ? AND expires_at > now() RETURNING ...`, and treats "one row
returned" as valid.

**Why this and not option 1 (signed cookie).** The disqualifier is **single-use**, not cookie
attributes. A stateless signed cookie can prove "this callback belongs to the browser that started
the flow", but it cannot record that a given state has already been consumed without adding storage —
and this ticket's explicit bar is that CSRF protection must not be weakened to fix availability.
Today's `ConcurrentHashMap.remove` makes a state single-use within a process; a cookie design would
drop that property outright.

*A correction, recorded deliberately.* An earlier draft of this document rejected option 1 on the
grounds that `SameSite=Lax` "never attaches a cookie on that path" and that the design would depend on
third-party cookies. That claim was wrong, and it is corrected here rather than quietly deleted. The
cross-site constraint behind `COOKIE_SECURE=true` (HEL-287, `CookieConfig.scala`, `docs/deployment.md`)
is real but scoped to `fetch`/XHR calls from `helioapp.dev` to the Cloud Run origin. The OAuth state
cookie would instead be set and read on **top-level GET navigations to the backend's own origin**
(`/api/auth/google` → Google → `/api/auth/google/callback`), which is exactly the case `Lax` permits
and is not the embedded third-party context that browser third-party-cookie restrictions target. The
cookie option was therefore viable on attributes; it fails on single-use. Anyone revisiting this
decision should argue against the single-use ground, not the SameSite one.

**Why not option 3 (self-contained HMAC).** Attractive — no storage, immune to instance count — but it
cannot express single-use without adding storage, at which point it collapses into option 2 with an
extra signing key. It also requires provisioning a new production secret during a live incident, with
a fail-closed failure mode (a missing key leaves login exactly as broken as it is now) and no
rotation story yet (HEL-530 is unstarted). The replay argument *can* be made — a replayed state is
useless without a fresh authorization code, and Google's codes are single-use — but that argument
trades a currently-held property for a reasoned one, in a change whose explicit bar is not weakening
CSRF protection. Rejected on those grounds, not on effort.

**Cost accepted.** One Flyway migration and one table. Postgres is already a hard startup dependency
shared by every instance, so this introduces no new infrastructure and no new secret.

### Decision: preserve the 300-second TTL unchanged

`CsrfStateTtlSeconds = 300L` is carried over verbatim. The TTL now lives in the row's `expires_at` and
is enforced in the SQL predicate, so expiry is evaluated by the database clock rather than each
process's clock — one fewer cross-instance skew surface. No behavioral change is intended.

### Decision: single-use is preserved, not argued away

`DELETE ... RETURNING` is atomic in Postgres: concurrent validations of the same state contend on the
same row and exactly one returns it. This is a strictly stronger guarantee than the previous
`ConcurrentHashMap.remove`, which was single-use only within one process. Replay across instances was
previously *unprotected* and now is protected.

### Decision: the state API becomes asynchronous, and must not block

Both operations become database calls, so `generateCsrfState(): String` and
`validateCsrfState(state: String): Boolean` become `Future[String]` and `Future[Boolean]`. Neither
current call site compiles against a `Future`: `OAuthRoutes.scala:102` uses the result inline inside
`redirect(...)`, and `:114` uses `stateOpt.exists(authService.validateCsrfState)`. Both routes must be
restructured around `onSuccess`/`onComplete` — the file already does this at `:132` and already has an
implicit `ExecutionContextExecutor` at `:49`.

`Await.result` (or any other blocking call) on the Pekko dispatcher is **not** an acceptable way to
preserve the existing signatures; `CLAUDE.md` forbids blocking operations in actor execution paths.
The behaviour that must stay identical is *observable*: the same `400` body, and the state check still
happening **before** any authorization-code exchange with Google. Call-site syntax is expected to
change.

### Decision: the store is injected, not a singleton

The state store becomes a collaborator passed to `AuthService`, replacing the companion-object map and
its forwarders. This is what makes a two-independent-instances test possible at all, and is therefore
part of the fix rather than incidental tidying.

### Decision: `oauth_states` mirrors the `connector_completion_tokens` (V103) pattern exactly

`oauth_states` is written by **unauthenticated** requests before any user identity exists, so there is
no `app.current_user_id` to scope a policy to and no owner column to key one on. That means the store
runs through `ctx.withSystemContext` — the `helio_privileged` (`BYPASSRLS`) pool — exactly as
`ConnectorCompletionTokenRepository`'s anonymous `findByHash`/`consume` path already does for a
near-identical short-lived single-use token table. `DbContext.scala` requires every `withSystemContext`
call site to carry an inline comment explaining why the bypass is correct; this one must say that the
OAuth state path has no request-bound user by construction.

The table therefore still enables RLS and FORCE RLS, with a **deny-all** policy (`USING (false)`): no
ordinary-role access is legitimate, and the privileged pool bypasses policies anyway. `oauth_states` is
added to `RlsPolicyGuardSpec`'s `rlsTables` map, whose HEL-923 completeness check asserts the set of
RLS-enabled `public` tables is *exactly* that map's key set — so the guard stays honest in both
directions.

*Superseded reasoning.* An earlier draft argued this table should simply be exempt from the guard's
allowlist, on the grounds that it is not owner-scoped. The design gate independently verified that
exemption was legitimate and unbypassable. It is nevertheless abandoned here in favour of mirroring
established prior art, because "argue a novel exemption" is a worse posture than "reuse the pattern
that already survived review" — particularly in an area where this repository has had prod-only
incidents.

### Decision: the migration issues an explicit GRANT

`V102__share_tokens_privileged_grant.sql` exists *solely* because V101 shipped a near-identical
unauthenticated short-lived token table and relied on V38's `ALTER DEFAULT PRIVILEGES` instead of an
explicit grant. Its header records three prod-only RLS/grant incidents (HEL-974) that local, CI, and
prod-dump testing **as a superuser cannot catch**. This migration will therefore issue
`GRANT SELECT, INSERT, DELETE ON oauth_states TO helio_privileged;` explicitly.

Verifying that grant needs care, because the obvious method does not work. `helio_privileged` is
`NOLOGIN` (V34) and cannot be connected as; the ordinary login role is precisely the role this table
denies. The verification is therefore: connect as the login role (`DB_USER`), `SET ROLE helio_privileged`
(the privileged pool applies this per connection via `application.conf`'s `connectionInitSql`, so
issuing it on the session under test is equivalent in effect), and confirm the writes succeed — plus a negative arm confirming the same role **without** `SET ROLE` is denied, which is what
actually certifies the deny-all posture. The EmbeddedPostgres suite does not substitute: it migrates
and connects as the superuser, so it passes whether or not the grant exists.

### Decision: pruning is expiry-driven, not a scheduled job

Expired rows are deleted opportunistically on the write path rather than by adding a scheduler
dependency. The table's steady-state size is bounded by the login rate over a 5-minute window.

## Risks / Trade-offs

- **A migration during a live incident.** Additive: one new table, no change to any existing table, no
  backfill, no lock on a hot table. The migration number must be derived from the tree at the moment
  it is written (head is `V104` as of planning) and never taken from a ticket — the database is shared
  across worktrees and Flyway checksums the entire file, so an applied migration can never be edited.
- **A database round trip is added to each of two OAuth requests.** Two indexed single-row statements
  on a path that already performs several network calls to Google. Not material.
- **Database unavailability now fails the OAuth path.** It already did: the callback upserts a user
  and inserts a session, so a login cannot complete without Postgres regardless.

## Verification strategy

The load-bearing evidence is a **cross-process round trip**: a state issued through one store instance
and consumed through a **separately constructed** instance sharing no memory. Because the defect is
exactly "these two things were the same object", the test must construct two, and the red arm must be
demonstrated by reintroducing a per-process store and showing that same test fail — confirming the
failure isolates to the state lookup and not to unrelated setup. Assertions must check returned
content and the exact `400` body, not status codes alone. No test may assert on a logged state value,
since states must never be logged.

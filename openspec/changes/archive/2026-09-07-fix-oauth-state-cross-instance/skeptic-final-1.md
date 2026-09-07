## Skeptic Report — final gate (round 1, skeptic-final-1.md)

HEAD `e5c42161`, base `2444a739`. Cold review: every conclusion below is from a command I ran
myself in this worktree. I read `evaluation-1.md`/`evaluation-2.md` only as claims to refute.

### What I verified (with evidence)

**1. Mutation — the thing that mattered. Both mutants reproduced and killed by me.**

Baseline first: `sbt "testOnly ...OAuthStateRepositorySpec ...GoogleOAuthRoutesSpec
...AuthServiceSpec ...RlsPolicyGuardSpec"` → `Suites: completed 4 / Tests: succeeded 131,
failed 0`.

*Companion-object mutant* (the actual production defect: JVM-wide `ConcurrentHashMap` in
`object OAuthStateRepository`, both methods `Future.successful`, Postgres never touched):

```
- should validate a state issued by one repository instance ... *** FAILED ***
- should fail once the row has been deleted out-of-band ... *** FAILED ***
- should fail validation once expires_at has elapsed *** FAILED ***
- should remove an expired row and leave an unexpired unconsumed row still valid *** FAILED ***
- should return 400 with the exact body when state has expired (tasks.md 4.4) *** FAILED ***
Tests: succeeded 22, failed 5
```

The cycle-1 vacuous green is gone: the suite now dies on the exact defect shape that previously
left it 8/9 green, and the primary red is durability-shaped (the out-of-band `readRow` inside the
4.1 cross-process test at `OAuthStateRepositorySpec.scala:119`), not an incidental expiry
artefact. I also picked up a route-level red (4.4) the evaluator's narrower run did not.

*Per-instance mutant* (same map moved to a class field): `Tests: succeeded 18, failed 9` —
still dies, and dies harder, as it must.

Source restored from a pre-mutation copy; `git status --porcelain` shows only the untracked
`evaluation-2.md`, i.e. the tracked tree is byte-identical to HEAD.

**2. Cross-process AC against genuinely separate OS processes, not separate objects.**
I launched two independent backend JVMs from this worktree (`ss -ltnp`: pid 3943001 on :9371,
pid 3935751 on :9372) against one Postgres:

| Check | Result |
|---|---|
| Issue on A (:9371) | `state=37d79…d972`, 32 hex chars; row present in `oauth_states` read by a third connection (psql) |
| Callback on **B** (:9372) with that state | `HTTP=500` — i.e. it passed the state gate and failed downstream on the deliberately bogus code. No state `400`. |
| Replay on A | `400 {"message":"Invalid or missing OAuth state parameter"}` — single-use holds across processes |
| Forged / never-issued | `400 {"message":"Invalid or missing OAuth state parameter"}` |
| Missing `state` | `400 {"message":"Invalid or missing OAuth state parameter"}` |
| Expired (issued on B, backdated, callback on A) | `400 {"message":"Invalid or missing OAuth state parameter"}` |

Bodies asserted, not statuses. Freshness was established functionally, not from
`start-servers.sh`'s "already healthy" (CON-155): these two JVMs were compiled and launched by me
from the current source, and the state row observably landed in Postgres — which the pre-fix
binary could not do.

**3. TTL is 300s on the database clock.** Measured live: `expires_at - now() = 299.982s`, read a
few ms after issue, so exactly 300 at write time. `OAuthStateStore.TtlSeconds = 300L` is bound as
the multiplier in `now() + interval '1 second' * $ttlSeconds`. The cycle-2 switch to SQL `now()`
regressed nothing I can find: `validateAndConsume` is still one statement
(`DELETE … WHERE state = ? AND expires_at > now()`, `.map(_ > 0)`), pruning is its exact
complement (`expires_at <= now()`) so it can never remove a row validation would accept, and the
concurrency test still asserts exactly one of ten concurrent validations wins.

**4. Deny-all RLS denies a *grant-holding* non-superuser — unambiguously.** I created
`sk1019_probe` (`LOGIN NOSUPERUSER NOBYPASSRLS`) and granted it `SELECT, INSERT, UPDATE, DELETE`
on `oauth_states`, precisely so a denial cannot be read as a missing grant:

- as the probe: `has_table_privilege('oauth_states','SELECT') = t`, `INSERT = t` — the grant is there
- `SELECT count(*)` → `0` while a superuser-seeded row exists → policy, not privilege
- `INSERT` → `ERROR: new row violates row-level security policy for table "oauth_states"`
- `DELETE FROM oauth_states WHERE state='sk1019_seed'` → `DELETE 0`, and the seed row survives

Positive arm along the real production path: `BEGIN; SET LOCAL ROLE helio_privileged;` (exactly
what `DbContext.withSystemContext` does) → `bypassrls = t`, `INSERT 0 1`, rows visible, the atomic
consume `DELETE 1`, prune succeeds. Catalog state matches the migration: `relrowsecurity=t`,
`relforcerowsecurity=t`, single policy `oauth_states_deny_all` with `qual = false`.

**5. No secret is logged.** Zero occurrences of the issued state value or `bogus-code` across both
live backend logs. `OAuthRoutes`' only log call is
`log.error("OAuth callback failed unexpectedly during code exchange", ex)`; the only exception
messages that path can carry are `Google token exchange failed: <status>` /
`Google userinfo fetch failed` / `No access_token in Google response` — no code, no token, no
state. `OAuthStateRepository` makes no logging call at all.

**6. Migration is additive.** `git diff --name-status 2444a739...HEAD -- .../db/migration` →
`A V105__oauth_states.sql`, nothing else. `main` tops out at `V104`, so no number collision. In the
shared dev DB, `flyway_schema_history` version `105` is `success=t`, checksum `-1624713290`.

**7. No dispatcher blocking; the companion store is gone, not merely unused.** The only `Await`
token in the main-source diff is inside a comment explaining why `onSuccess` was used instead.
`grep` over `services/auth` + `persistence/auth` finds no `csrfStateStore` and no
`ConcurrentHashMap` outside comments and an unrelated `BetaAccessService` rate-limiter. The
`object AuthService` block is deleted, and `stateStore` is a **required** (non-defaulted)
constructor parameter, so no caller can silently fall back.

**8. The `e5c42161` spec-literal claim — traced, not accepted.** `git log --all -S'case class
ErrorResponse'` returns exactly two commits (`6cefd31f` introducing it, `3db2c9dd` HEL-236 moving
it), and `git log --all -S'ErrorResponse(error'` returns **nothing**. The field has never been
named `error`. The corrected literal fixes a planning artifact that was wrong when written; it is
scoped to this change's own spec delta, not a published `openspec/specs/**` file. Claim holds.

**9. Design judgment.** Option 2 (DB-backed) is the right call and looks right with the code in
front of me. It sidesteps the ticket's stated trap entirely — there is no cookie, so there is no
`SameSite` attribute to get wrong on the `helioapp.dev` ↔ `*.run.app` cross-site path — and it is
the only option that survives both the two-instance race and scale-to-zero without a signing-key
rollout. Nothing here passes locally but fails in the deployed topology that I can find: the state
is durable rather than sticky, so instance count and cold boots are irrelevant; `now()` is the
database's clock, so the two instances' clock skew cannot matter; V105 is pure DDL on a new table
owned by the migrating role, so it does not repeat the v0.7.x non-BYPASSRLS Flyway incident (which
was about migrations touching existing RLS-protected *data*); and the explicit `GRANT … TO
helio_privileged` closes exactly the prod-only gap `V102` exists to record.

The one genuine behaviour change is a new dependency: `GET /api/auth/google` now fails if Postgres
is unreachable, where before it did not. That is acceptable — nothing else in the login path works
without the database either.

**Hygiene.** Shared dev DB: `sk1019_probe` revoked and dropped (`0` rows in `pg_roles`), every row
I created deleted, `SELECT count(*) FROM oauth_states` → `0`, confirmed by query. My scratch
backends on :9371/:9372 are stopped (both `000`); the delivery servers on :9358/:6451 are up and
untouched. Worktree tracked tree unmodified.

### Verdict: CONFIRM

I would deploy this to the broken production login.

### Non-blocking notes

- `OAuthStateRepository`'s `private val rng` is declared *below* the `issue()` that uses it. Safe
  today only because `issue()` is never reached during construction; a `val` used before its
  declaration point initialises to `null`. One line to move, in security-relevant code. (The
  evaluator raised this too; I agree and it is genuinely not blocking.)
- `helio_privileged` also holds `UPDATE` on `oauth_states` via V38's `ALTER DEFAULT PRIVILEGES`,
  though V105 deliberately grants only `SELECT, INSERT, DELETE` and no code ever updates a row.
  Pre-existing mechanism, not introduced here. If a minimal grant is wanted, a *future* migration
  should `REVOKE UPDATE` — do not edit V105.
- The "still succeed after the issuing instance is entirely discarded" test is the one 4.1-family
  case that still passes under the JVM-wide mutant (no `readRow` assertion). The other two kill it,
  so the suite is sound; a one-line durability assertion there would make the intent uniform.
- Running two `sbt run` processes from one worktree races on `backend/target/`; my first attempt
  died with a `FileNotFoundException` on a freshly-written `.class`. Stagger them or use separate
  target dirs if this two-process probe is repeated.

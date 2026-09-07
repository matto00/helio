## Evaluation Report — Cycle 2 (evaluation-2.md)

HEAD under review: `e5c42161` (`899c7880` → `6bb86ec9` → `e5c42161`). Worktree clean before and after my probes.
Every gate result and every red arm below is from my own fresh run. I re-ran the mutation myself rather than accepting the executor's transcript, as in cycle 1.

### Phase 1: Spec Review — PASS

All six cycle-1 change requests verified addressed. Each was re-checked against the tree, not against the executor's claim.

**CR1 — the one that mattered. Verified by my own mutation.** I replaced `OAuthStateRepository`'s body with the *actual production defect shape* — a companion-object (JVM-wide) `ConcurrentHashMap`, identical to the mutant that left the cycle-1 suite 8/9 green — and re-ran the spec:

```
- should validate a state issued by one repository instance through a separately constructed instance *** FAILED ***
    None was not defined (OAuthStateRepositorySpec.scala:119)
- should fail once the row has been deleted out-of-band, even though issue() reported success ... *** FAILED ***
    None was not defined (OAuthStateRepositorySpec.scala:141)
- should fail validation once expires_at has elapsed *** FAILED ***
    true was not equal to false (OAuthStateRepositorySpec.scala:187)
- should remove an expired row and leave an unexpired unconsumed row still valid *** FAILED ***
    None was not defined (OAuthStateRepositorySpec.scala:233)
Tests: succeeded 6, failed 4
```

The suite can **no longer pass with a process-wide store**, and the primary red is durability-shaped (`None was not defined` on the out-of-band `readRow` inside the 4.1 cross-process test), not an incidental expiry artefact. That is exactly what CR1 asked for. Source restored and byte-compared to `HEAD` afterwards; `git status` clean.

At `HEAD` the same spec is 10/10 green (up from 9 — the new durability-negative arm).

**CR2** — `GoogleOAuthRoutesSpec` now has route-level expired (4.4) and replay (4.5) tests, and the forged/missing tests are tightened from `should include("state")` to `responseAs[ErrorResponse].message shouldBe "Invalid or missing OAuth state parameter"`. These assert the real wire shape and would fail on any body change (they compare the full string via the typed `ErrorResponse` reader, which itself fails to deserialize if the field name changed). The replay test is better than I asked for: it asserts the **first** callback reaches the token exchange (`BadGateway` from a stubbed upstream failure) before the second is rejected, which proves the state check passed on call one and that validation precedes the exchange — the ordering AC, now guarded at route level rather than only by source reading.

**CR3 / CR5 / CR6 — corrections, not deletions.** Each inconvenient line was corrected *with the correction recorded*:
- `tasks.md` 4.3 now says `{"message":...}` and states why the old literal was wrong.
- `tasks.md` 4.9 is narrowed to what the test actually asserts (the state value), with an explicit note that source reading confirms no code/token is logged — a claim/coverage correction rather than a quiet deletion.
- `files-modified.md` now describes the SQL that is actually emitted (`DELETE … WHERE state = ? AND expires_at > now()`, affected-row-count, **not** `RETURNING`) and keeps the atomicity argument.
- `GoogleOAuthRoutesSpec.scala:83` now points at `OAuthStateRepositorySpec`; the phantom `OAuthStateRepositoryCrossProcessSpec` is gone (`git grep` returns nothing).

**The `e5c42161` spec-literal claim — verified, not accepted.** The executor asserts the five `{"error":...}` literals in `specs/google-oauth-login/spec.md` were wrong when written rather than broken by this change. I traced it: `final case class ErrorResponse(message: String)` with `jsonFormat1(ErrorResponse.apply)` was introduced in `6cefd31f` (2026-03-13, "Add dashboard and panel create endpoints"), and `git log -S` shows only one subsequent commit touching that definition — `3db2c9dd` (HEL-236, 2026-05-12), which moved it between files without changing the field. The field has **never** been named `error`. The claim holds; the edit corrects a planning artifact that was wrong from the start, and it is scoped to this change's own spec delta (not a published `openspec/specs/**` file). The correction note added to the spec header records this rather than silently rewriting history.

Ticket ACs, re-checked at this HEAD: cross-process round trip proven by test **and** by my live two-process run; forged/expired/replayed all still `400` with the exact body; TTL still 300s; single-use preserved; no state/code/token logged; content asserted, not just status.

### Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

- `cd backend && sbt test` → **`Suites: completed 271, aborted 0` / `Tests: succeeded 4029, failed 0` / `[success] Total time: 305 s`.** The +3 over cycle 1's 4026 accounts exactly for the one new repository test and two new route tests.
- `npm run lint`, `npm run format:check`, `npm run typecheck` → green (`FE_EXIT=0`). No `frontend/**` file is touched by any of the three commits; run for completeness.

**CR4 — the clock change, scrutinised as a live behavioural change.** The executor took the stronger option and moved the predicate to SQL rather than amending the design record (`design.md` is untouched — its "evaluated by the database clock" claim is now *true* rather than *softened*, which is the right direction). The implementation switched from the Slick table DSL to `sqlu` interpolation specifically so `now()` is evaluated server-side instead of being materialised as a JVM `Instant` before the statement is built. I verified the consequences rather than the intent:

- **TTL is still exactly 300s.** Live against the restarted backend: a freshly issued row measured `expires_minus_now_seconds = 300` (`00:04:59.979` remaining, measured a few ms after issue). `OAuthStateStore.TtlSeconds` is unchanged at `300L` and is bound as the multiplier in `now() + interval '1 second' * $ttlSeconds`.
- **Single-use did not regress.** Still one statement (`DELETE FROM oauth_states WHERE state = $state AND expires_at > now()`), still `.map(_ > 0)`, still no read-then-delete. The 10-way concurrency test still asserts exactly one success, and I re-confirmed replay rejection live across two processes.
- **Pruning is the exact complement** (`expires_at <= now()`), so it can never remove a row `validateAndConsume` would still accept; the pruning test now also asserts the row *existed* before the prune, so it can no longer pass vacuously.
- **No new migration, and V105 is untouched.** `git diff --name-only 899c7880..HEAD -- backend/src/main/resources/db/migration` is empty; `V105__oauth_states.sql` has the same content and the dev DB's `flyway_schema_history` row for version 105 still carries checksum `-1624713290`, `success=t`. The clock change needed no schema change because `expires_at` was already `TIMESTAMPTZ`.
- **No new SQL-injection surface.** Both statements are `sqlu` *interpolations*, so `$state` and `$ttlSeconds` are bound parameters, not string concatenation; only the `now()` function name is literal SQL.

**RLS posture — confirmed not regressed.** `relrowsecurity=t`, `relforcerowsecurity=t`, policy `oauth_states_deny_all` qual `false`, `helio_privileged` holds `SELECT, INSERT, UPDATE, DELETE`. This is the gap I closed myself in cycle 1 with a grant-holding non-superuser probe (`hel1019_probe`, denied on both `SELECT` and `INSERT` despite holding full table privileges); nothing in these two commits touches V105, `DbContext`, or `RlsPolicyGuardSpec`, and `RlsPolicyGuardSpec` is green inside the 4029. The executor's added caveat — that `RlsPolicyGuardSpec` proves *structure* against a superuser-migrated Postgres rather than *enforcement* — is accurate and worth keeping in the record; it is precisely why the cycle-1 probe was needed and why the disclosed `sk_app` arm was insufficient on its own.

**Other mechanical checks at this HEAD:** no `Await`/blocking added to main source (`grep` over the cycle-2 diff: none); no new `TODO`/`FIXME`; no inline fully-qualified names; the companion-object store remains absent from `AuthService`; test pool leakage fixed (`trackedDb()` + `afterEach` close, replacing ~20 leaked pools per run).

### Phase 3: UI Review — PASS

I did **not** trust `start-servers.sh`'s health probe for freshness (CON-155). The backend from cycle 1 was still serving the old binary, so I stopped it explicitly, restarted via the canonical script, and re-established freshness functionally before observing anything: the DB-clock TTL reading above (`300` exactly) is itself the freshness proof, since the cycle-1 binary computed `expires_at` in the JVM.

As in cycle 1, I tested the actual acceptance criterion with **two genuinely separate backend JVMs** (`9358` and `9359`) from this worktree against one Postgres:

| Check | Result |
|---|---|
| Initiation on A, callback on **B** | Passed the state gate into the code exchange (`500` from the deliberately bogus code) — no state `400`. Cross-process round trip works between real processes on the DB-clock implementation. |
| Replay of that state on **A** | `400` `{"message":"Invalid or missing OAuth state parameter"}` — single-use holds across processes |
| Forged / never-issued | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| Missing `state` | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| Expired (issued on B, backdated, callback on A) | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| TTL | `expires_at - now() = 300s` exactly, computed by Postgres |

Bodies asserted, not just statuses. No console/server errors beyond the intended bogus-code failures.

Shared-DB hygiene: every row I created was consumed or deleted; `select count(*) from oauth_states` → `0`, confirmed by query. The cycle-1 scratch role `hel1019_probe` remains dropped. The scratch backend on `9359` was stopped (port no longer listening); the delivery servers on `9358`/`6451` are up and untouched.

### Overall: PASS

The production defect is fixed, the fix is now guarded by a test suite that cannot pass with a process-wide store, and CSRF strength is unchanged — forged, expired, and replayed states all still rejected with the identical `400` body, before any code exchange, verified across two real processes.

### Non-blocking Suggestions

- **Red-arm line numbers have now been off in both cycles** (cycle 1 cited `:101` where the real reds were `:85`/`:95`; cycle 2 cited `:134` where the real reds are `:119`/`:141`/`:233` — `:134` is inside the new test's setup, not an assertion). The substance was correct both times and I reproduced it independently both times, so nothing is blocked. But a transcript that does not line up with the committed file is the weakest possible form of evidence; capture the red arm *after* the file is final, or paste the failing block rather than a single coordinate.
- `OAuthStateRepository`'s `private val rng` is now declared at the *bottom* of the class while `issue()` above it uses it. This is safe today only because `issue()` is never called during construction — a `val` used before its declaration point initialises to `null`/zero if anything ever reaches it during init. Move it back above the methods; the cost is one line and it removes a latent initialisation-order trap in security-relevant code.
- `helio_privileged` ends up with `UPDATE` on `oauth_states` (from V38's `ALTER DEFAULT PRIVILEGES`) even though V105 deliberately grants only `SELECT, INSERT, DELETE` and nothing in the code ever updates a row. Harmless and pre-existing behaviour of the default-privileges mechanism, not something this change introduced — but if the intent is a minimal grant, an explicit `REVOKE UPDATE ON oauth_states FROM helio_privileged` in a *future* migration would make the shipped privilege set match the stated one. Do not edit V105 to do this.
- The "still succeed after the issuing instance is entirely discarded" test is the one 4.1-family case that still passes under the JVM-wide mutant (it has no `readRow` assertion). The other two catch it, so the suite as a whole is sound; adding the same one-line durability assertion there would make the intent uniform.

## 1. Schema

- [x] 1.1 Derive the next migration number from `backend/src/main/resources/db/migration/` **at the
      moment of writing** (head was `V104` at planning time; never take a number from a ticket). Add
      `V<n>__oauth_states.sql` creating `oauth_states` with a primary-key `state TEXT`, a
      `expires_at TIMESTAMPTZ NOT NULL`, and an index supporting expiry pruning. Additive only — do
      not touch any existing migration file; the DB is shared across worktrees and Flyway checksums
      the whole file, comments included.
- [x] 1.2 In the same migration: `ENABLE`/`FORCE ROW LEVEL SECURITY`, a deny-all policy
      (`USING (false)`), and an explicit `GRANT SELECT, INSERT, DELETE ON oauth_states TO
      helio_privileged;`. Mirror `V103__*.sql`'s header style and cite why. Do NOT rely on V38's
      `ALTER DEFAULT PRIVILEGES` — `V102__share_tokens_privileged_grant.sql` exists precisely because
      V101 did, and its header records three prod-only incidents superuser-run testing cannot catch.
- [x] 1.3 Add `"oauth_states"` to `RlsPolicyGuardSpec`'s `rlsTables` map (its HEL-923 completeness
      check asserts the RLS-enabled table set is EXACTLY that map's key set, so the migration and the
      map must move together). Verify the spec passes and that no other entry was widened or narrowed.
- [x] 1.4 **Verify the grant along the real production path.** `helio_privileged` is `NOLOGIN` (V34)
      — it cannot be connected as directly, only assumed via `SET ROLE`. And the ordinary login role
      is exactly the role this table denies. So verify as follows, against a database migrated by the
      non-superuser role:
      - **Positive arm:** connect as the login role (`DB_USER`, the role Flyway runs as), issue
        `SET ROLE helio_privileged` inside the transaction exactly as `DbContext.withSystemContext`
        does, and confirm INSERT, the atomic `DELETE ... RETURNING`, and the prune all succeed.
      - **Negative arm (this is what certifies the deny-all posture):** the same login role **without**
        `SET ROLE` must be DENIED on the table. A permission error here is the design working; do NOT
        "fix" it by granting the ordinary role access — that would silently discard deny-all.
      - Task 4.1's EmbeddedPostgres run does **NOT** substitute for this: those tests migrate and
        connect as the embedded superuser, so they pass whether or not the grant exists. That is
        exactly the prod-only defect class `V102`'s header records three times.
- [x] 1.5 State in the migration header, imperatively, that this table must only ever be reached
      through `withSystemContext` — the deny-all policy is the only thing enforcing it, and the header
      is where a future reader will look.

## 2. Store

- [x] 2.1 Add a repository/store for `oauth_states` exposing issue, validate-and-consume, and prune.
      Validation MUST be a single atomic `DELETE ... WHERE state = ? AND expires_at > now() RETURNING`
      statement — not a read followed by a delete, which would not be single-use under concurrency.
- [x] 2.2 Keep the state value generation unchanged (16 random bytes, 32-char hex, `SecureRandom`).
- [x] 2.3 Keep the TTL at 300 seconds, carried into `expires_at`. Do not change it.
- [x] 2.4 Prune expired rows on the write path, on every issue (the predicate is indexed by 1.1 and
      the table's steady-state size is one login-rate window; a probabilistic cadence would add a
      tuning knob for no benefit at this volume). State the chosen cadence in code. Pruning must not
      remove an unexpired unconsumed row.

## 3. Wiring

- [x] 3.1 Replace the `csrfStateStore` map, `CsrfStateTtlSeconds`, `generateCsrfState`, and
      `validateCsrfState` in `object AuthService` with the injected store. Remove the companion
      singleton entirely — leaving it in place preserves the defect and makes the new test vacuous.
- [x] 3.2 The two operations become `Future[String]` / `Future[Boolean]`. Restructure the
      `OAuthRoutes` call sites (`:102`, `:114`) around `onSuccess`/`onComplete` — the file already does
      this at `:132` and has an implicit `ExecutionContextExecutor` at `:49`. **`Await.result` or any
      other blocking call on the Pekko dispatcher is forbidden** (`CLAUDE.md`: no blocking in actor
      execution paths). What must stay identical is OBSERVABLE behaviour — the same `400` body, and the
      state check still occurring before any authorization-code exchange — not the call-site syntax.
- [x] 3.2b The store's `withSystemContext` call site must carry the inline comment `DbContext.scala`
      requires, explaining that the OAuth state path has no request-bound user by construction.
- [x] 3.3 Wire the store through `ApiRoutes.scala:250` where `new AuthService(...)` is constructed.
- [x] 3.4 Follow `CONTRIBUTING.md`: no inline fully-qualified names in Scala.

## 4. Tests — the load-bearing evidence

- [x] 4.1 **Cross-process round trip, against the real database.** Issue a state through one store
      instance; validate it through a **separately constructed** instance sharing no in-memory state
      with the first. Both MUST be the real Postgres-backed implementation running against an
      EmbeddedPostgres + Flyway-migrated database. An in-memory double implementing the same trait
      would satisfy a looser wording, pass, and even go red on 4.2 — while proving nothing about
      cross-instance durability. A test using one instance, or two `AuthService` instances over a
      shared singleton, does NOT satisfy this either.
- [x] 4.2 **Prove the red arm, and name which arm.** Reintroduce a per-process in-memory map *behind
      the same interface* (so the test still compiles and wires identically) and show 4.1 goes red.
      The red must be a state-lookup failure — an assertion that the second instance found no state —
      not a compile error, missing wiring, or setup failure. Capture the transcript verbatim into the
      delivery evidence, then restore.
- [x] 4.3 Forged/never-issued state → validation fails; via the route, `400` with the exact body
      `{"message":"Invalid or missing OAuth state parameter"}`. Assert the body, not just the status.
      (Corrected per evaluation-1.md CR3: `ErrorResponse` serializes its single field as `message`,
      not `error` — `ResourceProtocol.scala`. The code was always right; this literal was wrong.)
- [x] 4.4 Expired state (past `expires_at`) → rejected, same `400` body.
- [x] 4.5 Replayed state: first validation succeeds, second fails with the same `400` body.
- [x] 4.6 Concurrent validation of one state → exactly one success.
- [x] 4.7 Missing `state` parameter → same `400`, and no code exchange with Google attempted.
- [x] 4.8 Pruning removes an expired row and leaves an unexpired unconsumed row still valid.
- [x] 4.9 Assert no log record contains a state value. (Narrowed per evaluation-1.md CR6 to match
      actual coverage: `OAuthStateRepositorySpec`'s log-capture test asserts only the state value,
      since the repository never handles an authorization code or session token. Source reading
      confirms neither is logged — `OAuthRoutes.scala`'s one log call formats no secret — this is a
      claim/coverage correction, not an outstanding leak.)
- [x] 4.10 Before trusting any of the above, run a probe against a case known to fail and confirm it
      returns the negative — verify the instrument before the finding.

## 5. Verification

- [x] 5.1 `sbt test` green; report the counts.
- [x] 5.2 Frontend gates unaffected — confirm rather than assume; state if no frontend change was made.
- [x] 5.3 Restart the backend rather than trusting `start-servers.sh`'s "already healthy … reusing"
      health probe (CON-155), which answers "something is listening", not "your binary is loaded".
- [x] 5.4 Delete any rows this run created in the shared database; confirm the deletion by query, not
      by exit status. Report what the run modified.

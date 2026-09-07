## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round 2's single blocking CR (unexecutable grant verification in `tasks.md` 1.4):

- `tasks.md` 1.4 now states `helio_privileged` is NOLOGIN (V34) and gives a **positive arm**:
  connect as the login role `DB_USER`, `SET ROLE helio_privileged`, confirm INSERT, the atomic
  `DELETE ... RETURNING`, and the prune succeed. Verified against ground truth:
  `backend/src/main/resources/db/migration/V34__*.sql:18` — `CREATE ROLE helio_privileged BYPASSRLS
  NOLOGIN;` and `:27` `GRANT helio_privileged TO current_user;`. The method is executable as written.
- **Negative arm present** (1.4, second bullet): same login role *without* `SET ROLE` must be DENIED,
  with an explicit instruction not to "fix" it by granting the ordinary role — which is precisely the
  failure mode round 2 was guarding against.
- **EmbeddedPostgres non-substitution stated explicitly** (1.4, third bullet): task 4.1's run migrates
  and connects as the embedded superuser and passes whether or not the grant exists.
- **No contradiction between artifacts:** `design.md` § "Decision: the migration issues an explicit
  GRANT" carries the identical three elements (DB_USER + `SET ROLE`, negative arm as the thing that
  certifies deny-all, EmbeddedPostgres does not substitute). CR is genuinely closed.

Round 2's non-blocking notes: 1.5 is new and states the migration header must imperatively say the
table is only ever reached via `withSystemContext`; 2.4 pins the cadence ("on every issue") with a
stated rationale and requires it be recorded in code. Both actioned.

No new defect introduced by the revision:

- `tasks.md` 1.2 grants `SELECT, INSERT, DELETE` — exactly what 2.1's `DELETE ... RETURNING` (needs
  DELETE + SELECT), the insert, and the prune require. No over-grant, no missing verb.
- Prior art cited is real: `V103__*.sql` ends with `GRANT SELECT, UPDATE ON
  connector_completion_tokens TO helio_privileged;` and its header records the same V102/V38
  superuser-blindness rationale the design quotes.
- `RlsPolicyGuardSpec.scala:78` `rlsTables` exists, and its header (lines 43–49) confirms the HEL-923
  completeness check asserts the RLS-enabled set is exactly the map's key set — so 1.3's
  "migration and map move together" is correct, not decorative.
- Migration head is genuinely `V104` (numeric sort of the migration dir), matching the planning-time
  note; 1.1 correctly requires re-deriving at write time rather than trusting it.

Plan-level soundness (independent re-check):

- Security semantics: 4.3/4.4/4.5/4.7 cover forged, expired, replayed, and missing state, each
  asserting the exact body `{"error":"Invalid or missing OAuth state parameter"}` — matching the live
  `ErrorResponse("Invalid or missing OAuth state parameter")` in
  `backend/src/main/scala/com/helio/api/routes/auth/OAuthRoutes.scala`. Content asserted, not status alone.
- TTL: 300s preserved (2.3), matching `AuthService`'s `CsrfStateTtlSeconds = 300L`; now enforced by
  the DB clock, which strictly reduces skew surface.
- Atomic single-use: 2.1 mandates one `DELETE ... WHERE state = ? AND expires_at > now() RETURNING`,
  explicitly forbidding read-then-delete; 4.6 tests concurrency for exactly-one-success.
- Async/no-blocking: 3.2 forbids `Await.result` on the dispatcher and points at the existing
  `onComplete` usage and the implicit `ExecutionContextExecutor` — both confirmed present in
  `OAuthRoutes.scala`. Call sites `authService.generateCsrfState()` inside `redirect(...)` and
  `stateOpt.exists(authService.validateCsrfState)` are as described and do require restructuring.
- Singleton removal: `AuthService`'s `csrfStateStore` `ConcurrentHashMap` + the two instance
  forwarders exist as described; 3.1 removes them outright, which is what makes 4.1 non-vacuous.
  Injection point `ApiRoutes.scala:250` (`new AuthService(...)`) confirmed.
- Red arm (4.2) is proven, scoped, and specific: reintroduce a per-process map *behind the same
  interface*, require the red to be a state-lookup assertion failure (not a compile/setup error),
  capture the transcript, restore. This is the strongest part of the plan.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 1.4 / `design.md` say `SET ROLE helio_privileged` happens "inside the transaction exactly
  as `DbContext.withSystemContext` does". Mechanically, `withSystemContext` runs on the privileged
  pool, and the `SET ROLE` is applied per-connection via
  `application.conf:106` `connectionInitSql = "SET ROLE helio_privileged"` — not as a statement inside
  each transaction. The verification method is equivalent in effect (same role, same grants) and stays
  executable; only the one-line description of where the `SET ROLE` comes from is slightly off. Worth
  a wording tweak if the executor touches 1.4, not worth a round.
- 4.1's real-Postgres requirement is supported by existing prior art (several specs already use
  EmbeddedPostgres), so this is not new test infrastructure.

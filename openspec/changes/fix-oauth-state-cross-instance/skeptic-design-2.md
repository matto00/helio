## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **CR1 (async signatures / no blocking) — CLOSED.** `design.md` now carries "Decision: the state API
   becomes asynchronous, and must not block", naming `Future[String]`/`Future[Boolean]`, the two
   non-compiling call sites (`OAuthRoutes.scala:102`, `:114`), the `onSuccess`/`onComplete`
   restructuring, the existing precedent at `:132` and the implicit EC at `:49`, and an explicit
   prohibition on `Await.result`. `tasks.md` 3.2 repeats the prohibition and correctly redefines
   "identical behaviour" as OBSERVABLE (same `400` body, validation before code exchange). Not merely
   mentioned — it is binding text in both artifacts.

2. **CR3 (real store in the load-bearing test) — CLOSED.** `tasks.md` 4.1 now requires both instances
   to be "the real Postgres-backed implementation running against an EmbeddedPostgres +
   Flyway-migrated database" and explicitly disqualifies an in-memory double and the two-`AuthService`-
   over-a-singleton shape. 4.2 names the reintroduced arm ("a per-process in-memory map *behind the
   same interface*") and requires the red to be a state-lookup assertion failure, not a compile/wiring
   error. Both gaps closed as written.

3. **CR4 (option-1 rejection) — CLOSED, and correctly.** The rejection is now argued on single-use
   ("a stateless signed cookie … cannot record that a given state has already been consumed without
   adding storage"), and the earlier wrong SameSite claim is preserved as a labelled correction
   ("*A correction, recorded deliberately.*") rather than deleted, with the scope of the real
   cross-site constraint (XHR from `helioapp.dev`) stated accurately. This matches what I independently
   re-derived from `CookieConfig.scala` and `docs/deployment.md` in round 1.

4. **CR2 redirection (RLS + FORCE + deny-all + `withSystemContext` + GRANT) — judged on its merits;
   the direction is SOUND, the verification method is NOT.**
   - `DbContext.scala:56-67` confirms the privileged pool's connections carry `SET ROLE
     helio_privileged` (BYPASSRLS), so `withSystemContext` really does bypass any policy on the new
     table, and `GRANT … TO helio_privileged` is the right grantee (V38 shows BYPASSRLS confers no
     table-level DML, so the grant is genuinely load-bearing, not decorative).
   - `V103__*.sql` is the right prior art and the plan mirrors it accurately (RLS + FORCE + policy +
     explicit grant, with V102's three-prod-incident rationale cited).
   - A deny-all `USING (false)` policy on a privileged-pool-only table is **not** cargo-culted here.
     The table has no owner column to scope a policy to, no ordinary-pool access is ever legitimate,
     and deny-all is fail-closed: if some future code path reaches this table through
     `withUserContext`, it errors instead of silently reading/deleting other users' states. It also
     keeps `RlsPolicyGuardSpec`'s completeness invariant honest.
   - The `rlsTables` completeness check does move the migration and the map together correctly: I read
     `RlsPolicyGuardSpec.scala:41-56` — it asserts the set of `public` tables with `relrowsecurity =
     true` is EXACTLY `rlsTables.keySet`, so enabling RLS in the migration without the map entry fails,
     and a map entry without RLS fails. A `None` value means "at least one policy exists", which the
     single deny-all policy satisfies. Task 1.3 pins this.
   - **But the verification step is unexecutable as written — see Change Request 1.**

5. **Security semantics preserved.** 4.3 forged, 4.4 expired, 4.5 replayed, 4.7 missing param all
   require the exact `400` body (not status alone) and 4.7 requires no code exchange; 4.6 covers
   concurrency; TTL held at 300s (design "preserve the 300-second TTL unchanged", task 2.3);
   `DELETE … WHERE state = ? AND expires_at > now() RETURNING` is mandated as a single statement
   (task 2.1). Grants requested (`SELECT, INSERT, DELETE`) cover `RETURNING`, which needs SELECT.

6. **Migration discipline.** Task 1.1 derives the number at write time (I re-confirmed head is `V104`),
   forbids editing applied files, and the shared-dev-DB/Flyway-checksum rationale is stated.

7. **No new defect found in the rest of the revision.** The store-injection decision, the pruning
   decision, the risks section, and tasks 5.1-5.4 are unchanged in substance from the round-1 text I
   already checked, and nothing in the new RLS decision contradicts them.

### Verdict: REFUTE

Three of the four round-1 change requests are genuinely closed. The CR2 redirection is a defensible
improvement on its merits — but it invalidated the verification step that CR2 existed to add, and the
step as now written cannot be performed and would mislead an executor into either "fixing" a
non-failure or weakening the grant. One blocking revision.

### Change Requests

1. **Fix the grant-verification method — `tasks.md` 1.4 (and the matching sentence in `design.md`'s
   "the migration issues an explicit GRANT" decision) is unexecutable and points at the wrong role.**
   Task 1.4 says: "Connect as the role the application actually uses (the role Flyway runs as — NOT
   the embedded-Postgres superuser)". Under the *new* deny-all design this is wrong twice:
   - `V34__*.sql:19` creates `helio_privileged` as **`NOLOGIN`** ("the role cannot authenticate
     directly — only the application login role (DB_USER) may assume it via `SET ROLE`"). You cannot
     connect as it at all.
   - The Flyway/app login role (`helio`/DB_USER) is precisely the role the new table denies: no
     `GRANT` to it, plus a `USING (false)` policy under FORCE RLS. Following 1.4 literally produces a
     *permission denied* that is the design working correctly, and the obvious "fix" an executor would
     reach for — granting the ordinary role access — silently discards the deny-all posture.

   Rewrite 1.4 to specify the actual production path: connect as the **non-superuser login role**
   (DB_USER, the role Flyway runs as), issue `SET ROLE helio_privileged` inside the transaction exactly
   as `DbContext.withSystemContext` does, and confirm INSERT, the atomic `DELETE … RETURNING`, and the
   prune all succeed. Add the negative half, which is what actually certifies the deny-all decision:
   the same non-superuser role **without** `SET ROLE` must be *denied* on the table. Also state
   explicitly that task 4.1's EmbeddedPostgres run does **not** substitute for this — those tests
   migrate and connect as the embedded superuser, so they pass whether or not the grant exists, which
   is exactly the prod-only class of defect V102's header records three times. Update the one-line
   claim in `design.md` ("verified by connecting as the non-superuser role the application actually
   uses") to match, so the two artifacts do not disagree.

### Non-blocking notes

- Design says the deny-all policy is correct because "no ordinary-role access is legitimate". Worth
  one sentence in the migration header saying that in the imperative — *this table must only ever be
  reached through `withSystemContext`* — since the policy is the only thing enforcing it and the
  header is where a future reader will look.
- Task 2.4's pruning cadence is still unspecified (every write vs. probabilistic). Carried over from
  round 1 as a note, not a blocker; 4.8 constrains correctness either way.
- `V103`'s completion-token table is cited in `design.md` now, as round 1 suggested. Good.

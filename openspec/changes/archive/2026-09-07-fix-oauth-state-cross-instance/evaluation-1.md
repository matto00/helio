## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `899c7880` on `bug/oauth-csrf-state-cross-instance/hel-1019`.
All gate results below are from my own fresh runs, not the executor's report.

### Phase 1: Spec Review — FAIL

Verified good:

- The chosen design (ticket option 2, Postgres-backed state) is implemented as designed: `oauth_states` (V105), deny-all RLS + explicit `helio_privileged` grant, reached only via `ctx.withSystemContext`, with the required inline justification comment at both call sites.
- The companion-object store is **gone**, not merely unused: `AuthService.scala`'s `csrfStateStore`, `CsrfStateTtlSeconds`, `generateCsrfState`, `validateCsrfState` are all deleted from `object AuthService` (verified in the diff; `grep ConcurrentHashMap` in the file returns nothing). Task 3.1 satisfied — the new test is not vacuous for that reason.
- TTL is 300s and unchanged (`OAuthStateStore.TtlSeconds = 300L`), confirmed **live**: the row issued by the running backend had `ttl_remaining = 00:04:59.96`.
- Migration is additive only. `git diff --name-only main...HEAD -- backend/src/main/resources/db/migration` returns exactly one path, `V105__oauth_states.sql`; no applied migration was edited. V105 is applied in the shared dev DB (`flyway_schema_history` rank 105, `success=t`).
- No scope creep in the commit: `git show --stat 899c7880` touches only the 10 backend files plus the change dir. (The `frontend/**` and `.github/**` entries visible in `git diff main...HEAD` come from four dependabot commits already on `origin/main`; local `main` is simply behind. Not this change's work.)
- AC "validation precedes any code exchange" — verified in source **and** live (below).

Issues:

1. **AC1 is not met by the committed automated test.** The AC is "proven by test, not by reasoning", and the ticket explicitly warns that "a test that cannot distinguish two independent stores does not cover this defect." I ran the mutation myself, two ways, in the worktree (both reverted; `git status` clean, source byte-identical to `HEAD` afterwards):

   - **Mutant A — per-instance in-memory map** behind `OAuthStateStore`: 6 of 9 tests go red, including both cross-process tests:
     `false was not equal to true (OAuthStateRepositorySpec.scala:85)` and `(…:95)`. Red arm confirmed reachable and isolating to state lookup.
   - **Mutant B — JVM-wide (companion-object) map**, i.e. **the actual production defect shape**: **8 of 9 tests pass**, including *both* "Cross-process round trip (tasks.md 4.1)" tests. The only red is the expiry test, which fails incidentally (the out-of-band SQL `UPDATE` cannot reach an in-memory expiry), not as a state-loss signal.

   So the shipped suite proves "two repository instances do not share per-instance memory" but does **not** prove the state ever reaches Postgres. A green run of `OAuthStateRepositorySpec` is fully compatible with a re-introduced process-wide store — which is exactly the defect this ticket exists to prevent from returning. This is the `HEL-590` evidence-shaped-non-evidence class the ticket warns about, one level up.

   (Separately: the executor's quoted red-arm line, `OAuthStateRepositorySpec.scala:101`, does not correspond to the committed file. Line 101 is the *name* line of the instrument-sanity test, whose assertion is `shouldBe false` and would read "true was not equal to false". The real red lines are 85 and 95. The transcript appears to be from a pre-commit revision of the file; it should not be cited as evidence for the file as shipped.)

2. **Tasks 4.3 / 4.4 / 4.5 are marked `[x]` but only partially implemented.** All three explicitly require the *route-level* `400` with the body asserted. What is committed:
   - 4.3 forged: repository-level `shouldBe false`, plus a pre-existing route test that asserts only `message should include("state")` (`GoogleOAuthRoutesSpec.scala:222-229`) — not the body.
   - 4.4 expired: repository-level only. **No route-level test exists.**
   - 4.5 replay: repository-level only. **No route-level test exists.**

   Also, the body string written into tasks.md — `{"error":"Invalid or missing OAuth state parameter"}` — is factually wrong for this codebase. `ErrorResponse` is `jsonFormat1(ErrorResponse.apply)` over a field named `message` (`ResourceProtocol.scala:9,25`), so the wire body is `{"message":"…"}`. I confirmed this live (Phase 3). The **code** is correct and unchanged; the **task text** is wrong and should be corrected rather than left to mislead a future reader.

3. **Task 4.9 is marked `[x]` for "state value, code, or token"**, but the committed test asserts only that no log line contains the *state*. No assertion covers the authorization code or the session token. (Source reading shows neither is logged — `OAuthRoutes.scala:164` is the only log call and formats no secret — so this is a claim/coverage mismatch, not a leak.)

### Phase 2: Code Review — FAIL

Gates, re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` was not set):

- `cd backend && sbt test` → **`Suites: completed 271, aborted 0` / `Tests: succeeded 4026, failed 0` / `[success] Total time: 301 s`.** Matches the executor's count exactly.
- `npm run lint`, `npm run format:check`, `npm run typecheck` → all green (`EXIT=0`). Run for completeness; the commit itself contains no `frontend/**` change.

Verified good:

- **No blocking.** `grep "Await\.|\.result("` across the three changed main-source files returns only the comment at `OAuthRoutes.scala:106` explaining why `Await.result` was *not* used. Both call sites use `onSuccess`. (`Await` in `OAuthStateRepositorySpec` is test-harness code, correct there.)
- **Single-use is one atomic statement** (item 3). `OAuthStateRepository.validateAndConsume` is `table.filter(r => r.state === state && r.expiresAt > now).delete` — one Slick `delete`, one SQL statement, no read-then-delete. Correctness confirmed three ways: the concurrency test (`exactly one of 10 succeeds`), and live replay across two real processes (below).
- **No inline fully-qualified names** in any changed Scala (CONTRIBUTING.md); every `com.helio.*` occurrence in the changed files is an `import` or prose in a comment. No `TODO`/`FIXME` added. No dead code.
- **Security not traded for availability** — see Phase 3 for the live content assertions.
- **RLS / grant posture (item 6): certified, but not by the executor's arm.** I judged the disclosed `sk_app` substitution and it is **not sufficient on its own**: `sk_app` holds no privileges on `oauth_states` at all, so a denial for that role is ambiguous between "missing GRANT" and "deny-all policy" — it cannot distinguish the two, which is precisely what the negative arm exists to establish. I re-ran a stronger arm against the shared dev DB: created `hel1019_probe` (`NOSUPERUSER NOBYPASSRLS`), granted it `SELECT, INSERT, UPDATE, DELETE ON oauth_states` — i.e. gave it *more* than an ordinary role would need — and it was still fully denied: `SELECT` returned `0` visible rows and `INSERT` failed with `ERROR: new row violates row-level security policy for table "oauth_states"`. `relrowsecurity=t`, `relforcerowsecurity=t`, policy `oauth_states_deny_all` qual `false`. The deny-all posture holds against a grant-holding ordinary role. Probe role dropped and verified gone (`count=0`). **No change request; the gap in the executor's evidence is closed by mine.**

Issues:

4. **`design.md` states the expiry is evaluated by the database clock; the implementation uses the JVM clock.** design.md, "preserve the 300-second TTL": *"expiry is evaluated by the database clock rather than each process's clock — one fewer cross-instance skew surface."* But `OAuthStateRepository.issue` computes `Instant.now().plusSeconds(...)` in the JVM and `validateAndConsume` binds a JVM `Instant.now()` into the `expires_at > ?` predicate. Every timestamp on both the write and the read path is process-local; the claimed skew property does not exist as shipped. Either use SQL `now()` in the predicate (and `now() + interval` on insert) or correct the design record. This is the confidently-false-documentation pattern this repo has been bitten by repeatedly.

5. **The `DELETE … RETURNING` claim is not what the code emits.** The Scaladoc on `validateAndConsume` and `files-modified.md` both say `DELETE … RETURNING`; Slick's `.delete` emits a plain `DELETE … WHERE …` and the code branches on the affected-row count (`.map(_ > 0)`). The behaviour is right and equally atomic — but the comment describes SQL that is not generated, and a future reader grepping for `RETURNING` will not find it.

6. **A reference to a spec that does not exist.** `GoogleOAuthRoutesSpec.scala:84` points a future reader at `OAuthStateRepositoryCrossProcessSpec`. The file is `OAuthStateRepositorySpec`. No such class exists anywhere in the tree.

Non-blocking (listed under Suggestions).

### Phase 3: UI Review — PASS

Servers started via the canonical script (`READY backend=http://localhost:9358/health`, `READY frontend=http://localhost:6451`). Per CON-155 I did **not** trust the health probe as proof of binary freshness; I verified it functionally: `oauth_states` was empty, `GET /api/auth/google` returned `302` with `state=e53dc2a1…`, and a matching row then existed in Postgres. Only the post-fix binary writes that row, so the loaded binary is the one under review.

To test the actual acceptance criterion I started a **second, genuinely separate backend JVM** (`PORT=9359`) from the same worktree against the same Postgres, giving two real processes exactly as production runs two Cloud Run instances.

| Check | Result |
|---|---|
| Initiation on A, callback on **B** (different process) | State accepted; request proceeded past the state gate into the code exchange (`500` from the deliberately bogus code) — **no** state `400`. Cross-process round trip works against real processes. |
| Replay of that same state on **A** | `400` `{"message":"Invalid or missing OAuth state parameter"}` — single-use holds **across** processes |
| Forged / never-issued state | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| Missing `state` parameter | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| Expired state (issued on B, `expires_at` backdated, callback on A) | `400` `{"message":"Invalid or missing OAuth state parameter"}` |
| Ordering | The bogus-code request reached the exchange only *after* the state check; every rejected case returned the state `400` and never exchanged. Validation precedes exchange. |

Bodies asserted, not just status codes. The exact body is `{"message":"Invalid or missing OAuth state parameter"}` — byte-identical to the pre-fix behaviour (the field is `message`, not `error`; see Phase 1 issue 2).

**The production fix itself is functionally correct and I have direct two-process evidence for it.** The Phase-1 failure is about the durability of that proof as an automated regression guard, not about the runtime behaviour.

Shared-DB hygiene: every row I created was consumed or deleted; `select count(*) from oauth_states` → `0`, confirmed by query. The scratch role was dropped (verified). The scratch backend on 9359 was stopped (port no longer listening); the delivery servers on 9358/6451 are untouched and still up.

### Overall: FAIL

### Change Requests

1. **Make `OAuthStateRepositorySpec` able to kill the JVM-wide-store mutant** (`backend/src/test/scala/com/helio/infrastructure/persistence/auth/OAuthStateRepositorySpec.scala`). The suite must fail if the state never reaches Postgres. Two small additions, both using the `readRow`-style out-of-band connection the file already has (lift it out of the `Pruning` block to spec scope):
   - After `issuer.issue()` in the 4.1 cross-process test, assert the row is actually in the table: `readRow(state) shouldBe defined`.
   - Add a durability-negative test: issue a state, delete it out-of-band (`DELETE FROM oauth_states WHERE state = $state` on a separate connection), then assert `validator.validateAndConsume(state) shouldBe false`. An in-memory store — per-instance *or* JVM-wide — cannot pass this.
   Then re-run the mutation with a **companion-object** `ConcurrentHashMap` (not a per-instance one) and show it goes red; record that transcript. The per-instance mutant is the easy arm and it is already proven — the process-wide one is the arm that matches the actual defect.

2. **Add the route-level tests tasks 4.4 and 4.5 claim** to `GoogleOAuthRoutesSpec`, and assert the body rather than a substring:
   - expired: issue via `GET /api/auth/google`, backdate `expires_at` for that state via the spec's `db`, call the callback, assert `status == BadRequest` **and** `responseAs[ErrorResponse].message shouldBe "Invalid or missing OAuth state parameter"`.
   - replay: issue once, call the callback twice with the same state, assert the second is that exact `400` body.
   Tighten the existing forged (`:222-229`) and missing (`:211-218`) tests from `should include("state")` to the same `shouldBe` full-message assertion.

3. **Correct `tasks.md` 4.3/4.4/4.5**: the expected body is `{"message":"Invalid or missing OAuth state parameter"}`, not `{"error":…}`. `ErrorResponse` serialises its single field as `message` (`ResourceProtocol.scala:9,25`); I confirmed the wire shape live. Leaving the wrong literal in the artifact will send the next reader looking for a bug that is not there.

4. **Resolve the design/implementation clock mismatch.** Either change `OAuthStateRepository.validateAndConsume` (and `issue`) to use SQL `now()` so the claim in `design.md` ("expiry is evaluated by the database clock … one fewer cross-instance skew surface") becomes true, or amend that paragraph in `design.md` to say the expiry timestamp is computed and compared on the JVM clock. Do not leave the record asserting a property the code does not have.

5. **Fix the two inaccurate references:**
   - `OAuthStateRepository.scala` (Scaladoc on `validateAndConsume`) and `files-modified.md`: the emitted SQL is `DELETE … WHERE …` with an affected-row-count check, not `DELETE … RETURNING`. Describe what Slick actually generates, and keep the atomicity argument (it is correct).
   - `GoogleOAuthRoutesSpec.scala:84`: `OAuthStateRepositoryCrossProcessSpec` does not exist — the spec is `OAuthStateRepositorySpec`.

6. **Correct or complete task 4.9.** Either extend the log-capture test to assert the authorization code and the session token are absent from the captured records too, or narrow the task text to what is actually asserted (the state value). Currently the task claims coverage the test does not provide.

### Non-blocking Suggestions

- `OAuthStateRepositorySpec.newRepository()` and `readRow` each call `JdbcBackend.Database.forDataSource(...)` and never close the resulting pool; a run leaks roughly twenty pools (the `Concurrent validation` case alone builds ten). It passes today and finishes in ~2s, but it is an avoidable connection/thread leak in a shared harness — close them, or hold one pool per repository and close in `afterAll`.
- `stateStore` is a required constructor parameter placed *after* the defaulted `auditService`, which forces every caller to either pass `auditService` positionally or use the named form (`AuthServiceSpec` already does the latter). Moving the required parameter ahead of the defaulted one would remove that trap for the next call site.
- The `Pruning` test would still pass if pruning were removed entirely for the in-memory case; consider asserting the unexpired row is *still present* via `readRow` before consuming it, so the test distinguishes "pruned correctly" from "nothing was ever stored".
- Local `main` is four dependabot commits behind `origin/main`, which is why `git diff main...HEAD` shows unrelated `frontend/**` and `.github/**` churn. Nothing to fix in this change; worth knowing before reading the PR diff.

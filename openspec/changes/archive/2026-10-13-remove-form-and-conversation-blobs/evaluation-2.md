## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed commit:** `05db0333d9a8279001ff5d9cf0679e27646b5c7f`.
- **Diff base:** `67cf9e0e0451b781be463e82db25c57a8c8795bf`, resolved live.
- **Changes since cycle 1 (`0cb6eebf8..05db0333d`):**
  - `FormAndConversationObjectDrainSpec.scala`: +3 tests.
  - `pr-owner-review.md`, `measurements.md` and `files-modified.md`.
  - `evaluation-1.md`, which the executor committed.
  - No file under `backend/src/main` changed.

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are resolved.

- **CR1 (AC3 coverage): resolved.**
  - Two tests were added under "the extended shared-key guard": one for `binary_refs` and one for `node_payload_history`. Each keeps the key while the copy exists, then deletes it after the copy goes and a pass runs past the deferral.
  - I re-ran the mutations myself in a throwaway detached worktree at `05db0333d`, never in the executor's worktree. I removed the worktree afterwards and confirmed with `git worktree list` that it is gone.
  - **M1:** neutralised the `binary_refs` clause in `derivedAction` (`WHERE FALSE AND EXISTS ...`).
  - **M2:** removed `("node_payload_history", "rows")` from `scans`.
  - **Result under M1+M2:** exactly those two tests failed, and the other 18 passed.
- **CR2 (AC7 prod queries): resolved.**
  - `pr-owner-review.md` now says the queries must run as a BYPASSRLS role and explains why.
  - It lists every FORCE-RLS table involved.
  - The query block is wrapped in `BEGIN READ ONLY; SET ROLE helio_privileged; ... ROLLBACK;`.
  - It adds sanity query 0 (`current_user, rolbypassrls`) and a stop rule: under a non-bypass role, a 0 means RLS hid the rows.
  - `SET ROLE helio_privileged` works for the prod migrating/app role `helio`. That role is a member of `helio_privileged` through V34 (as cited in `V130__...sql:28`), and `helio_privileged` holds blanket SELECT through V38. So the queries are read-only and give correct counts.
  - The block stays read-only: no write statement, and it ends in `ROLLBACK`.
  - Query 1 now applies the trigger's exact form-upload regex, as cycle 1 suggested.
- **Constraints:** C1, C2 and C3 are still honoured. No migration or main-code change since cycle 1.

### Phase 2: Code Review — PASS

**Gates (fresh runs at `05db0333d`):**
- `FormAndConversationObjectDrainSpec`: 20/20 passed. This is the only spec whose content changed.
- The full backend suite was run in cycle 1 on identical `backend/src/main` code: 593 suites, 7816 tests passed, 0 failed. The only change since then is the three added test cases in this spec, so I did not repeat the 6-shard run.
- `check:scala-quality`, `check:openspec`, `check:test-temp-dir-hygiene` and `format:check` are clean.

**The new classify-failure test:**
- The test asserts that a pass whose guard query fails returns 0, keeps the object, and leaves the row queued with `attempts = 0`. After the 300 s lease expires, a healthy pass deletes it.
- **M3:** I changed the service to recover a `classify` failure as `Unreferenced` for every key. Only that test went red, 1 of 20.
- This pins the cycle-1 deviation 5 behaviour: a guard failure never leads to a delete.

**Dev DB:** checked read-only after this cycle. Flyway head is still 131 and `stored_object_deletions` holds 0 rows. V132 was not applied by me or by the executor's runs.

### Phase 3: UI Review — N/A (justified, unchanged from cycle 1)

- Nothing in the UI trigger set changed this cycle.
- The `ApiRoutes.scala` wiring is a single constructor argument. `FormSubmitRoutesSpec` already exercises it through a real `new ApiRoutes(...)`.
- No servers were started. Booting the backend would apply this unmerged, parked V132 to the shared dev DB.

### Overall: PASS

### Non-blocking Suggestions

- **`pr-owner-review.md`:** the prose offers "the Cloud SQL `postgres` admin" as an alternative, but the SQL block always runs `SET ROLE helio_privileged`. Cloud SQL's `postgres` user is not necessarily a member of that role. Run as `postgres`, the `SET ROLE` would fail with a visible permission error rather than miscount, so this is a clarity issue only. Say "with the `postgres` admin, omit the `SET ROLE` line".
- **`measurements.md` 110k note:**
  - The note says the TRUNCATE queued 10,000 keys, "the distinct keys of the rows still present". The same table describes about 30k rows carrying a key, so this only reconciles if those rows share 10k distinct keys.
  - The throwaway spec that produced it was deleted, so this cannot be re-checked.
  - It is not load-bearing for any claim. It is per-spec embedded Postgres, and the dev DB was confirmed untouched.

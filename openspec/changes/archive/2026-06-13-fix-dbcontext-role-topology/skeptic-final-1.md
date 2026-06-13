## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**1. Ticket acceptance criteria (from Linear HEL-285)**

Three ACs:
- AC1: A test fails if `helio_privileged` lacks the privileges it needs to run `withSystemContext` DML on any ACL'd table.
- AC2: The privileged-pool `SET ROLE` path is genuinely exercised (not collapsed onto a superuser datasource).
- AC3: CI would catch the class of bug that V38 fixed before it reaches a real deployment.

**2. Diff review**

Read `git diff main...HEAD` in full. The substantive change is a single new file:
`backend/src/test/scala/com/helio/infrastructure/RlsPrivilegedDmlSpec.scala`

The diff also includes `.claude/agents/linear-orchestrator.md`, `.claude/commands/linear-ticket-delivery.md`,
`notes/orchestration-iron-laws-handoff.md`, and two `openspec/` archive/spec files —
none of which affect the functional claim.

**3. Test execution — `sbt "testOnly com.helio.infrastructure.RlsPrivilegedDmlSpec"`**

```
[info] Run completed in 1 second, 598 milliseconds.
[info] Total number of tests run: 15
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 15, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 2 s, completed Jun 13, 2026, 11:49:22 AM
```

All 15 tests pass (role sanity check, 9-table INSERT coverage, UPDATE/DELETE on
data_sources and dashboards, RLS spot-check).

**4. Full backend suite — `sbt test`**

```
[info] Run completed in 39 seconds, 332 milliseconds.
[info] Total number of tests run: 824
[info] Suites: completed 50, aborted 0
[info] Tests: succeeded 824, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 40 s, completed Jun 13, 2026, 11:50:31 AM
```

No regressions.

**5. AC2 check — two-role topology genuinely exercised**

Confirmed. `RlsPrivilegedDmlSpec.beforeAll` constructs:
- `privilegedDb`: HikariCP with `connectionInitSql = "SET ROLE helio_privileged"` wrapping the EmbeddedPostgres datasource.
- `appDb`: HikariCP with `connectionInitSql = "SET ROLE helio_app_test"` (non-superuser, non-BYPASSRLS) wrapping the same datasource.
- `ctx = new DbContext(appDb, privilegedDb)` — exactly mirroring production topology.

The role sanity check (`withSystemContext SELECT current_role` → `helio_privileged`) passes, confirming the SET ROLE path fires.

AC2: SATISFIED.

**6. AC1 and AC3 check — the self-grant problem**

Read `RlsPrivilegedDmlSpec.scala` lines 88–93:

```scala
// helio_privileged also needs explicit table access — V38 ran this, but
// adding it here makes the test self-contained and proves the grant is present.
stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
```

The `beforeAll` block grants the DML permissions to `helio_privileged` itself, as a superuser, *in addition to* running Flyway (which applies V38's grants). This means:

- If V38 is reverted or never applied: the `beforeAll` re-grant still fires, and all DML tests pass. The test cannot detect a missing V38.
- Ticket AC1 says "a test fails if `helio_privileged` lacks the privileges it needs." But the test ensures those privileges are present regardless of V38, so it will never fail due to a missing privilege grant in migrations.
- Ticket AC3 says "CI would catch the class of bug that V38 fixed." V38 fixed a missing-GRANT bug. The test does not catch a regression to that state because it self-heals via `beforeAll`.

This is a structural defect in the test's regression-detection capability. The test verifies the *execution path* works when grants exist, but it does not verify that the *migration* establishes those grants.

AC1: PARTIALLY SATISFIED — the test is a DML reachability test, not a privilege-regression test.
AC3: NOT SATISFIED — CI would not catch V38 being reverted.

**7. No frontend changes**

No `frontend/` files in the diff. UI/design judgment skipped.

---

### Verdict: REFUTE

### Change Requests

1. **Remove the `helio_privileged` re-grant from `beforeAll`** (`RlsPrivilegedDmlSpec.scala` lines 90–93). The test should rely entirely on Flyway running V38 to establish `helio_privileged`'s DML privileges. The comment at line 88 explicitly says "V38 already ran them" — but the re-grant defeats the test's purpose by making the spec pass even when V38 is absent. Removing those four `stmt.execute` lines (while keeping the `helio_app_test` grants which are test-harness setup not covered by any migration) will make AC1 and AC3 hold: if V38 is reverted, the DML INSERTs will raise `permission denied for table` and the test will fail.

### Non-blocking notes

- The `helio_app_test` grants in `beforeAll` (lines 82–87) are correct to keep: `helio_app_test` is a test-only role with no corresponding migration, so the test must establish those grants itself.
- The `GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged` (line 93) may also need to stay if that function grant is not covered by V38. Check V38 content — if V38 does not grant function-level EXECUTE to `helio_privileged`, this one line is legitimate test-harness setup and should remain. Only the table/sequence DML grants (lines 90–92) are the problem.

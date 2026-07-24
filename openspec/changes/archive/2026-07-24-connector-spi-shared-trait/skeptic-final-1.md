## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ticket/proposal/design/spec/tasks read in full**
   `openspec/changes/connector-spi-shared-trait/{ticket,proposal,design,tasks}.md` and
   `specs/connector-spi/spec.md`. Confirmed the trait shape, EC-threading decision (Decision 6),
   and sibling-ownership map (HEL-473/468/460/480/484) are self-consistent and match what the code
   does.

2. **Diff scope** — `git diff 67cdee16f949ac45aaa6b8e6bd0ccb5761ec90c2...HEAD --name-only` outside
   `openspec/changes/`: only `backend/src/main/scala/com/helio/domain/{Connector,RestApiConnector,
   SqlConnector}.scala` and 3 new/modified test files. `SourceService.scala` untouched (`git diff
   ...-- backend/src/main/scala/com/helio/services/SourceService.scala` empty). No migrations, no
   schema files, no frontend files, no route files. Matches proposal's stated impact exactly.

3. **Zero behavior change to existing methods** — read `SqlConnector.scala` and
   `RestApiConnector.scala` in full post-change. `checkQuery`, `buildJdbcUrl`, `connect`, `execute`,
   `inferSchema(rows)`, `toRows(rows)` (SQL) and `fetch(config)`, `toRows(json)`, `buildAuthHeaders`,
   `injectQueryParam` (REST) are byte-for-byte unmodified in the diff — only additive members
   appended below the existing method set.

4. **`buildRequest` extraction (RestApiConnector)** — direct before/after comparison of `doFetch`:
   URI construction (`Uri(config.url)` → `injectQueryParam`), method resolution
   (`HttpMethods.getForKey(...).getOrElse(HttpMethods.GET)`), header merge order (`authHeaders ++
   baseHeaders`) are identical, only hoisted into a private `buildRequest(config)` helper called by
   both `doFetch` and the new `testConnection`. `doFetch`'s post-request logic (status check,
   `parseJson`, error strings `"Failed to parse JSON response"` / `HTTP $status: $body` /
   `"Request failed"`) is untouched. Genuinely behavior-preserving.

5. **No internally-sourced `ExecutionContext`** — `grep -rn "ExecutionContext.global"` across the
   three changed main-source files: the only hit is inside a doc comment in `Connector.scala:39`
   describing the *forbidden* pattern, not code. Every `Future`-returning trait method
   (`testConnection`/`inferSchema`/`fetch` on both connectors) declares `(implicit ec:
   ExecutionContext)` and either uses it directly (`SqlConnector.testConnection`'s
   `Future { blocking { ... } }`) or forwards it (`inferSchema`/`fetch` → `execute`/`fetch`). REST's
   pre-existing internal `fetch(config)`/`doFetch` continue to use the class's own
   `system.executionContext` — this is pre-existing, unmodified behavior (not new EC sourcing), and
   is non-blocking async I/O, so it doesn't carry the dispatcher-starvation risk the design doc
   flags specifically for SQL's blocking JDBC path. Consistent with design.md Decision 6's own
   reasoning.

6. **SQL `testConnection` non-execution proof** — `SqlConnectorSpec.scala`'s `liveConfig()` defaults
   `query = "NOT VALID SQL AT ALL"`, run against a real `EmbeddedPostgres` instance. Confirmed by
   reading `SqlConnector.execute` that `prepareStatement(config.query)` + `stmt.executeQuery()` would
   throw a syntax error on that string if actually sent — `testConnection`'s implementation only
   calls `connect(config).close()`, no `prepareStatement`/`executeQuery` anywhere in that method.
   Ran the test fresh (see below): passes, and a second test forces `port = 1` (unreachable) and
   asserts `Left("SQL connection failed")` — proving the open+close path is genuinely exercised in
   both directions, not just returning `Right` unconditionally.

7. **CONTRIBUTING.md compliance** — `npm run check:scala-quality` fresh run: clean (57 pre-existing
   soft file-size warnings, none in the new/changed files). Manual grep for `ExecutionContext.global`
   confirmed no inline-FQN violations in code (only doc comments). File sizes: `Connector.scala` 57
   lines, `SqlConnector.scala` 145, `RestApiConnector.scala` 140, `ConnectorSpec.scala` 91,
   `RestApiConnectorSpec.scala` 129, `SqlConnectorSpec.scala` 217 — all well under the 250-line soft
   budget.

8. **tasks.md 13/13 genuinely implemented** — traced each of 1.1, 2.1–2.4, 3.1–3.4, 4.1–4.4 against
   the actual diff (not the checkboxes): trait+metadata (1.1) in `Connector.scala`; SqlConnector
   `extends`/metadata/testConnection/inferSchema+fetch (2.1–2.4) all present with matching doc
   comments; RestApiConnector `extends`/metadata/testConnection/inferSchema+fetch (3.1–3.4) all
   present, `buildRequest` reuse confirmed; fixture connector + dispatch tests, SqlConnector-as-
   Connector tests, RestApiConnector-as-Connector tests, and the full regression-suite re-run (4.1–
   4.4) all present as real test code with real assertions (not stubs).

9. **Fresh gate re-runs (all executed by me, not trusted from evaluator's paste):**
   - `npm run check:scala-quality` → clean (57 pre-existing warnings, none new).
   - `npm run check:schemas` → clean (18 protocols / 7 enum surfaces).
   - `npm run lint` → 0 warnings.
   - `npm run format:check` → clean.
   - `sbt testOnly com.helio.domain.{ConnectorSpec,RestApiConnectorSpec,SqlConnectorSpec}` → 37/37
     pass, including the SQL non-execution test (observed the expected `PSQLException: Connection
     to localhost:1 refused` log line for the failure-path test, confirming a real connection
     attempt, not a mock).
   - `sbt testOnly` targeted re-run of `DataSourceServiceSpec`, `DataSourceServiceRestartPersistenceSpec`,
     `DataSourceRoutesSpec` (`com.helio.api.DataSourceRoutesSpec`), `SchemaInferenceRegressionSpec`
     (`com.helio.services.SchemaInferenceRegressionSpec`) → 109/109 pass.
   - Full `sbt test` → **94 suites / 1717 tests, all passing.**
   - `npm test` (root jest + frontend jest) → **118 suites / 1239 tests, all passing.**

10. **Acceptance criteria traced individually** against `ticket.md`'s list — trait compiles and both
    connectors reachable through it (proven by `ConnectorSpec`/`SqlConnectorSpec`/
    `RestApiConnectorSpec` referencing the trait type + full compile via `sbt test`); existing
    REST/SQL behavior unchanged (`SourceService` untouched, full backend suite green); read-only SQL
    enforcement untouched (`checkQuery` unmodified, its existing tests still pass in the full suite);
    credential redaction untouched (`DataSourceProtocol.scala` not in the diff); new SPI test
    coverage present; no wire/DB-shape change (no migrations, `check:schemas` clean). All traceable
    to real evidence, none merely asserted.

11. **Commit-hygiene bypass disclosure (item 7 of the brief)** — walked every commit
    `67cdee16..HEAD` with `git log -1 --format='%B'`. Four commits bypass hooks
    (`fadd2750`, `0c2ad753`, `9670cd26`, `ad60334c`); each discloses the reason in its body
    (`npm run check:openspec` failing on "13/13 complete but not archived", the expected
    Delivery-phase-archiving gap). Confirmed the claim is currently true by running
    `npm run check:openspec` myself: it does fail with exactly that message
    (`change "connector-spi-shared-trait" is complete (13/13) but not archived`). Matches
    CONTRIBUTING.md:131/152's bypass-disclosure policy. All other commits in the branch's history
    ran hooks normally (no bypass note in body).

12. **No UI changes** — `git diff --name-only` confirms zero `frontend/**` touches; DESIGN.md is not
    applicable to this change. No browser verification needed for a backend-internal SPI ticket.

### Verdict: CONFIRM

### Non-blocking notes
- `RestApiConnector`'s new trait methods (`inferSchema`, `fetch(config, maxRows)`) accept a
  caller-supplied `implicit ec` but delegate through the pre-existing `fetch(config)`/`doFetch`,
  which still runs its internal Future chain on the class's own `system.executionContext` rather
  than the passed-in `ec`. This is pre-existing, unmodified behavior (not a new internal EC source)
  and is non-blocking I/O, so it carries none of the dispatcher-starvation risk the design doc
  flags for SQL specifically — but a future sibling ticket (HEL-473, when it wires `SourceService`
  through the trait polymorphically) should be aware the REST path's threading convention is
  "caller `ec` for the trait-level wrapper, class `ec` for the underlying async I/O" rather than a
  single EC end-to-end, in case that distinction ever matters for cross-connector consistency.

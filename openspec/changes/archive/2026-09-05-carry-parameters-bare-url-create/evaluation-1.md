## Evaluation Report — Cycle 1 (evaluation-1.md)

Review surface: commit `9407b8a4` only. NOTE: `git diff main...HEAD` in this worktree is
misleading — the local `main` ref (`56875fdc`) is stale relative to `origin/main`
(`431d86de`), so that diff drags in already-merged HEL-982/HEL-984/Concertino-sync work.
The ticket's actual change is `SourceService.scala` (+5/-1), one new test spec, and the
change dir. Verified via `git show --stat 9407b8a4`.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- AC1 (bare-url create persists `parameters`, fetch resolves placeholders, proven against a
  real HTTP server asserting query string AND headers) — met. `SourceServiceBareUrlParametersSpec`
  asserts `receivedQuery shouldBe "account=acct-42"` and `receivedHeader shouldBe Some("acct-42")`,
  both written only by the bound Pekko route handler, plus the secondary persisted-map assertion.
- AC2 (red test demonstrates the drop before the fix) — met and independently reproduced by me
  (see Phase 2).
- Fix matches design D1 exactly: `parameters = request.config.parameters.getOrElse(Map.empty)`,
  mirroring the sibling `headers` idiom on the same constructor.
- Spec delta updates the `rest-api-connector` templating requirement as MODIFIED with a matching
  new scenario, and preserves the ephemeral bare-`url` carve-out rather than contradicting it.
- No scope creep: the commit touches exactly the two code paths the proposal names.
- Constraint honored: **no Flyway migration added** (`git show --name-only 9407b8a4 | grep -i migration`
  → none). The spec uses its own `EmbeddedPostgres` + Flyway, so the shared dev Postgres and the
  concurrent HEL-987/HEL-985 runs are untouched.
- Task 2.2 sibling-construction audit: conclusion is correct, but see Non-blocking #1.

### Phase 2: Code Review — PASS

Gates re-run by me from scratch in `WORKTREE_PATH` (not trusting the executor's report):

| Gate | Result |
| --- | --- |
| `sbt test` (full backend) | **PASS** — 254 suites, 3834 tests, 0 failed |
| `npm run check:scala-quality` | **PASS** — clean (155 pre-existing soft warnings, none in new file) |
| `npm run check:openspec` | **PASS** |
| `npm run check:spec-structure` | **PASS** — 349 specs, 0 issues |
| `npm run check:schemas` | **PASS** — schemas in sync |
| `npm run format:check` | **PASS** |

Frontend gates N/A — no `frontend/**` file in the commit.

Named regression anchors all executed and green: `SourceServiceBareUrlQueryParamsSpec`,
`SourceServiceSpec`, `RestApiConnectorDriverTemplatingSpec`, `DataSourceRoutesSpec`.

**Guard-quality audit (the ticket's focus) — independently verified, not taken on trust:**

1. **Asserts on a real bound server, not just the persisted map.** The `fetchOverride` at spec
   line 97 is wired only into the `SourceService` used for *creation*; the acceptance-bearing
   fetch at line 130-131 constructs a separate `RestApiConnectorDriver` with
   `connectorRepoOpt`/`credentialRepoOpt` and **no** `fetchOverride`, resolving the same persisted
   Connector/config. So the driver is not short-circuited on the assertion path.

2. **Genuinely red when the fix is reverted.** I reverted only the `parameters` line and re-ran:
   ```
   SourceServiceBareUrlParametersSpec ... *** FAILED ***
     Left("Unresolved template variable: accountId") was not an instance of scala.util.Right,
     but an instance of scala.util.Left (SourceServiceBareUrlParametersSpec.scala:132)
   ```
   This is the defect's true signature (HEL-823's unresolved-variable guard), not a compile error
   or fixture mismatch. Matches the executor's claim. Fix restored; `git status` clean afterward.

3. **The server-received assertions are themselves failable** — this is the check that closes the
   "evidence-shaped non-evidence" risk. Because the revert aborts at line 132 (`shouldBe a[Right]`)
   *before* reaching lines 133-134, the red above does not by itself prove the query/header
   assertions do any work. So I ran a second, independent mutation: made the fix store
   `parameters` with **wrong values** (`k -> "WRONG"`), which resolves cleanly and yields a `Right`.
   Result:
   ```
   "account=[WRONG]" was not equal to "account=[acct-42]"
     (SourceServiceBareUrlParametersSpec.scala:133)
   ```
   This proves line 133 observes what the real server actually received and would catch a
   "stores the map but resolves it wrong" fix — exactly the failure mode design D5 targets.

4. **No vacuous-pass path found.** The fetch is `Await`-ed through the spec's `await` helper
   (10s), so no assertion hides inside an un-awaited `Future`. `receivedQuery`/`receivedHeader`
   are `@volatile` and initialized to `""`/`None`, which cannot coincidentally equal the expected
   values, so a never-issued request fails rather than passes. Mutation #3 further confirms the
   observed request originates from the real driver fetch of the *persisted* config, not from any
   create-time call.

Code-quality checks: DRY (harness duplication is a deliberate, design-D2-documented trade-off),
no dead code, no TODO/FIXME, no untyped escape hatches, no magic values, comment explains *why*
per CONTRIBUTING's comment standard. The inline-FQN mechanical rule is enforced by
`check:scala-quality`, which passed. New spec is 141 lines, within the ~250-line soft budget.
The `admitLocalhost` `isBlocked` override is test-scoped and does not weaken production SSRF
guarding — `isBlocked` is a pre-existing driver parameter, unchanged by this commit.

### Phase 3: UI Review — N/A

No UI-affecting file in the commit: no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no
`openspec/specs/**` (the spec delta lives under `openspec/changes/`, which is not a trigger).

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. **Task 2.2's finding was never recorded anywhere.** The box is checked, but neither
   `files-modified.md` nor any report states the sibling-construction enumeration, so
   "I checked" is not auditable — which is precisely what skeptic-design-1.md's non-blocking
   note #1 asked for. I verified the conclusion myself and it is **correct**: of the other
   `RestApiConfig(...)` sites, `DataSourceProtocol.scala:390` already carries `parameters`,
   `DataSourceConfigCodec`/`DataSourceRepository:58` are decode/sentinel,
   `RestApiConnectorDriver.scala:441` is the ephemeral `fetchOverride` path (an explicit
   non-goal), and `RestSourceConnectorMigration.scala:141` reconstructs from
   `LegacyRestApiConfigPayload`, a `jsonFormat4` shape with **no** `parameters` field — so there
   is nothing to carry and no sibling defect. Worth writing down for the PR description.
2. Skeptic note #2 (record *which* red signature was observed) is satisfied by the commit
   message, which names `Left("Unresolved template variable: accountId")` — the only form the
   driver's guard can produce. No action needed.
3. `import java.net.InetAddress` sits at spec line 5, in the middle of the `com.helio` import
   group, while the file's other `java.*` import (`java.util.UUID`) is grouped at line 26.
   Purely cosmetic; violates no rule in CONTRIBUTING.md and no mechanical gate.
4. The header assertion (line 134) is corroborating rather than independently mutatable — the
   same `parameters` map drives both the query and header placeholders, so no production-code
   mutation can break the header without first breaking line 133. This is inherent to the
   defect's shape, not a weakness in the test.

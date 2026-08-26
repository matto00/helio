## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket acceptance criteria are addressed explicitly:
  1. Committed teardown writes exactly one audit row with correct action (`workspace.teardown`), resourceType (`workspace`), actor id, tokenId, source — covered by `AuditMutationInstrumentationSpec.scala` new test 2.1, verified passing.
  2. Row metadata carries `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted` — verified in the same test.
  3. Integration test asserts no row for dryRun — test 2.2, using the barrier technique.
  4. Integration test asserts no row for blocked — test 2.3, using the barrier technique.
  5. dry-run/blocked recording decision documented explicitly in design.md Decision 1 — present and detailed, including the non-obvious "dryRun still computes non-zero counts" subtlety.
  6. `auditService` wired through `ApiRoutes.scala` at the `workspaceTeardownServiceOpt` construction site, null-default no-op path intact (`auditService: AuditService = null` in `WorkspaceTeardownService`'s constructor) — confirmed in diff.
- No AC silently reinterpreted.
- tasks.md items 1.1–1.4, 2.1–2.4 all marked done and match the diff.
- No scope creep: the diff touches exactly `WorkspaceTeardownService.scala`, `ApiRoutes.scala`, the test spec, and change-dir docs. HEL-840's explicitly out-of-scope services (`DataSourceService.refresh`, `SourceService.refresh`, `AuthService.completeOAuth`) are untouched.
- No regressions to other specs — full backend suite (3463 tests) passes.
- No API-contract/schema changes needed or made (audit metadata is a free-form JSON column per design.md Risks section, confirmed no CHECK/enum on `resource_type`).
- Planning artifacts (proposal/design/tasks/spec) accurately reflect the final implemented behavior; spec.md scenarios match the shipped gating logic exactly.

### Phase 2: Code Review — PASS
Issues: none.

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set, default speed):
- `npm run check:scala-quality` → "Scala code-quality check: clean (135 soft warning(s))" — all soft warnings are pre-existing file-size items unrelated to this change (informational only per CONTRIBUTING.md:142); no inline-FQN violations in the diff (uses `spray.json._`).
- `sbt test` (full backend suite, run fresh) → 3463/3463 passed, 0 failed, 220 suites completed.
- `testOnly com.helio.api.AuditMutationInstrumentationSpec` run in isolation first → 26/26 passed, including the 4 new HEL-838 tests.

Checklist:
- Canonical code-quality compliance ([mechanical]): no violations found. Imports are top-of-file (`spray.json._`, `com.helio.services.audit.AuditService`), no inline FQNs introduced.
- DRY: the `audit(...)` helper mirrors `DashboardService`'s established pattern exactly, as directed by the ticket; no duplicated logic.
- Readable: `audit()` call site is clearly gated (`if (outcome.committed)`) with an inline comment citing design.md Decision 1; metadata keys match ticket's named fields.
- Modular: change is a small, additive diff to one service + one wiring site; no new abstractions introduced.
- Type safety: `AuditService` param is properly typed; `JsObject`/`JsNumber` metadata construction is typed via spray-json, no `Any`/untyped escape hatches.
- Security: no new input surface — the tag/metadata already flow through existing validated `TeardownRequest`; no injection concerns (audit metadata is structured JSON, not string-concatenated).
- Error handling: `audit()` is fire-and-forget on `AuditService.record` (an established, already-audited pattern per HEL-477); a prior test ("should never fail the underlying mutation when the audit repository's append fails") already covers this failure-isolation property generically, and HEL-838 doesn't need to re-prove it per-service.
- Tests meaningful: the 4 new tests exercise the real HTTP route end-to-end through the actual `ApiRoutes`-constructed service, assert on both the HTTP response body and the persisted audit row (action/resourceType/actor/metadata), and would catch a real regression (e.g. reverting the `committed` gate, or breaking the `ApiRoutes` wiring at task 1.4).
- No dead code: the unused `dataSourceId` in test 2.1 is explicitly documented with a comment explaining it's retained only to describe the fixture shape (not literally dead — it's asserted `should not be empty`); no leftover TODO/FIXME.
- No over-engineering: `audit()` helper is minimal, matches existing sibling-service pattern exactly, no premature abstraction.
- Behavior-preserving: this is a pure additive instrumentation change, not a refactor; the `teardown` control flow (transaction → cleanupFiles → response) is unchanged except for the inserted `audit()` call, which is fire-and-forget and does not block or alter the returned `Future`.

**Verification of the four specific scrutiny points requested:**
1. **Gated strictly on `outcome.committed`, never on nonzero counts** — confirmed in the diff: `if (outcome.committed) audit(...)`. No count-based conditional exists. Test 2.1's second variant (all-zero-match tag) explicitly proves a committed-but-all-zero-counts teardown still writes a row, and tests 2.2/2.3 prove uncommitted (dryRun/blocked) calls — even though dryRun computes nonzero counts per design.md Decision 1 — never write a row.
2. **Exactly one row per teardown call** — the `audit()` call appears exactly once in the `teardown` method body, invoked at most once per call (single `if` branch, no loop). Test 2.1 asserts `rows should have size 1`.
3. **Negative-assertion barrier technique** — confirmed genuine, not naive: tests 2.2/2.3 first perform the dryRun/blocked call, then issue a second real committed teardown (`barrierTag`) and call `eventuallyAuditRows` on that row (a polling helper, confirmed present at `AuditMutationInstrumentationSpec.scala:218`, pre-existing from HEL-477) before asserting `allAuditRows().count(...) shouldBe 0` for the original dryRun/blocked tag. This matches design.md's Test Plan exactly and is not an immediate/unfalsifiable assertion.
4. **Real ApiRoutes-constructed service via HTTP** — `dbContext` field was added and threaded into `routesFor()`'s `ApiRoutes(...)` construction (confirmed in diff), which is what makes `workspaceTeardownServiceOpt` resolve to `Some(...)` and mounts `POST /api/workspace/teardown` in this route-level spec. All 4 new tests use `Post("/api/workspace/teardown", ...) ~> routesFor() ~> check { ... }` — real HTTP through the real route tree, not a test-local `new WorkspaceTeardownService(...)` construction. This means a regression at task 1.4's `ApiRoutes.scala` wiring site would be caught by these tests, as design.md's Test Plan requires.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala` (route additions only, not the trigger path — note: `ApiRoutes.scala` was touched but only for constructor-arg wiring, not a route/schema/spec surface change), `schemas/**`, or `openspec/specs/**` changes. This is a pure backend audit-instrumentation change with no UI-observable surface. Per the task instructions, Phase 3 is explicitly marked N/A for this change.

### Overall: PASS

### Non-blocking Suggestions
- None.

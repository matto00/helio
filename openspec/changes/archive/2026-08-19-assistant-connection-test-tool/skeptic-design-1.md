## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket grounding.** Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the spec delta
  `specs/assistant-conversation-loop/spec.md`. All five citations in `ticket.md`'s "Fix" section were
  re-checked directly against the current tree, not taken on faith:
  - `AssistantToolExecutor.scala:78-87` — dispatch table is exactly `find`, `get_resource`,
    `propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set` (6 tools, no
    `test_connection`). Confirmed.
  - `Connector.scala:96` — `def testConnection(config: Config)(implicit ec: ExecutionContext):
    Future[Either[String, Unit]]` on the `Connector[Config]` trait. Confirmed at that exact line.
  - `ConnectionTest.scala:22-26` — `ConnectionTest.run` maps `connector.testConnection` to
    `TestConnectionResponse(ok, error)`. Confirmed.
  - `SourceService.scala:115-126` (now 113-127 in current tree, off by ~2 lines only due to a
    comment) — `testSql`/`testRest` are real, wired only to the HTTP `/api/sources/test` route
    (`SourcePreviewRoutes.scala`), never called from `AssistantToolExecutor`. Confirmed.

- **Wire-shape grounding for the enforcement mechanism.** Read `PipelineProposalProtocol.scala` in
  full: `PipelineProposalSource` really does carry `restConfig: Option[RestApiConfigPayload]` /
  `sqlConfig: Option[SqlSourceConfigPayload]`, mutually exclusive with `sourceId`/populated only on
  the inline branch, exactly as design.md's Context section and D1 describe. `RestApiConfigPayload`
  and `SqlSourceConfigPayload` are plain case classes (`DataSourceProtocol.scala:117-139`) — free
  structural `equals`, matching D1's "reuses their existing equals" claim for the planned
  `VerifiedConfig` closed ADT.

- **Concurrency-model grounding for D1/D2.** Read `ClaudeClient.sendWithTools` (`ClaudeClient.scala:
  71-127`): confirmed `Future.traverse(toolUses)(executeTool(executor, _))` executes every same-hop
  `tool_use` block concurrently, and the `thisHop > request.maxHops` guard stops the loop before a
  budget-exceeding hop's tools ever dispatch. This is exactly the mechanism D1/D2 reason from (the
  `AtomicReference[Set[VerifiedConfig]]` choice, and "over-cautious rejection, never a bypass" same-hop
  race argument) — not an invented justification.

- **Wiring-site grounding.** `ApiRoutes.scala:181` constructs `sourceService` as a private val;
  `ApiRoutes.scala:437` constructs `AssistantService(...)` without it today. Both line numbers match
  proposal.md's Impact section exactly, and `sourceService` is in scope (declared earlier in the same
  class body) at the construction site — task 1.2's "pass the already-constructed sourceService" is a
  trivial, well-founded change.

- **Service-layer call-path grounding for the gate's insertion point.** Read `PipelineProposalService
  .scala` and `CombinedProposalService.scala` in full: `AssistantToolExecutor.executeProposePipeline`
  calls `pipelineProposalService.validate(proposal, user)`; `executeProposeCombined` calls
  `combinedProposalService.validate(proposal, user)`, which itself delegates the pipeline-source
  portion to `pipelineProposalService.validate(combined.pipeline, user)`. Task 1.5's plan to insert
  `requireVerifiedInlineSource` in `AssistantToolExecutor` immediately before these two `validate`
  calls requires zero changes to either service — consistent with proposal.md's stated Impact
  (`PipelineProposalService.scala`/`CombinedProposalService.scala` not listed as touched files).

- **Spec-delta correctness.** Compared the change's `specs/assistant-conversation-loop/spec.md`
  against the base `openspec/specs/assistant-conversation-loop/spec.md`: the "6-tool"/`maxHops = 3`
  requirement and the separate "The hop cap is 3, supplied by the caller" requirement both exist in
  the base spec and are correctly placed under "MODIFIED Requirements" (not mis-filed as "ADDED"). The
  new connection-test-gate requirement is correctly "ADDED". No orphaned/contradictory requirement.

- **AC traceability.** All 5 ACs in `ticket.md` map to concrete tasks: AC1→1.1-1.3, AC2→1.4/1.5 (D1's
  structural, not prompt-only, enforcement — a stronger reading of the ticket's "system prompt/
  tool-loop logic require" than a prompt-only nudge would give), AC3→the reject-and-retry loop within
  the (now 4-hop) budget plus the system-prompt instruction (1.7), AC4→confirmed `propose_dashboard`/
  `propose_patch_set`/`find`/`get_resource` dispatch paths are untouched by the plan, AC5→D0's
  Non-Goals + the spec's explicit `sourceId`/csv/static exemption scenario.

- **Test-file conventions.** Read `AssistantToolExecutorSpec.scala`, `AssistantServiceSpec.scala`
  (hop-budget tests around lines 242-279), `RestApiConnectorSpec.scala`, and `SqlConnectorSpec.scala`
  to check whether tasks 2.1-2.9 are actually executable given the existing test infrastructure (see
  notes below).

### Verdict: CONFIRM

The design is tightly grounded — every code citation, line number, and structural claim I checked
against the live tree was accurate, not a hallucinated or stale reference. The plan reuses existing
capability (`SourceService.testRest`/`testSql` → `Connector.testConnection`) rather than inventing a
new verification path, correctly narrows scope to only `rest_api`/`sql` (never `csv`/`static`/
`sourceId`), stays backend-only as claimed (no schema/route/DB changes needed), and every AC traces to
a concrete task. No placeholders, no internal contradictions between `ticket.md`/`proposal.md`/
`design.md`/`tasks.md`, no scope drift.

### Non-blocking notes

1. **SQL-branch test seam gap (tasks 2.3/2.5/2.6).** `SourceService.testSql` calls
   `ConnectionTest.run(SqlConnector, sqlConfig)` where `SqlConnector` is a hardcoded Scala `object`
   (`SqlConnector.scala:10`) — there is no injection seam, unlike `RestApiConnector` (a constructible
   class `SourceService`'s constructor already takes as a parameter, and which Mockito *can* mock
   since it isn't `final`). Any `AssistantToolExecutorSpec` test that exercises the `sql` branch of
   `test_connection` end-to-end will make a real JDBC connection attempt — this departs from that
   spec file's own stated "zero real network calls and zero real database" convention. This isn't a
   blocker: the codebase already has precedent for exactly this style of test
   (`SqlConnectorSpec.scala:192-203` tests `SqlConnector.testConnection` against a real reachable
   localhost Postgres for success and `port = 1` for failure), and `SourceService.testSql`'s early
   `SqlConnector.checkQuery` rejection (a DDL/DML query) is testable with zero I/O if the SQL-branch
   coverage in `AssistantToolExecutorSpec` needs to stay I/O-free. Worth a note to the executor rather
   than a required task-list revision.

2. **Two pre-existing `AssistantServiceSpec` tests hardcode the old hop count.** "resolve a
   hop-budget-exhausted result for a 4-tool_use-attempt sequence" and "carry the executor's
   propose-call counters on a hop-budget-exhausted outcome" (`AssistantServiceSpec.scala:245,266`) use
   `Vector.fill(4)(...)` and assert `proposeAttempts shouldBe 3` / `transport.toolInvocations shouldBe
   4`, tied to the current `maxHops = 3`. Raising `MaxHops` to 4 will break these two tests unless
   they're updated to `Vector.fill(5)`/`shouldBe 4`. Task 2.8 implies this outcome ("a scripted 5th
   tool-use hop still resolves to HopBudgetExhausted gracefully") but doesn't name these two existing
   tests explicitly — a minor completeness gap in the task list, not an ambiguity that blocks
   implementation (a red `sbt test` run surfaces it immediately).

3. **Task 1.3's "mirror `SourcePreviewRoutes`'s dispatch" phrasing is only exactly true for the SQL
   branch.** `SqlInferRequest(type, config)` (`DataSourceProtocol.scala:167`) matches the tool's
   `{type, config}` input shape directly. But `SourcePreviewRoutes`'s `/test` route decodes the
   **entire** POST body as `RestApiConfigPayload` for the REST branch (no `config` wrapper) — whereas
   the new `test_connection` tool's input nests REST config under `config` (matching
   `PipelineProposalSourceSchema`'s shape, per D5). So the REST-branch decode actually needs
   `input.fields("config").convertTo[RestApiConfigPayload]`, not a literal mirror of
   `SourcePreviewRoutes`'s own decode call. The target types are unambiguous either way (task 1.1
   already specifies the exact nested shape), so this doesn't block a competent implementer — just an
   imprecise cross-reference worth a mental note during implementation.

None of the above rises to a required revision of `proposal.md`/`design.md`/`tasks.md`/the spec delta.

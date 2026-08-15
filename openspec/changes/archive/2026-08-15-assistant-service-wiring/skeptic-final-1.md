## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

Read fresh (not trusted as fact): `ticket.md`, `design.md`, `skeptic-design-{1,2,3}.md`,
`evaluation-1.md`, `tasks.md`, `files-modified.md`. Then independently re-derived every conclusion
from the actual diff (`git show --stat d755fe9e`, `git diff origin/main...HEAD`) and by reading full
source files myself — not from the evaluator's narrative.

**Diff scope** — `git diff --name-only origin/main...HEAD`: 4 new backend main files
(`AssistantProtocol.scala`, `AssistantProposalToolSchemas.scala`, `AssistantService.scala`,
`AssistantSystemPrompt.scala`, `AssistantToolExecutor.scala` — 5, corrected), 2 modified backend main
files (`CombinedProposalService.scala`, `PipelineProposalService.scala`), 4 new test files, plus
openspec change artifacts. No `ApiRoutes.scala`, no `frontend/**`, no `schemas/**`, no
`openspec/specs/**` (top-level) in the diff — confirmed by direct `git diff --name-only`, matching
the evaluator's claim and the proposal's explicit non-goals.

**Gates re-run myself, fresh:**
- `sbt "testOnly com.helio.services.AssistantServiceSpec com.helio.services.AssistantToolExecutorSpec com.helio.services.CombinedProposalServiceValidateSpec com.helio.services.PipelineProposalServiceValidateSpec"` →
  25/25 passed, 0 failed.
- `sbt test` (full suite) → **2794/2794 passed**, 0 failed, 0 canceled — matches the evaluator's
  reported number exactly (independently reproduced, not trusted from the report).
- `npm run check:schemas` → clean (49 protocol files checked).
- `npm run check:scala-quality` → clean (0 hard violations; the pre-existing soft-warning list
  includes `AssistantServiceSpec.scala` at 270 lines, a new soft-budget note but not a violation —
  consistent with CONTRIBUTING's "soft budget, not a gate").
- `npm run format:check` → clean.
- `npm run check:openspec` → "complete (32/32) but not archived" — expected pre-archive state.

### Independent verification of the 9 flagged risk items

1. **Hard Boundary — zero apply/mutate reachability.** `grep -n "\.apply(\|\.create(\|\.update(\|\.delete("
   AssistantToolExecutor.scala AssistantService.scala` → zero hits. Read
   `CombinedProposalService.validate` (lines 54-62) and `PipelineProposalService.validate` (lines
   63-77) directly: both call only pure/read-only helpers (`validateOutputRefPositions`,
   `validateDashboardStructure`, `pipelineProposalService.validate`, `dataSourceRepo.findByIdOwned`
   which returns `Future[Option[DataSource]]`, no write). `apply` in both services is byte-for-byte
   unchanged (diff shows only additive `validate`/`validateDashboardStructure`/
   `validateSourceReference` methods plus one visibility widening). `AssistantProtocol.assistantTools`
   (`AssistantProtocol.scala:71-78`) is a closed `Vector` of exactly 6 tools, no apply-shaped entry —
   read `AssistantProposalToolSchemas.scala` in full, confirmed no tool named/shaped for mutation.
   Confirmed.
2. **`CombinedProposalService.validate` checks BOTH dashboardName-blank AND per-panel
   `validatePanel`.** Read `validateDashboardStructure` (`CombinedProposalService.scala:64-74`) — an
   `if (dashboard.dashboardName.trim.isEmpty) Left(...)` guard followed by a `foldLeft` over
   `panels.zipWithIndex` calling `ProposalPanelSupport.validatePanel` per panel. Both checks
   present, both covered by dedicated tests I ran myself
   (`CombinedProposalServiceValidateSpec`: "reject a blank dashboard.dashboardName" and "reject a
   structurally invalid dashboard panel (blank title)" both pass). Confirmed.
3. **`get_resource`'s DataType payload nests `{"detail":..., "panelCapabilities":...}` under
   distinct keys, both `columns` arrays intact.** Read `withCapabilities`
   (`AssistantToolExecutor.scala:121-132`): `JsObject("detail" -> detailJson, "panelCapabilities" ->
   capabilities.toJson)` — never a flat merge. Ran `AssistantToolExecutorSpec`'s "nest detail and
   panelCapabilities as distinct keys... both columns arrays intact" test myself — it passed, and its
   assertions are non-trivial: it asserts `detailColumns.head.fields.keySet should
   contain("semanticRole")` (proving the DataType-detail column survived with its distinguishing
   field) and `capabilityColumns.head.fields.keySet should not contain "semanticRole"` (proving the
   two `columns` arrays are genuinely distinct payloads, not one overwriting the other). This is a
   real behavioral test, not just a presence check. Confirmed.
4. **`converse(history, message, user)` — no conversationId/DB lookup.** Read
   `AssistantService.scala:45`: `def converse(history: Seq[ClaudeToolMessage], message: String, user:
   AuthenticatedUser): Future[AssistantTurnResult]`. No repository/DB call anywhere in `converse` or
   its private helpers (`seedHistory`, `toTurnResult`, `toolCallCount`, `describeError`) — all pure
   in-memory transforms over the `ClaudeToolOutcome`. Confirmed.
5. **`maxHops = 3` actually wired.** `AssistantService.scala:43` — `private val MaxHops: Int = 3`,
   passed directly into `ClaudeToolRequest(maxHops = MaxHops)` at line 58. `ClaudeToolRequest.maxHops`
   is a required, non-defaulted constructor parameter (`ClaudeModels.scala:123`) — there is no way to
   construct the request without supplying it, and the `AssistantServiceSpec` "hop-budget-exhausted"
   test (which I ran) proves a 4th attempt is rejected, confirming `3` is the live value, not just a
   comment. Confirmed.
6. **System prompt instructs at most one propose_* call per turn.** `AssistantSystemPrompt.scala:46-47`:
   literal text "Call at most one propose_* tool per turn. Never call two propose_* tools in the same
   response." Confirmed verbatim.
7. **Zero `ApiRoutes.scala`/DI wiring.** `git diff --name-only origin/main...HEAD` contains no
   `ApiRoutes.scala` entry. `grep -rln "new AssistantService(" backend/src/main` → zero hits (only the
   test file constructs one). Confirmed.
8. **AC2's fallback has zero find-emptiness special-casing.** Read `AssistantService.scala` and
   `AssistantToolExecutor.scala` in full — `executeFind` (`AssistantToolExecutor.scala:73-80`)
   unconditionally serializes whatever `workspaceSearchService.find` returns
   (`results.toJson.compactPrint`), with no branch on size/emptiness. No code anywhere in either file
   inspects `find`'s result to decide behavior — the AC2 fallback is provably pure emergent behavior
   from the system prompt (task 3.2, confirmed present in `AssistantSystemPrompt.scala:57-58`: "If
   find turns up nothing relevant to the goal, don't give up: propose_pipeline or propose_combined can
   create the data the goal needs from scratch") plus tool availability, not special-case code.
   Confirmed.
9. **The two flagged deviations are legitimate.**
   - `AssistantStreamEvent.Result`/`Error` → `TurnResult`/`StreamError`: read
     `DashboardAuthoringProtocol.scala:79-91` directly — `AuthoringStreamEvent` genuinely already owns
     both `final case class Result(...)` (line 86) and `final case class Error(...)` (line 91) in the
     same `api/protocols` package `check-schema-drift.mjs` enforces global case-class-name uniqueness
     over (confirmed the script's `classOrigin` map / duplicate-detection logic exists at
     `scripts/check-schema-drift.mjs:64-75`). Renaming was not optional — a literal `Result`/`Error`
     pair would have collided. Legitimate, not scope creep.
   - `panelCapabilityService` added to `AssistantToolExecutor`/`AssistantService` constructors: task
     4.2a (`tasks.md`, same file as 4.1's abbreviated signature) explicitly requires calling
     `panelCapabilityService.getCapabilities(...)`, which is impossible without constructor injection.
     4.1's prose signature line simply predates 4.2a's later addition to the same tasks.md. Legitimate.

### Acceptance criteria traced to real evidence

- **AC1** (existing-data goal → same-quality `DashboardProposal` via the tool loop): traced to
  `executeProposeDashboard` → `dashboardProposalService.validate` (the exact same, unmodified
  validation `DashboardAuthoringService` already used) plus the D3a capability-grounding path
  (`withCapabilities`) that gives Claude the same "only bind a bindable panel kind" grounding
  `DashboardAuthoringPrompt` injects directly. Backed by `AssistantServiceSpec`'s "produce a dashboard
  proposal from a scripted find + propose_dashboard sequence" test, which I ran and which passed.
- **AC2** (no matching DataType → pipeline/combined fallback, zero special-case code): traced above
  (item 8) — genuinely zero branching in reachable code, confirmed by direct read of both files, not
  just the evaluator's assertion.
- **AC3** (no apply-shaped tool reachable): traced above (item 1) plus a dedicated test
  (`AssistantProtocol.assistantTools` "contain exactly the 6 expected tools, none apply-shaped") that
  I ran myself and passed.
- **AC4** (`sbt test` fully green, zero real network calls): reproduced myself — 2794/2794 passed.
  Grepped all 4 new test files for `HttpClaudeTransport` — zero hits outside a doc-comment mention of
  what's deliberately NOT used; every test constructs `ClaudeClient` over a hand-written
  `FakeToolTransport`/mocked repositories.

### Design judgment (backend-only, no UI)

No `frontend/**` changes in the diff — `DESIGN.md` does not apply. Skipped per its own binding scope
(frontend only).

### Verdict: CONFIRM

Every one of the 9 flagged risk items traces to real, currently-compiling, currently-tested code —
not restated claims. The Hard Boundary is genuinely enforced at three independent layers (tool schema
never includes an apply-shaped tool; every `propose_*` dispatch calls only `validate`/`preview`; the
two new `validate` methods' call graphs contain zero apply/create/update/delete calls, confirmed by
direct grep and read). The design-gate's two hardest-won fixes (the blank-dashboardName check, the
nested-not-flat capability payload) both landed in the actual implementation with tests that would
catch a regression of either. All 4 ACs trace to real code + a passing test I ran myself, not just an
evaluator assertion. `sbt test` (2794/2794), `check:schemas`, `check:scala-quality`, `format:check`
all independently reproduced clean. This ships.

### Non-blocking notes

- `AssistantServiceSpec.scala` is now 270 lines, over CONTRIBUTING's 250-line soft budget for test
  files (flagged by `check:scala-quality` as a soft warning, not a gate failure). Worth a look next
  time this file grows (e.g. HEL-663's history-loading tests), not a defect today.
- `check:openspec` reports "complete (32/32) but not archived" — expected pre-archive state at this
  point in the delivery flow, not an issue for this gate.

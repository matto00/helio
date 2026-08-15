## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verification detail:
- All 4 ACs traced to real code + tests:
  - AC1 (existing-data goal → DashboardProposal via tool loop): `AssistantServiceSpec` "produce a
    dashboard proposal from a scripted find + propose_dashboard sequence" (task 6.3), backed by the
    real `DashboardProposalService.validate` grounding path.
  - AC2 (no matching DataType → propose_pipeline/propose_combined, zero special-case code):
    `AssistantService.converse`/`AssistantToolExecutor.execute` contain no branch inspecting `find`'s
    result — confirmed by direct code read (`AssistantService.scala`, `AssistantToolExecutor.scala`);
    fallback is purely a consequence of `AssistantSystemPrompt`'s guidance + tool availability. Task
    6.4 test confirms behaviorally.
  - AC3 (no apply-shaped tool reachable): `AssistantProtocol.assistantTools` contains exactly `find`,
    `get_resource`, `propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set` —
    no apply/mutate tool exists in the schema, and every `propose_*` dispatch in
    `AssistantToolExecutor` calls only `.validate`/`.preview`, never `.apply`. Task 6.8 test asserts
    this directly.
  - AC4 (sbt test green, zero real network calls): reconfirmed independently (`sbt test`:
    2794/2794 passed). Both `AssistantServiceSpec` and `AssistantToolExecutorSpec` use only
    `FakeToolTransport`/mocked repositories — no `HttpClaudeTransport`, no live DB in those two specs.
- No AC silently reinterpreted.
- All 32 `tasks.md` items are `[x]` and match what's actually implemented (verified constructor
  shapes, dispatch table, side-channel mechanics, and all 12 listed tests directly against source).
- No scope creep: the only changes outside net-new files are the `validate` additions to
  `PipelineProposalService`/`CombinedProposalService`, both explicitly required by the ticket's own
  "Critical design constraint" section and self-approved in design.md. `DashboardAuthoringService`/
  `DashboardAuthoringRoutes`/`AuthoringChatDrawer`/`ApiRoutes.scala` are untouched, matching the
  proposal's explicit non-goals.
- No regressions: `PipelineProposalService.apply`/`CombinedProposalService.apply` and their private
  helpers are unmodified (only `validateStructure`'s visibility widened `private` →
  `private[services]`, and two new public `validate` methods added) — full existing test suite (2794
  tests, including the pre-existing apply-path specs) still green.
- No schema/API-contract changes needed or made (no route, no wire format change) — correctly a
  no-op here per the proposal's own "no route/API surface" scope line; `check:schemas` passes clean
  (49 protocol files checked).
- Planning artifacts reflect final implementation: design.md's D1–D8 decisions (3-round design gate,
  `skeptic-design-3.md` verdict CONFIRM) all traced 1:1 into the actual code — `converse` signature,
  `maxHops = 3`, the nested `{"detail", "panelCapabilities"}` payload shape, both
  `CombinedProposalService.validate` structural checks, the `AtomicReference` side channel, and the
  "at most one propose_* per turn" prompt line.

**Independent verification of the 7 flagged risk items from the orchestrator brief:**
1. Hard Boundary — traced both `validate` call graphs by hand:
   `PipelineProposalService.validate` → `validateStructure` (pure) → `validateSourceReference` →
   `dataSourceRepo.findByIdOwned` (read-only). `CombinedProposalService.validate` →
   `validateOutputRefPositions` (pure) → `validateDashboardStructure` (pure, calls
   `dashboard.dashboardName.trim.isEmpty` **and** `ProposalPanelSupport.validatePanel` per panel,
   `CombinedProposalService.scala:64-74`) → `pipelineProposalService.validate`. Zero
   `apply`/`create`/`update`/`delete` calls anywhere in either graph. Both required checks present
   (design-gate round-2 fix genuinely closed).
2. `get_resource` DataType-capability merge: `AssistantToolExecutor.withCapabilities` produces
   `JsObject("detail" -> detailJson, "panelCapabilities" -> capabilities.toJson)` — distinct
   top-level keys, never a flat union (`AssistantToolExecutor.scala:121-132`). Test 6.11
   (`AssistantToolExecutorSpec`) asserts both `columns` arrays survive intact, not just presence.
3. `converse(history: Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser)` —
   confirmed exact signature, no `conversationId`/DB lookup (`AssistantService.scala:45`).
4. `maxHops = 3` is a `private val MaxHops: Int = 3` passed directly into `ClaudeToolRequest`
   (`AssistantService.scala:43,58`).
5. `AssistantSystemPrompt.text` literally contains "Call at most one propose_* tool per turn. Never
   call two propose_* tools in the same response." (`AssistantSystemPrompt.scala:46-47`).
6. `git diff --name-only main...HEAD` contains no `ApiRoutes.scala` entry — confirmed no DI/route
   wiring anywhere in the diff.
7. `AssistantService.converse`/`AssistantToolExecutor.execute` contain no branch on `find`'s
   emptiness — confirmed by direct read of both files' full source.

**Two flagged deviations from tasks.md's literal text — both legitimate:**
- `AssistantStreamEvent.Result`/`Error` → `TurnResult`/`StreamError`: confirmed
  `AuthoringStreamEvent` (`DashboardAuthoringProtocol.scala:80-91`) genuinely already owns
  `Result`/`Error` case classes, and `scripts/check-schema-drift.mjs`'s `parseCaseClasses`/
  `classOrigin` machinery genuinely enforces global case-class-name uniqueness across
  `api/protocols/` unconditionally (not something the executor could dodge without hitting a real
  script failure). Legitimate, not scope creep.
- `panelCapabilityService` added to `AssistantToolExecutor`/`AssistantService` constructors, absent
  from tasks.md 4.1/5.1's abbreviated prose signatures: task 4.2a (in the same tasks.md) explicitly
  requires calling `panelCapabilityService.getCapabilities(...)`, which is impossible without
  constructor injection. The 4.1/5.1 signature lines are simply abbreviated prose that predates
  4.2a's later addition, not a real omission the executor should have honored literally. Legitimate.

### Phase 2: Code Review — PASS

Issues: none.

Gates re-run fresh (not trusting the executor's report), in `WORKTREE_PATH` (no `CLEAN_WORKTREE`
flag was passed — backend-only diff, so per the diff-matching rule only the backend gate is
required; `check:schemas`/`check:scala-quality`/`check:openspec`/`format:check` were additionally
run as bonus corroboration):
- `cd backend && sbt test` → **2794/2794 passed**, 0 failed, 0 canceled, 0 ignored (matches the
  executor's report exactly).
- `npm run check:schemas` → clean (49 protocol files checked, including the new
  `AssistantProtocol.scala`/`AssistantProposalToolSchemas.scala`).
- `npm run check:scala-quality` → clean (0 hard violations; 104 pre-existing soft file-size warnings,
  none touching this change's files).
- `npm run format:check` → clean.
- `npm run check:openspec` → reports change "complete (32/32) but not archived" — expected,
  pre-archive state per the standard delivery flow, not a defect.
- `openspec validate assistant-service-wiring --strict` → valid.

Code-quality review (diff + targeted full-file reads of all 7 modified/new
`backend/src/main/scala` files and all 4 new test files):
- **CONTRIBUTING.md compliance**: no inline FQNs anywhere in the diff (grepped for
  `com.helio.X.Y(`/`spray.json.X`/`java.util.UUID.` patterns — zero hits in added lines). All new
  files are within the ~250-line soft budget (`AssistantProposalToolSchemas.scala` 212,
  `AssistantToolExecutor.scala` 194, `AssistantService.scala` 100, `AssistantProtocol.scala` 79,
  `AssistantSystemPrompt.scala` 59); `PipelineProposalService.scala` grew to 399 lines (under the
  400-line "propose a split" trigger, no split needed). Value-class IDs used correctly throughout
  (`DataTypeId`, `DataSourceId`).
- **DRY**: `propose_*` tools are thin wrappers reusing existing services verbatim, no duplicated
  validation logic; `CombinedProposalService.validate` explicitly delegates the pipeline portion to
  `PipelineProposalService.validate` rather than reimplementing it.
- **Readable**: clear naming throughout (`capturedProposal`, `withCapabilities`,
  `validateSourceReference`); no magic values (the `"$pipelineOutput"` sentinel is a named constant,
  `OutputRefSentinel`, pre-existing from HEL-387 and reused, not reintroduced).
- **Modular**: clean separation — protocol types / system prompt / tool executor / service are four
  distinct files with single responsibilities.
- **Type safety**: no `asInstanceOf`/`.get`-on-Option without a guard; `decode[T: JsonReader]` uses
  a typed `Try` + pattern match, no untyped escape hatches.
- **Security**: `AssistantToolExecutor` never bypasses ACL — `dataSourceRepo.findByIdOwned` (owner
  check), `dtRepo.findByIdOwned` via `WorkspaceSearchService`/`PanelCapabilityService` (both
  pre-existing, unmodified). Tool input is decoded through typed spray-json readers, not
  string-interpolated into anything.
- **Error handling**: every `propose_*`/`find`/`get_resource` failure path returns `Left`, fed back
  to Claude as an `isError` tool_result — never an uncaught exception; `decode` explicitly catches
  `DeserializationException`. `AssistantService.converse`'s `Future` never fails for a validation
  rejection (confirmed by `ClaudeToolOutcome.Failed` only wrapping transport-level errors, not
  validation `Left`s).
- **Tests meaningful**: all 12 listed tasks.md tests (6.1–6.12) present and each asserts the specific
  behavior named (e.g. task 6.2's blank-name test explicitly checks the error message mentions
  "dashboardname", proving the specific check ran, not just "some Left"; task 6.1's inline-source
  test uses `verifyNoInteractions(dsRepo)` to prove no resolution attempt was made). These would
  catch a real regression (e.g. reverting the `validateDashboardStructure` blank-name check would
  fail `CombinedProposalServiceValidateSpec`'s dedicated test).
- **No dead code**: no unused imports (compiles clean under `sbt test`, which fails on unused-import
  warnings-as-errors in this repo's build config — confirmed by the successful compile), no
  TODO/FIXME/XXX in the diff.
- **No over-engineering**: `AssistantStreamEvent`/protocol-only type is justified by the proposal's
  explicit scope line ("needs new event types... no live route... left to whichever later ticket");
  not gold-plating — it's the minimum shape a later ticket needs to target.
- **Behavior-preserving**: `PipelineProposalService.apply`/`CombinedProposalService.apply` bodies are
  byte-for-byte unchanged in the diff; only additive `validate` methods + one visibility widening.

### Phase 3: UI Review — N/A

No files under `frontend/**`, no `backend/src/main/scala/routes/ApiRoutes.scala` change, no
`schemas/**` change, no `openspec/specs/**` change (only `openspec/changes/assistant-service-wiring/
specs/**`, the change-scoped delta, not the top-level committed spec tree). Confirmed via `git diff
--name-only main...HEAD` against all four trigger patterns — zero matches. This is a backend-only,
unwired service (no route, no DI) per the ticket's own explicit non-goals; nothing user-facing
changed. Skipped per instructions.

### Overall: PASS

### Non-blocking Suggestions

- `PipelineProposalService.scala` is now at 399 lines, one line under CONTRIBUTING's "~400 lines →
  propose a split in the PR description" trigger. Not a violation this cycle, but worth watching —
  the next addition to this file (e.g. HEL-663+ work) will likely cross it.
- `AssistantToolExecutorSpec`/`AssistantServiceSpec` pass `null` for unused collaborators
  (`combinedProposalService`, `patchSetPreviewService` in several fixtures). This is a documented,
  deliberate pattern (comments explain the NPE-as-loud-failure rationale) mirroring existing
  precedent in the codebase, so not a defect — flagging only because a future reader unfamiliar with
  that precedent might be tempted to "fix" it into a full mock, which would be pure churn.

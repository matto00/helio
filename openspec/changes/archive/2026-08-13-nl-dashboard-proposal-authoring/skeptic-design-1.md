## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/nl-dashboard-proposal-authoring/spec.md`, `workflow-state.md`. Then
cross-checked every claimed existing-pattern/existing-signature reference
against the actual current source in the worktree (not the design doc's own
narrative):

- `DashboardProposalService.apply` (`backend/src/main/scala/com/helio/services/DashboardProposalService.scala:54-65`):
  confirmed it calls private `validateStructure` then
  `ProposalPanelSupport.preValidateBindings(proposal.panels, user, dataTypeRepo, metricRepo)`
  before any write — D1's proposed `validate` extraction is a faithful,
  behavior-preserving lift of exactly this code path. `preValidateBindings`
  (`ProposalPanelSupport.scala:75-87`) is read-only (zero DB writes), matches
  design.md's claim verbatim.
- `WorkspaceContextService.assemble(user, budgetBytes): Future[WorkspaceContextResponse]`
  (`WorkspaceContextService.scala:144-147`) — signature matches design.md's
  Context section exactly, including the default `budgetBytes` param. No
  reference to `PanelCapabilityService` anywhere in the file — confirms D3's
  "confirmed: no reference" claim. `WorkspaceContextDataType.pipelineOutput: Boolean`
  (`dt.sourceId.isEmpty`, line 280) exists and is exactly the field D6's
  empty-workspace filter needs. `buildPipeline`'s per-pipeline
  degrade-to-`stepsError`-not-fail pattern (lines 196-207) is real and matches
  D3's cited precedent.
- `PanelCapabilityService.getCapabilities(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, PanelCapabilitiesResponse]]`
  (`PanelCapabilityService.scala:31`) — signature matches design.md's Context
  section exactly.
- `com.helio.ai.ClaudeClient` (`ClaudeClient.scala`): `send`/`stream` exist
  with the claimed shapes; `ClaudeTransport` trait (`send`/`stream`) is a real
  SPI seam already exercised by a hand-written fake in
  `ClaudeClientSpec.scala` (`FakeClaudeTransport`, lines 46-64) — confirms
  tasks.md 5.2's "stub `ClaudeTransport`" plan is grounded in a real,
  established precedent, not invented. `ClaudeError.ApiError`/
  `TransportFailure`/`GuardrailExceeded` (`ClaudeModels.scala:44-52`) and
  `ClaudeStreamEvent.TextDelta` (line 63) all exist exactly as D7/D8 claim.
  `ClaudeConfig.fromEnv(): Either[String, ClaudeConfig]` (`ClaudeConfig.scala:41`)
  matches tasks.md 4.2's "guarded... degrades to 503" plan. Confirmed via
  `grep -rln "new ClaudeClient(" backend/src/main/scala/` (empty result) that
  there is genuinely no consumer yet — "first caller" claim holds.
- `ServiceError.UnprocessableEntity`/`BadGateway` both exist exactly as D8
  claims (`ServiceError.scala:27,30`), with `ServiceResponse.completeError`
  (`ServiceResponse.scala:75-76`) already mapping them to 422/502.
- `PipelineRunStreamRoutes` (`PipelineRunStreamRoutes.scala:44-45`): confirmed
  `HttpEntity.Chunked.fromData(sseContentType, byteSource)` over a mapped
  `Source` is the real, existing SSE pattern. `RunStatusEvent.toSseBytes`
  (`PipelineRunRegistry.scala:35-43`) is a real static ByteString encoder —
  design.md's claim that a new `AuthoringStreamEvent.toSseBytes` would mirror
  this (not reuse the registry itself) is accurate and appropriately scoped.
- `DashboardProposalProtocol.scala`: `DashboardProposal`/`ProposalPanel` and
  their tolerant-of-missing-fields spray-json formatters exist as described,
  supporting D4's JSON-text-parse plan.
- `ApiRoutes.scala:134-244`: confirmed all named collaborators
  (`workspaceContextService`, `panelCapabilityService`, and the
  `DashboardProposalService` instance) are already constructed and available
  for the new route's DI, and that the existing `confineScopedToken`/
  `authenticate` split (lines 264-403) already keeps a scoped PAT token
  outside this new route's mount point automatically (no extra design work
  needed there).
- Ran `find backend/src/test -iname "*DashboardProposalServiceSpec*"` and
  `ls backend/src/test/scala/com/helio/services/` — **no such file exists**
  (see Change Request 1 below).
- Ran `grep -rn "check-schema-drift" .husky/* package.json` — confirmed
  `npm run check:schemas` → `scripts/check-schema-drift.mjs` runs in
  `.husky/pre-commit` (a real, binding gate), and inspected its logic plus
  every existing `schemas/*-request.schema.json`/`*-response.schema.json`
  pair (`bound-panel-*`, `workspace-teardown-*`, `create-api-token-*`,
  `hook-run-*`, `update-panels-batch-*`, …) — all ~90 schema files follow a
  strict one-title-per-file convention, zero exceptions (see Change Request 2
  below).

### Verdict: REFUTE

The core architecture (D1 validate-extraction, D2 service placement, D3
capability fan-out, D4 JSON-text parsing, D5 bounded repair, D6 empty-workspace
short-circuit, D7 streaming shape, D8 error mapping) is sound and every
existing-signature reference I checked against it holds up against real
source. However, two of the plan's own concrete task items conflict with
verifiable facts about the current repo and would either mislead the executor
or fail a real, binding gate if followed literally.

### Change Requests

1. **tasks.md 1.1 and 5.1 cite a test file that does not exist.** Both say
   the "existing `DashboardProposalServiceSpec`" must "stay green with no
   changes to its assertions" / "existing suite stays green after the
   `validate` extraction." I confirmed via
   `find backend/src/test -iname "*DashboardProposalServiceSpec*"` and
   `ls backend/src/test/scala/com/helio/services/` that no such file exists
   anywhere in the tree. The real regression coverage for
   `DashboardProposalService.apply`'s behavior lives entirely in
   route-level integration specs under `backend/src/test/scala/com/helio/api/`
   — `DashboardApplyProposalSpec.scala` and its siblings
   (`DashboardApplyProposalBindingSpec.scala`,
   `DashboardApplyProposalAggregationSpec.scala`,
   `DashboardApplyProposalConfigSpec.scala`,
   `DashboardApplyProposalMetricBindingSpec.scala`,
   `DashboardApplyProposalTimelineSpec.scala`) — all built on
   `ApplyProposalSpecBase`, which spins up a real embedded-Postgres instance
   under RLS (not a mocked/in-memory repo). Fix: rewrite tasks.md 1.1/5.1 to
   name the actual regression suite
   (`DashboardApplyProposalSpec` + siblings under `com.helio.api`) as the
   thing that must "stay green," and clarify where 5.1's new "direct
   `validate`-only test" should actually live — since `DataTypeRepository`
   and `MetricRepository` are concrete classes requiring a real `DbContext`
   (verified: `class DataTypeRepository(ctx: DbContext)...`, no trait/mock
   seam), a lightweight unit test isn't possible without the same
   embedded-Postgres harness `WorkspaceContextServiceSpec`/
   `ApplyProposalSpecBase` already use — either add the assertion to one of
   the existing `DashboardApplyProposal*Spec` files or build a new spec on
   that same harness pattern, not a bare mock.

2. **tasks.md 2.3's single combined schema file contradicts the codebase's
   own pre-commit-enforced convention and would fail it.** Task 2.3 plans
   one file, `schemas/dashboard-authoring.schema.json`, covering "request +
   response shapes." I confirmed `.husky/pre-commit` runs
   `npm run check:schemas` (`scripts/check-schema-drift.mjs`) on every commit,
   and that script requires each file in `schemas/` to have exactly one
   top-level `title` that matches exactly one Scala case class name (or be
   explicitly listed in its `SKIP` set). I checked every existing
   request/response pair in `schemas/` (`bound-panel-request.schema.json` /
   `bound-panel-response.schema.json`, `workspace-teardown-request.schema.json`
   / `workspace-teardown-response.schema.json`, `create-api-token-request` /
   `-response`, `hook-run-request` / `-response`,
   `update-panels-batch-request` / `-response`, etc.) — every single one is
   split into two files, one title each; there are zero exceptions across the
   ~90 files in `schemas/`. A single file can't carry two titles
   (`DashboardAuthoringRequest` and `DashboardAuthoringResponse`), so task
   2.3 as written either fails `check:schemas` at commit time or forces an
   undocumented deviation from the design's own stated plan. Fix: split into
   `schemas/dashboard-authoring-request.schema.json` (title
   `DashboardAuthoringRequest`, with `AuthoringContextOptions` nested as a
   `$defs` entry, mirroring how `ProposalPanelLayout`/`ProposalPanel` nest
   inside `dashboard-proposal.schema.json`'s single `DashboardProposal`
   title) and `schemas/dashboard-authoring-response.schema.json` (title
   `DashboardAuthoringResponse`).

### Non-blocking notes

- tasks.md 4.2 refers to "the already-constructed `workspaceContextService`,
  `panelCapabilityService`, `dashboardProposalService`" — the actual
  `ApiRoutes.scala` field name for the third is `proposalService` (line 144),
  not `dashboardProposalService`. Purely a naming mismatch in the task
  description; trivial for the executor to resolve, not worth blocking on.
- tasks.md 5.2's "stub `ClaudeTransport`, canned responses" undersells that
  `DashboardAuthoringServiceSpec` still has to construct the full
  DB-backed `WorkspaceContextService`/`PanelCapabilityService`/
  `DashboardProposalService` graph underneath (all take concrete
  `DataTypeRepository`/`MetricRepository`/etc., no mock seam) — every sibling
  spec that touches these repos (`WorkspaceContextServiceSpec`,
  `ApplyProposalSpecBase`) uses an embedded-Postgres harness, so this new
  spec will need the same. Not a design flaw (the precedent is real and
  well-established), just worth the executor budgeting for it as an
  integration-style spec rather than a pure unit test.

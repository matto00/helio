## 1. Backend: shared validation extraction

- [x] 1.1 Add `DashboardProposalService.validate(proposal, user): Future[Either[ServiceError, Unit]]`
      running exactly the existing `validateStructure` + `ProposalPanelSupport.preValidateBindings`
      checks, no side effects. Refactor `apply` to call it first (behavior-preserving — the existing
      route-level `DashboardApplyProposal*Spec` suites + `DashboardProposalProtocolSpec` must all
      stay green, unmodified).

## 2. Backend: protocol

- [x] 2.1 Add `DashboardAuthoringRequest(goal, contextOptions: Option[AuthoringContextOptions])` and
      `AuthoringContextOptions(budgetBytes: Option[Int])` to a new `DashboardAuthoringProtocol.scala`.
- [x] 2.2 Add `DashboardAuthoringResponse(proposal: DashboardProposal, warnings: Vector[String])`.
- [x] 2.3 Add two JSON Schemas, matching the codebase's one-title-per-file
      request/response-suffix convention (e.g. `bound-panel-request.schema.json` /
      `bound-panel-response.schema.json`): `schemas/dashboard-authoring-request.schema.json`
      (title `DashboardAuthoringRequest`) and `schemas/dashboard-authoring-response.schema.json`
      (title `DashboardAuthoringResponse`, `proposal` field `$ref`-ing the existing
      `dashboard-proposal.schema.json` rather than duplicating its shape).
- [x] 2.4 Add `AuthoringStreamEvent` (sealed): `Progress(text: String)`, `Status(label: String)`,
      `Result(proposal, warnings)`, `Error(message: String)`, plus `toSseBytes` (mirrors
      `RunStatusEvent.toSseBytes`).

## 3. Backend: DashboardAuthoringService

- [x] 3.1 Assemble grounding context: `WorkspaceContextService.assemble(user, budgetBytes)`, then
      `Future.traverse` its pipeline-output-kind `dataTypes` through
      `PanelCapabilityService.getCapabilities`, degrading a per-type failure to "no capabilities" for
      that type (never failing the whole assembly).
- [x] 3.2 Empty-workspace short-circuit: zero pipeline-output DataTypes → `Left(ServiceError.
      UnprocessableEntity(...))` before constructing any `ClaudeClient` request.
- [x] 3.3 Build the system prompt from the assembled context + capability menu + the
      `DashboardProposal`/`ProposalPanel` wire schema (instruct: respond with ONLY the JSON object,
      bind only to pipeline-output DataTypes, use only the listed panel capabilities).
- [x] 3.4 Implement the shared parse→validate→repair core: parse response text as JSON (defensive
      brace-matched extraction before parsing) into `DashboardProposal`; on parse failure or
      `DashboardProposalService.validate` rejection, re-prompt once with the error included; a
      second failure returns `Left(ServiceError.UnprocessableEntity(...))` — never a third attempt.
- [x] 3.5 `author(request, user): Future[Either[ServiceError, DashboardAuthoringResponse]]` — buffered
      via `ClaudeClient.send`, using the shared core from 3.4.
- [x] 3.6 `authorStreaming(request, user): Source[AuthoringStreamEvent, NotUsed]` — via
      `ClaudeClient.stream`, forwarding text deltas as `Progress`; on completion runs the shared core
      (a `Status("repairing")` event before a repair attempt, a buffered `send` not a 2nd stream);
      terminal event is exactly one `Result` or `Error`.
- [x] 3.7 Map `ClaudeError.ApiError`/`TransportFailure` → `ServiceError.BadGateway`;
      `ClaudeError.GuardrailExceeded` → `ServiceError.UnprocessableEntity`.

## 4. Backend: routes

- [x] 4.1 Add `DashboardAuthoringRoutes`: `POST /api/authoring/dashboard`. Without `?stream=true`,
      `ServiceResponse.run(service.author(...))`. With `?stream=true`, build the SSE response the
      same way `PipelineRunStreamRoutes` does (`HttpEntity.Chunked.fromData(sseContentType,
      byteSource)`) over `service.authorStreaming(...).map(_.toSseBytes)`.
- [x] 4.2 Wire `DashboardAuthoringRoutes` into `ApiRoutes.scala` alongside the other proposal routes,
      constructing `DashboardAuthoringService` from the already-constructed `workspaceContextService`/
      `panelCapabilityService`/`dashboardProposalService` and a `ClaudeClient` from
      `ClaudeConfig.fromEnv()` — guarded so a missing `ANTHROPIC_API_KEY` degrades to a clean `503`,
      never a startup failure (mirrors HEL-390 D6's "no forced startup requirement").

## 5. Tests

- [x] 5.1 No unit-level spec for `DashboardProposalService` exists today (task 1.1's route-level
      suites are the `apply` regression net). Add a new unit spec (mocked repos, no Postgres
      harness) directly exercising `validate`: accepts a valid proposal, rejects a
      non-pipeline-output binding, creates nothing either way.
- [x] 5.2 `DashboardAuthoringServiceSpec` (stub `ClaudeTransport`, canned responses): valid-on-first-try
      passthrough; invalid-then-valid triggers exactly one repair (2 invocations); invalid-then-invalid
      fails `422` (2 invocations, never 3); empty-workspace short-circuits (0 invocations); a
      non-pipeline-output binding rejects identically to `DashboardProposalService.apply`'s own.
- [x] 5.3 `AuthoringStreamEventSpec` (or folded into 5.2): a streaming stub's text deltas assemble
      into `Progress` events; a repair round-trip emits a `Status` event; exactly one terminal
      `Result`/`Error` event, never zero or two.
- [x] 5.4 `DashboardAuthoringRoutesSpec`: buffered and `?stream=true` paths both wired correctly;
      missing-key degrades to `503`, not a route-registration failure.
- [x] 5.5 Confirm `sbt test` is green with no real network call (stub transport throughout, no test
      depends on `ANTHROPIC_API_KEY`/live network).

## 6. Docs

- [x] 6.1 Add `POST /api/authoring/dashboard` to `CLAUDE.md`'s "Key endpoints" list.

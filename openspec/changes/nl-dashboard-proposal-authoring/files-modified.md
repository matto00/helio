# Files modified — HEL-392

- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — D1: extracted
  `validate(proposal, user): Future[Either[ServiceError, Unit]]` out of `apply` (structural check +
  `ProposalPanelSupport.preValidateBindings`, no side effects); `apply` now calls `validate` first,
  behavior-preserving.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala` — new:
  `DashboardAuthoringService` — assembles grounding context (`WorkspaceContextService.assemble` +
  a `PanelCapabilityService.getCapabilities` fan-out, degrade-not-fail per type), empty-workspace
  422 short-circuit, buffered `author` and streaming `authorStreaming` (`ClaudeClient.stream`,
  `Progress`/`Status("repairing")`/terminal `Result`/`Error`), shared parse→validate→repair core
  (exactly one repair round-trip), and `ClaudeError` → `ServiceError` mapping.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringPrompt.scala` — new: builds the
  Claude prompt (instructions + `DashboardProposal`/`ProposalPanel` wire-shape description +
  grounding context + panel-capability menu + goal) and the repair-round-trip prompt text.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringParsing.scala` — new: defensive
  brace-matched (string-aware) JSON-object extraction from Claude's free-text response, then parses
  via the existing `DashboardProposalProtocol` spray-json formatter.
- `backend/src/main/scala/com/helio/api/protocols/DashboardAuthoringProtocol.scala` — new:
  `DashboardAuthoringRequest`/`AuthoringContextOptions`/`DashboardAuthoringResponse` case classes +
  spray-json formats, and the `AuthoringStreamEvent` SSE ADT (`Progress`/`Status`/`Result`/`Error`)
  with `toSseBytes` (mirrors `RunStatusEvent.toSseBytes`).
- `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala` — new:
  `POST /api/authoring/dashboard` (buffered) and `?stream=true` (SSE, `HttpEntity.Chunked.fromData`,
  mirrors `PipelineRunStreamRoutes`); takes `Option[DashboardAuthoringService]` and completes a
  clean `503` when absent (missing `ANTHROPIC_API_KEY`), rather than falling through to a bare `404`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `DashboardAuthoringService`
  (constructed from the already-built `workspaceContextService`/`panelCapabilityService`/
  `proposalService` plus a `ClaudeClient` over `ClaudeConfig.fromEnv()`, `None` on a missing key)
  and mounts `DashboardAuthoringRoutes` unconditionally (so the missing-key case still resolves to
  `503`, not `404`).
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in the new
  `DashboardAuthoringProtocol` trait; doc-comment note on its `DashboardProposalProtocol` dependency.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports
  `AuthoringContextOptions`/`DashboardAuthoringRequest`/`DashboardAuthoringResponse`/
  `AuthoringStreamEvent` into `com.helio.api` (mirrors the existing per-type re-export convention so
  route files can `import com.helio.api._` and reference these types by name).
- `backend/src/test/scala/com/helio/services/DashboardProposalServiceValidateSpec.scala` — new
  unit spec (mocked `DataTypeRepository`/`MetricRepository`, no Postgres harness) for
  `DashboardProposalService.validate` (task 5.1).
- `backend/src/test/scala/com/helio/services/DashboardAuthoringServiceSpec.scala` — new spec:
  embedded-Postgres-backed real `WorkspaceContextService`/`PanelCapabilityService`/
  `DashboardProposalService` + a stub `ClaudeTransport` (zero real network calls) covering
  valid-first-try, repair-then-succeed, repair-then-422, empty-workspace short-circuit,
  companion-binding rejection, and the streaming variant's `Progress`/`Status`/terminal-event
  scenarios (tasks 5.2/5.3).
- `backend/src/test/scala/com/helio/services/DashboardAuthoringParsingSpec.scala` — new spec for
  the defensive brace-matched JSON extraction (prose-wrapped, nested braces, braces/escaped quotes
  inside strings, truncated output).
- `backend/src/test/scala/com/helio/api/routes/DashboardAuthoringRoutesSpec.scala` — new HTTP-shell
  spec: buffered 200, `?stream=true` SSE content-type, and the missing-service 503 (task 5.4).
- `schemas/dashboard-authoring-request.schema.json` — new: `DashboardAuthoringRequest` schema.
- `schemas/dashboard-authoring-response.schema.json` — new: `DashboardAuthoringResponse` schema,
  `proposal` `$ref`-ing the existing `dashboard-proposal.schema.json`.
- `CLAUDE.md` — added `POST /api/authoring/dashboard` to the "Key endpoints" list (task 6.1).

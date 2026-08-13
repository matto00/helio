## 1. Backend: shared validation extraction

- [x] 1.1 Add `DashboardProposalService.validate` (extracted from `apply`, behavior-preserving —
      route-level `DashboardApplyProposal*Spec` + `DashboardProposalProtocolSpec` stay green).

## 2. Backend: protocol

- [x] 2.1 `DashboardAuthoringRequest`/`AuthoringContextOptions` in `DashboardAuthoringProtocol.scala`.
- [x] 2.2 `DashboardAuthoringResponse(proposal, warnings)`.
- [x] 2.3 Two JSON Schemas (`dashboard-authoring-request`/`-response`, one title each, response
      `$ref`-ing `dashboard-proposal.schema.json`).
- [x] 2.4 `AuthoringStreamEvent` (sealed: `Progress`/`Status`/`Result`/`Error`) + `toSseBytes`.

## 3. Backend: DashboardAuthoringService

- [x] 3.1 Assemble grounding context (`WorkspaceContextService.assemble` +
      `PanelCapabilityService.getCapabilities` fan-out, degrade-not-fail per type).
- [x] 3.2 Empty-workspace short-circuit before any `ClaudeClient` call.
- [x] 3.3 Build the system prompt (JSON-only instruction, pipeline-output-only binding).
- [x] 3.4 Shared parse→validate→repair core: JSON parse (brace-matched extraction), one bounded
      repair round-trip, second failure → `UnprocessableEntity`.
- [x] 3.5 `author` (buffered, `ClaudeClient.send`).
- [x] 3.6 `authorStreaming` (`ClaudeClient.stream`, `Progress`/`Status("repairing")`/one terminal
      `Result`/`Error`).
- [x] 3.7 `ClaudeError` → `ServiceError` mapping (D8).

## 4. Backend: routes

- [x] 4.1 `DashboardAuthoringRoutes`: buffered + `?stream=true` SSE (mirrors
      `PipelineRunStreamRoutes`'s `HttpEntity.Chunked.fromData` shape).
- [x] 4.2 Wire into `ApiRoutes.scala`; missing `ANTHROPIC_API_KEY` degrades to `503`, not a startup
      failure.

## 5. Tests

- [x] 5.1 New unit spec (mocked repos) for `DashboardProposalService.validate`.
- [x] 5.2 `DashboardAuthoringServiceSpec`: valid/repair/repair-exhausted/empty-workspace/
      non-pipeline-output-binding cases, invocation counts asserted.
- [x] 5.3 `AuthoringStreamEventSpec`: progress assembly, repair status event, exactly one terminal
      event.
- [x] 5.4 `DashboardAuthoringRoutesSpec`: buffered + streaming wiring, missing-key → `503`.
- [x] 5.5 `sbt test` green, no real network call.

## 6. Docs

- [x] 6.1 `CLAUDE.md` "Key endpoints" entry.

## 7. Tests: fold-in — mapClaudeError end-to-end coverage (post-delivery follow-up A)

- [x] 7.0 Add a `spec.md` Requirement + two Scenarios (buffered + streaming) documenting the
      `ApiError`/`TransportFailure` → `502 Bad Gateway` mapping — this endpoint had no written spec
      coverage for it before this fold-in (only a `design.md` D8 Decision), unlike the
      `GuardrailExceeded`/422 branch which already had one.
- [x] 7.1 `DashboardAuthoringServiceSpec`: a `GuardrailExceeded` case (a `ClaudeConfig` whose
      `maxInputTokens` is below the assembled prompt's estimated length) — assert `author` resolves
      to `Left(ServiceError.UnprocessableEntity(...))`, matching `spec.md`'s existing scenario.
- [x] 7.2 Add an `ApiError`/`TransportFailure` case each — assert `author` resolves to
      `Left(ServiceError.BadGateway(...))` for both, matching task 7.0's new scenario.
- [x] 7.3 Mirror 7.1/7.2 for `authorStreaming`, asserting the terminal `AuthoringStreamEvent.Error`
      carries the same mapped message.
- [x] 7.4 Confirm `sbt test` is still green (full suite, no real network call).

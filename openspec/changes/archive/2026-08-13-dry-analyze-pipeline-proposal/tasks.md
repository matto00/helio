## 1. Schema

- [x] 1.1 Add `schemas/pipeline-analyze-proposal-response.schema.json` (JSON Schema 2020-12):
      `PipelineAnalyzeProposalResponse` with `sourceName`, `outputDataTypeName`, `sourceSchema`
      (array of `SchemaField`, reused verbatim), `steps` (array of a **new** step shape —
      `{id, position, type, config, inputSchema, outputSchema, validationError?}`, `type` a required
      string discriminator, `config` a required object with `additionalProperties: true` — matching
      the *actual* discriminated-union wire format `analyzeStepResponseFormat` emits, NOT a copy of
      `pipeline-analyze-response.schema.json`'s stale `$defs.AnalyzeStep`, which still declares a
      pre-CS2c-3a `op`/string-`config` shape. design.md D6.) — no `id`/`outputDataTypeId` on the
      top-level response (design.md D4).

### Backend

- [x] 2.1 Add `PipelineAnalyzeProposalResponse` case class + `RootJsonFormat` to a new
      `PipelineAnalyzeProposalProtocol.scala` (or alongside `PipelineAnalyzeProtocol` if it fits
      cleanly), reusing `SchemaFieldResponse` and the existing `AnalyzeStepResponse` union verbatim
      (design.md D4). Mix into `JsonProtocols.scala`.
- [x] 2.2 Add `PipelineService.analyzeProposal(proposal: PipelineProposal, user: AuthenticatedUser):
      Future[Either[ServiceError, PipelineAnalyzeProposalResponse]]` (design.md D1). Thread
      `SqlConnector`/`RestApiConnector` access the same way `SourceService` already has it (same
      connector instance, injected the same way).
- [x] 2.3 Implement source-schema resolution per design.md D2, checking `sourceId` **first, before any
      inline branch** (precedence: `sourceId`, when present, always wins over an inline `type` —
      design.md D2 / skeptic design-gate CR3): existing `sourceId` → `dataSourceRepo.findByIdOwned`
      (404 on `None`) → `dataTypeRepo.findBySourceId`; else inline `sql` → first check `sqlConfig` is
      `Some` (else `ServiceError.BadRequest` per below), then `SqlConnector.checkQuery` then
      `SqlConnector.inferSchema`; inline `rest_api` → first check `restConfig` is `Some`, then
      `RestApiConnector.inferSchema`; inline `static` → first check `staticConfig` is `Some`, then
      build the schema directly from `columns`; inline `csv` → `ServiceError.BadRequest` with a clear
      message; a recognized inline `type` whose matching config `Option` is `None` →
      `ServiceError.BadRequest(s"inline '$type' source requires a 'config' object")` (design.md D2 —
      a proven-reachable state per `PipelineProposalProtocolSpec`'s "omit the config key entirely"
      test, never a `.get`/unguarded match); neither `sourceId` nor a recognized `type` present →
      `ServiceError.BadRequest`.
- [x] 2.4 Convert `proposal.steps` to `PipelineAnalyzeService.PipelineStepInput` with synthetic
      positional ids (`s"step-$i"`) and `config = req.config.compactPrint` (design.md D3); call
      `PipelineAnalyzeService.analyze` (unchanged); map each resulting `AnalyzedStep` →
      `AnalyzeStepResponse` by calling the existing `PipelineService.toAnalyzeStepResponse(s:
      AnalyzedStep): AnalyzeStepResponse` (`PipelineService.scala:211`) as-is — it already takes only
      an `AnalyzedStep`, not a persisted `Pipeline`, so it needs no factoring/refactor to be called a
      second time from `analyzeProposal`; both methods just call the same existing function.
- [x] 2.5 Add `POST /pipelines/analyze-proposal` to `PipelineRoutes.scala`, entity-decoded as
      `PipelineProposal`, calling `pipelineService.analyzeProposal`. Place this route **before**
      the `path(PipelineIdSegment / "analyze")` and `path(PipelineIdSegment)` branches in the
      `concat` block (design.md D5 — `PipelineIdSegment` is an unconstrained `Segment` matcher that
      would otherwise swallow the literal `analyze-proposal` segment as a bogus pipeline id).

### Tests

- [x] 3.1 Add `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeProposalRoutesSpec.scala`,
      matching the existing route-level integration-test convention for this area (see the sibling
      `PipelineAnalyzeRoutesSpec.scala` — `PipelineService` has no standalone `*ServiceSpec`; it's
      tested entirely through route-level specs against an embedded Postgres).
- [x] 3.2 Test: proposal with an existing, accessible `sourceId` returns the projected schema; no
      source/pipeline/step row is created (assert against the repo/DB directly).
- [x] 3.3 Test: proposal with an inline `static` source returns the schema derived from `columns`,
      with no connector call made.
- [x] 3.4 Test: proposal with an inline `sql` source whose query is a `SELECT` returns the inferred
      schema (against the test DB fixture already used by `SqlConnectorSpec`/`SourceServiceSpec`).
- [x] 3.5 Test: proposal with an inline `sql` source whose query contains a DDL/DML keyword returns
      `400` and never reaches `SqlConnector.execute` (mirrors the existing `checkQuery` short-circuit
      test pattern in `DataSourceRoutesSpec.scala:894`).
- [x] 3.6 Test: proposal with an inline `csv` source returns `400` with a clear message.
- [x] 3.7 Test: a step with an invalid config surfaces a per-step `validationError` in a `200`
      response (not a thrown exception / 500).
- [x] 3.8 Test: a structurally invalid proposal (missing a required top-level field) returns `400`.
- [x] 3.9 Test: a `sourceId` owned by a different user returns `404`, with no schema data from that
      source in the response body (RLS scoping).
- [x] 3.10 Test: a proposal whose inline `source.type` is a recognized kind (`sql`/`rest_api`/`static`)
      but whose matching config field is entirely absent from the request body returns `400` (not a
      thrown exception / 500) — design.md D2's config-absent branch, at least one of the three kinds
      (skeptic design-gate CR2).
- [x] 3.11 Test: `pipelineAnalyzeProposalResponseFormat.write(...)`'s output for a real response
      (covering at least one step) validates cleanly against
      `schemas/pipeline-analyze-proposal-response.schema.json` using the existing
      `JsonSchemaValidation` harness (`backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala`,
      already used by `WorkspaceContextServiceSpec`) — the actual verification signal for AC #6
      (skeptic design-gate CR1b).
- [x] 3.12 Test: a proposal supplying both an existing `sourceId` and an inline `type`/`config` on the
      same `source` resolves via the existing-source branch (`sourceId` wins — design.md D2 precedence
      rule / skeptic design-gate CR3), not the inline branch.
- [x] 3.13 Run `sbt test` and confirm the full suite is green.
- [x] 3.14 (evaluation-1.md CR1) Add `PipelineService.analyzeProposal`'s missing
      `PipelineStepKind.All` guard (mirroring `addStep`'s existing check) so a proposal step whose
      `type` is not a registered kind returns `400` — never reaches `toAnalyzeStepResponse`'s
      `PipelineStepConfigCodec.decode` re-decode path, which throws an uncaught
      `IllegalStateException` for an unregistered kind (unhandled `500`, no `ExceptionHandler`
      registered anywhere in the backend). Test: a proposal step with a `type` outside
      `PipelineStepKind.All` returns `400`, never a `500`.

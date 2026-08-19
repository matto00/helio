## 1. Backend

### Backend

- [x] 1.1 Add `test_connection` `ClaudeTool` schema to `AssistantProposalToolSchemas.scala`: input
      `{type: enum[rest_api, sql], config: object}` reusing the same `rest_api`
      `{url, method?, auth?, headers?}` / `sql` `{dialect, host, port, database, user, password, query}`
      shapes `PipelineProposalSourceSchema` already documents. Add it to
      `AssistantProtocol.assistantTools` (find, get_resource, test_connection, then the 4 propose_*
      tools — matches the system-prompt tool list ordering in design.md D5).
- [x] 1.2 Thread `sourceService: SourceService` into `AssistantToolExecutor`'s constructor (new
      collaborator, same style as its existing 6 services) and `AssistantService`'s constructor;
      update `ApiRoutes.scala`'s `new AssistantService(...)` call (line ~437) to pass the already-
      constructed `sourceService` (line ~181).
- [x] 1.3 In `AssistantToolExecutor`, add `execute`'s `case "test_connection" => executeTestConnection(input)`
      dispatch and implement `executeTestConnection`: decode by `type` into `RestApiConfigPayload` or
      `SqlInferRequest`/`SqlSourceConfigPayload` (mirror `SourcePreviewRoutes`'s `POST /sources/test`
      dispatch), call `sourceService.testRest`/`testSql`, and on a `Right(TestConnectionResponse)`
      with `ok = true` record the config into a new thread-safe `verifiedConfigs` field (design.md
      D1 — `AtomicReference[Set[VerifiedConfig]]`, a closed ADT over `RestApiConfigPayload`/
      `SqlSourceConfigPayload`); return the `TestConnectionResponse` JSON as the tool result either way
      (`ok = false` is a normal, non-error tool result, not a `Left` — mirrors `ConnectionTest.run`'s
      own "domain outcome, not HTTP error" framing).
- [x] 1.4 Add a private `requireVerifiedInlineSource(source: PipelineProposalSource): Either[String, Unit]`
      helper: `Right(())` for a `sourceId` source or an inline `csv`/`static` source; for inline
      `rest_api`/`sql`, `Right(())` iff `source.restConfig`/`source.sqlConfig` is a member of
      `verifiedConfigs`, else `Left("<tool>: call test_connection with this exact config before
      finalizing this proposal")`.
- [x] 1.5 Call `requireVerifiedInlineSource` from `executeProposePipeline` (on `proposal.source`) and
      `executeProposeCombined` (on `proposal.pipeline.source`) immediately after a successful
      `decode`, before the existing `validate`/`preview` call — a rejection increments
      `proposeValidationFailuresCounter` exactly like an existing validation failure does, and skips
      the underlying service call entirely.
- [x] 1.6 Raise `AssistantService.MaxHops` from `3` to `4` (design.md D3); update its doc comment.
- [x] 1.7 Update `AssistantSystemPrompt.text`: document the new `test_connection(type, config)` tool
      in the tools list, add a hard rule that an inline `rest_api`/`sql` source must be verified with
      `test_connection` (in its own hop, before the `propose_pipeline`/`propose_combined` call that
      uses it — design.md D2), and update the hop-count rule's number from 3 to 4.

## 2. Tests

### Tests

- [x] 2.1 `AssistantProposalToolSchemasSpec`: `test_connection`'s schema decodes a rest_api and a sql
      example via the same conversion path a real call hits.
- [x] 2.2 `WorkspaceAssistantToolsSpec`/`AssistantProtocol`-level test (or extend
      `AssistantToolExecutorSpec`): `AssistantProtocol.assistantTools` has 7 entries and includes
      `test_connection`; still no apply-shaped tool (existing Hard Boundary test extended, not
      duplicated).
- [x] 2.3 `AssistantToolExecutorSpec`: `test_connection` dispatches to `sourceService.testRest`/`testSql`
      and returns the `TestConnectionResponse` JSON for both a success and a failure result.
- [x] 2.4 `AssistantToolExecutorSpec`: `propose_pipeline`/`propose_combined` with an untested inline
      `rest_api`/`sql` source is rejected with an `isError`-bound `Left`, and the underlying
      `pipelineProposalService.validate`/`combinedProposalService.validate` mock is never invoked.
- [x] 2.5 `AssistantToolExecutorSpec`: a `test_connection` success followed by a `propose_pipeline`/
      `propose_combined` call with the identical config proceeds to `validate` normally.
- [x] 2.6 `AssistantToolExecutorSpec`: a failed `test_connection` does not verify the config (a
      subsequent `propose_pipeline` with that config is still rejected); an edited config after a
      successful test is also still rejected.
- [x] 2.7 `AssistantToolExecutorSpec`: `sourceId`-referenced sources and inline `csv`/`static` sources
      bypass the gate entirely (no `test_connection` call required).
- [x] 2.8 `AssistantServiceSpec`: `converse` passes `maxHops = 4` to `ClaudeToolRequest`; a scripted
      5th tool-use hop still resolves to `HopBudgetExhausted` gracefully.
- [x] 2.9 `AssistantSystemPromptSpec`: the prompt text mentions `test_connection` and states the
      "verify before finalizing" rule and the updated hop count.

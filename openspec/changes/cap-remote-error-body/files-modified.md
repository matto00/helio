- `backend/src/main/scala/com/helio/domain/connectors/RemoteErrorText.scala` — new shared cap (500 code points, marker, surrogate-safe, idempotent), moved from HEL-1727's helper
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — cap the `HTTP <code>: <body>` text in issueAndParse and issueTest
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRootDryRun.scala` — removed its own 500/marker/capFetchError; uses RemoteErrorText.cap
- `backend/src/test/scala/com/helio/testkit/RemoteErrorBodyStub.scala` — local 500 stub plus literal expected texts
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverErrorCapSpec.scala` — driver fetch and test-connection tests
- `backend/src/test/scala/com/helio/domain/connectors/RemoteErrorTextSpec.scala` — helper unit and idempotence tests
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorRemoteErrorCapSpec.scala` — test_connection tool result (C1)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRemoteErrorCapSpec.scala` — apply blocked reason and stored error_log (C2)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala` — `restDriver` hook so a subclass can run the real driver
- `openspec/changes/cap-remote-error-body/evidence/` — red run and mutation run output

helio-mcp finding: `grep -rn "HTTP \|truncated\|fetchError" helio-mcp/src` shows only docs/test strings about HTTP statuses; it relays backend text and needs no change (no MCP redeploy).

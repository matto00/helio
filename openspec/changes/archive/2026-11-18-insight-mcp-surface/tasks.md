## 1. Backend test-only seam

### Backend

- [x] 1.1 Write `InsightSeamSpec` on the real `ApiRoutes` with a scripted `claudeTransportFactory` (design D7: seeded world, six legs, `refresh: "manual"`, `eventually` wait, model call-count assertion) and see it red with no committed fixture; record the red run
- [x] 1.2 Generate `shared-test-fixtures/insight/exit-criterion.json` with `HEL1747_WRITE_FIXTURE=1`; verify the narrative and answer each carry a citation, the spec is green, and mutating one recorded value turns it red
- [x] 1.3 Reword the stale `OutputConfigValidation.scala:39-41` comment (D8); verify `sbt compile` passes

## 2. helio-mcp tools

### helio-mcp

- [x] 2.1 Write red tests first: kind-enum drift test (D5); add_output/create_pipeline/propose_pipeline/apply_combined_proposal/add_outputs_from_shape accept `insight`; D6 doc assertions (stored-ids sentence on add_output, create-time 400 sentence on create_pipeline and propose_pipeline); `place_outputs` with an insight Output; `HelioApi` method/URL/body tests for the three new methods; tool tests for get_output_insight/refresh_insight/ask_dashboard (empty and 2001-char question rejected with no request); the three names in `EXPECTED_TOOL_NAMES`; record the red runs
- [x] 2.2 Add `tools/outputKinds.ts` with `insight` and wire every enum site to it; verify the drift and accept tests go green and dropping `insight` turns them red
- [x] 2.3 Add `INSIGHT_CONFIG_DOC`, `INSIGHT_CREATE_READS_DOC` and the `insight:` keys entry (D6); verify the doc assertion tests pass
- [x] 2.4 Add `HelioApi.getOutputInsight/refreshOutputInsight/askDashboard` plus response types; verify the API tests pass
- [x] 2.5 Add `get_output_insight`/`refresh_insight` (outputs.ts, outputsHandlers.ts) and `ask_dashboard` (new ask.ts, askHandlers.ts, registered in server.ts); verify the tool tests and `server.test.ts` pass
- [x] 2.6 Update `helio-mcp/README.md` and the tool-to-route table in `docs/agent-native.md`; verify every new tool name appears in both

## 3. Tests

### Tests

- [x] 3.1 Write `insightExitCriterion.test.ts` (D7) over the recorded legs; see it red before 2.5 lands, then green; record both runs (Deviation, recorded truthfully: the MCP replay test was written after 2.5, not before; its red evidence is `.concertino/scratch/HEL-1747/red-exit-mcp-pre-tools.txt`, a run with the three tool registrations removed, plus mutation runs.)
- [x] 3.2 Run the full root jest suite (3 workers), `npm run check:helio-mcp-types`, lint, and the FULL `sbt testFull` (-J-Xmx3g, nice -n 19); all green
- [x] 3.3 Grep e2e/ and helio-mcp tests for every changed identifier (`outputKindSchema`, tool names, kind enums); verify nothing references a removed name
- [x] 3.4 Run `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`; verify green with no lockfile change

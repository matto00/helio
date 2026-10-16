# HEL-1619 measurements and red/green transcripts

Fixture: `helio-mcp/src/contextBudgetFixture.ts` (55 pipelines, 110 Outputs, 19 placed on 1 dashboard), through the real `HelioHttpClient` + `HelioApi` with a counting fake `fetch` (5 ms per response).

## Golden (task 2.0)

Captured from the PRE-change `buildWorkspaceContext` (`context.ts` stashed to main db91c840e):
```
(cd helio-mcp && node_modules/.bin/tsx scripts/captureContextGolden.ts)   # with the unmodified context.ts
```
Files: `helio-mcp/src/__golden__/workspaceContext.{full,concise}.json` (`generatedAt` stripped, budget 50 MB so nothing is truncated). Re-checked after prettier re-formatting, against the unmodified `context.ts`:
```
    ✓ full mode, batched read (15 ms)
    ✓ concise mode, batched read (6 ms)
    ✓ full mode, 404 fallback (9 ms)
    ✓ concise mode, 404 fallback (8 ms)
    ✓ full mode, 500 fallback (6 ms)
    ✓ concise mode, 500 fallback (8 ms)
    ✓ full mode, batched read missing one pipeline (7 ms)
    ✓ concise mode, batched read missing one pipeline (7 ms)
    ✓ full mode, batched read, panelCount absent (9 ms)
    ✓ concise mode, batched read, panelCount absent (8 ms)
    ✓ the golden exercises the cases the proof needs (1 ms)
Tests:       10 skipped, 11 passed, 21 total
```

## Request count and peak in flight: before (unfixed context.ts) and after
```
# before: npx tsx scripts/measureContextRequests.ts  with context.ts stashed
{"mode":"serve","total":339,"peakInFlight":220,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":110,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55,"/api/pipelines/:id/run-history":55,"/api/pipelines/:id":55,"/api/pipelines/:id/ste
{"mode":"404","total":339,"peakInFlight":220,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":110,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55,"/api/pipelines/:id/run-history":55,"/api/pipelines/:id":55,"/api/pipelines/:id/steps
{"mode":"missing-one","total":339,"peakInFlight":220,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":110,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55,"/api/pipelines/:id/run-history":55,"/api/pipelines/:id":55,"/api/pipelines/:

# after
{"mode":"serve","total":84,"peakInFlight":6,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/pipelines/context-details":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":19,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55}}
{"mode":"404","total":194,"peakInFlight":6,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/pipelines/context-details":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":19,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55,"/api/pipelines/:id/run-history":55,"/api/pipelines/:id/steps":55}}
{"mode":"missing-one","total":86,"peakInFlight":6,"byRoute":{"/api/preferences":1,"/api/agent/memory":1,"/api/connectors":1,"/api/outputs":1,"/api/pipelines/context-details":1,"/api/data-sources":1,"/api/dashboards":1,"/api/pipelines":1,"/api/pipeline-shapes":1,"/api/outputs/:id/panels":19,"/api/dashboards/:id/export":1,"/api/pipelines/:id/analyze":55,"/api/pipelines/:id/run-history":1,"/api/pipelines/:id/steps":1}}
```

## Request-count test RED on the unfixed code (task 3.1)
```
FAIL helio-mcp/src/contextRequestBudget.test.ts
  get_workspace_context request budget (HEL-1619)
    ✕ sends exactly 84 requests on the 55-pipeline fixture when the batched read exists, within the 120/60s limit (13 ms)
    ✕ sends no per-pipeline /steps, /run-history or pipeline-summary request, and one placements request per PLACED Output only (15 ms)
    ✕ older server (404): falls back per pipeline and costs 194 requests -- still fewer than the 339 of the pre-change code (9 ms)
    ✓ the OUTPUTS_PER_PIPELINE x PIPELINE_COUNT fixture really has 110 Outputs (premise: 339 on the unfixed code)
    ✕ never has more than MAX_IN_FLIGHT requests in flight, fixed fetches included (25 ms)
    ✕ sends no placements request for an Output reporting panelCount 0, but still asks when panelCount is absent (7 ms)
  get_workspace_context payload is byte-identical to the pre-change golden (HEL-1619, C1)
    ✓ full mode, batched read (9 ms)
    ✓ concise mode, batched read (21 ms)
    ✓ full mode, 404 fallback (6 ms)
    ✓ concise mode, 404 fallback (24 ms)
    ✓ full mode, 500 fallback (9 ms)
    ✓ concise mode, 500 fallback (18 ms)
    ✓ full mode, batched read missing one pipeline (10 ms)
    ✓ concise mode, batched read missing one pipeline (16 ms)
    ✓ full mode, batched read, panelCount absent (8 ms)
    ✓ concise mode, batched read, panelCount absent (19 ms)
    ✓ the golden exercises the cases the proof needs (1 ms)
  get_workspace_context fallback visibility (HEL-1619 D10)
    ✕ warns once on stderr when the batched read fails with a non-404 error (8 ms)
    ✓ does not warn on a 404 (older server) (8 ms)
    ✕ warns when the response omits pipelines, and fetches exactly the missing one per pipeline (8 ms)
...
    Expected: 84
    Received: 339   (and peak in flight 220, see above)
```

## MCP seam guard RED with one key renamed (fixture `pipelineId` -> `pipeline_id`)
```
    ✕ the fake body every context test serves conforms to the committed schema (36 ms)
    ✓ covers a never-run pipeline (no latestRunAssertions key) and a zero-step pipeline (1 ms)
    ✓ the schema rejects a renamed key, at the envelope, the item and the step level (the guard can fail) (20 ms)
    ✓ a body the schema rejects makes buildWorkspaceContext fall back for every pipeline (why the guard matters) (42 ms)
    Expected: true
    Received: false
Tests:       1 failed, 3 passed, 4 total
```

## Backend seam guard RED with one key renamed in the committed schema (`pipelineId` -> `pipeline_id`)
```
[info] - should respond 401 without a credential, like GET /api/pipelines
[info] - should return exactly the owner-scoped pipelines GET /api/pipelines lists, in the same order; a viewer-granted pipeline is absent
[info] - should include a pipeline with no steps and no runs as steps: [] with no latestRunAssertions key
[info] - should return steps equal to GET /:id/steps (branched, multi-root) and latestRunAssertions equal to run-history[0]
[info] - should never expose another user's pipelines, steps or assertions on a non-BYPASSRLS pool
[info] - should produce a body that validates against the committed schema (seam guard, backend half) *** FAILED ***
[info]   Vector("$.items[0].pipeline_id: is missing but it is required", "$.items[0].pipelineId: is not defined in the schema and the schema does not allow additional properties", "$.items[1].pipeline_id: is missing but it is required", "$.items[1].pipelineId: is not defined in the schema and the schema does not allow additional properties") was not empty (PipelineContextDetailsRoutesSpec.scala:18
[info] Tests: succeeded 5, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## Live probe: real MCP client against the worktree backend (port 9958, isolated DB helio_hel1619)

GREEN (`npx tsx scripts/contextDetailsLiveProbe.ts http://localhost:9958 12`):
```
{
 "baseUrl": "http://localhost:9958",
 "pipelines": 12,
 "pipelinesSeen": 12,
 "lanesWithSteps": 12,
 "requestsFor2Builds": 42,
 "contextDetailsReqs": 2,
 "stepsReqs": 0,
 "historyReqs": 0,
 "summaryReqs": 0,
 "panelsReqs": 0,
 "byRoute": {
  "GET /api/agent/memory": 2,
  "GET /api/connectors": 2,
  "GET /api/dashboards": 2,
  "GET /api/data-sources": 2,
  "GET /api/outputs": 2,
  "GET /api/pipeline-shapes": 2,
  "GET /api/pipelines": 2,
  "GET /api/pipelines/:id/analyze": 24,
  "GET /api/pipelines/context-details": 2,
  "GET /api/preferences": 2
 },
 "stderrWarnings": [],
 "payloadEqualsPerPipelineFallback": true,
 "conciseNonEmpty": true
}
PROBE PASS
```

RED (client mutated to read `item.pipeline_id`; 6 pipelines, because the 12-pipeline fallback itself exhausted the real 120/60s limit and returned a 429 on the first attempt):
```
{
 "baseUrl": "http://localhost:9958",
 "pipelines": 6,
 "pipelinesSeen": 6,
 "lanesWithSteps": 6,
 "requestsFor2Builds": 54,
 "contextDetailsReqs": 2,
 "stepsReqs": 12,
 "historyReqs": 12,
 "summaryReqs": 0,
 "panelsReqs": 0,
 "byRoute": {
  "GET /api/agent/memory": 2,
  "GET /api/connectors": 2,
  "GET /api/dashboards": 2,
  "GET /api/data-sources": 2,
  "GET /api/outputs": 2,
  "GET /api/pipeline-shapes": 2,
  "GET /api/pipelines": 2,
  "GET /api/pipelines/:id/analyze": 12,
  "GET /api/pipelines/:id/run-history": 12,
  "GET /api/pipelines/:id/steps": 12,
  "GET /api/pipelines/context-details": 2,
  "GET /api/preferences": 2
 },
 "stderrWarnings": [
  "helio-mcp: GET /api/pipelines/context-details unusable (omitted 6 of 6 pipelines); reading each pipeline separately\n",
  "helio-mcp: GET /api/pipelines/context-details unusable (omitted 6 of 6 pipelines); reading each pipeline separately\n"
 ],
 "payloadEqualsPerPipelineFallback": true,
 "conciseNonEmpty": true
}
PROBE FAIL
```

## Cycle 2: PAT revocation and which database the probe used

- Every probe run used the isolated database `helio_hel1619`, never the shared `helio` DB. The backend was started with `DATABASE_URL` exported in the shell (the shell wins over `backend/.env`, per `DevEnv.runEnv`); the backend log showed Flyway applying all 135 migrations from scratch to it. Read-only check on the shared DB afterwards: `select count(*) from users where email like 'hel1619-probe-%'` returned 0 (and the probe tokens are in `helio_hel1619.api_tokens` only). Nothing was created in the shared `helio` DB, and nothing was deleted from it.
- The five earlier probe runs each minted a 1-day PAT and did not revoke it. In `helio_hel1619` (the isolated DB, which only the probe used) I deleted those five `api_tokens` rows by `user_id` of the `hel1619-probe-%` users (the table has no `revoked_at`; delete is how a token is revoked). Result: 5 rows deleted, `api_tokens` count 0.
- `contextDetailsLiveProbe.ts` now revokes its PAT in a `finally` block through `revokePat` (DELETE then confirm the token answers 401) and fails the probe if that fails. Fresh green run against `helio_hel1619` only:
```
{
 "baseUrl": "http://localhost:9958",
 "pipelines": 12,
 "pipelinesSeen": 12,
 "lanesWithSteps": 12,
 "requestsFor2Builds": 42,
 "contextDetailsReqs": 2,
 "stepsReqs": 0,
 "historyReqs": 0,
 "summaryReqs": 0,
 "panelsReqs": 0,
 "byRoute": {
  "GET /api/agent/memory": 2,
  "GET /api/connectors": 2,
  "GET /api/dashboards": 2,
  "GET /api/data-sources": 2,
  "GET /api/outputs": 2,
  "GET /api/pipeline-shapes": 2,
  "GET /api/pipelines": 2,
  "GET /api/pipelines/:id/analyze": 24,
  "GET /api/pipelines/context-details": 2,
  "GET /api/preferences": 2
 },
 "stderrWarnings": [],
 "payloadEqualsPerPipelineFallback": true,
 "conciseNonEmpty": true
}
PROBE PASS
PAT d8a8f38f-80a0-4d48-a559-ae53e0c1a8a1 revoked and no longer authenticates (HTTP 401)
```
After it: `api_tokens` count in helio_hel1619 = 0; probe users in the shared `helio` DB = 0.

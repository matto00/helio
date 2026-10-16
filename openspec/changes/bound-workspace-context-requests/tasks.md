## Standing Constraints

- [C1] The MCP `get_workspace_context` payload (full and concise, excluding `generatedAt`) stays byte-identical to the pre-change code on both the batch and fallback paths, proven against a golden captured from main's code.
- [C2] The new backend read is additive: no existing route's status/body/headers change; its JSON schema lands in the same change.
- [C3] Ownership is proven on a non-BYPASSRLS pool (TwoUserRlsApiFixture), not only as superuser.
- [C4] Any migration takes the next free Flyway version after V135, verified free across open branches/PRs.
- [C5] House rules: scratch only in /home/matt/Development/helio/.concertino/scratch/HEL-1619/; check /proc/loadavg (wait while 1-min > 10); jest/Playwright ≤2 workers under nice -n 19; full sbt testFull wrapped in `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`; full Playwright in the matching e2e.lock; never kill/signal processes, no pkill/pgrep/killall; stop servers only via scripts/concertino/stop-servers.sh; Bash timeout 600000 on long calls.
- [C6] Seam contract (D10): MCP fake body and backend response both validated against the committed schema, plus a live probe with zero /steps and /run-history requests; each guard shown red once by key mutation.

### Backend

## 1. Backend read

- [x] 1.1 Add `PipelineContextDetailsResponse`/`Item` protocol + JSON format (`latestRunAssertions` optional); verify compile.
- [x] 1.2 Add batched latest-run-per-pipeline + assertions reads (system context, ids from listSummaries only); verify unit/repo test.
- [x] 1.3 Add `PipelineService.contextStepsForOwner` (reuses the `/steps` mapper) and `PipelineRunService.latestAssertionsFor` (reuses `summarizeAssertions`), per D1; verify parity test 4.2.
- [x] 1.4 Add `PipelineContextDetailsRoutes`, concatenated in ApiRoutes before `PipelineRoutes`; verify route test 4.1.
- [x] 1.5 Add `schemas/pipelines/pipeline-context-details-response.schema.json`; verify schema test + schema-drift hook.

### Frontend

## 2. helio-mcp

- [x] 2.0 Capture the golden from main's `buildWorkspaceContext` on the 55-pipeline fixture BEFORE editing context.ts (full + concise), record the command; verify file committed.
- [x] 2.1 Add `HelioApi.getPipelineContextDetails` and `OutputResponse.panelCount?` (reuse existing `listPipelineSteps`); verify typecheck.
- [x] 2.2 Add an order-preserving, deadlock-safe per-call concurrency limiter (D8); verify unit tests incl. nested-await case.
- [x] 2.3 Rewire `buildWorkspaceContext`: batch read (self-caught), per-pipeline fallback via `listPipelineSteps`, panelCount skip, limiter; verify tests 3.x.
- [x] 2.4 Update helio-mcp README "Context serializer" call budget with the measured before/after numbers; verify text matches tests.

### Tests

## 3. MCP tests

- [x] 3.1 Request-count test through the real HelioHttpClient on the 55-pipeline fixture: ≤120 (exact count asserted) and >120 on the old path; show red on unfixed code.
- [x] 3.2 Byte-identical tests vs the golden: batch path, 404 fallback, missing-pipeline fallback, full and concise; non-404 fallback emits the stderr warning, 404 does not.
- [x] 3.3 Peak in-flight ≤ documented cap; panelCount 0 sends no panels request; absent panelCount does.
- [x] 3.4 Seam (D10a): MCP fake `context-details` body validated against the committed schema; red once with a mutated key.

## 4. Backend tests

- [x] 4.1 Route spec: 401 unauthenticated; items equal `GET /api/pipelines` ids in order (owner-scoped; a viewer-granted pipeline is absent); zero-step pipeline present with `steps: []`.
- [x] 4.2 Parity spec: per item, `steps` deep-equals `/steps`; `latestRunAssertions` equals `run-history[0].assertions`; omitted when never run.
- [x] 4.3 RLS spec on TwoUserRlsApiFixture: user B never sees A's pipelines/steps/assertions.
- [x] 4.4 Seam (D10a): backend spec validates the real route response against the same schema; red once with a mutated key.
- [x] 4.5 Seam (D10b): live probe of real MCP client vs worktree backend, zero /steps + /run-history requests, counts persisted as evidence; red once with a mutated key.
- [x] 4.6 Run affected backend specs, then full `sbt testFull` under the sbtfull.lock flock; record results.

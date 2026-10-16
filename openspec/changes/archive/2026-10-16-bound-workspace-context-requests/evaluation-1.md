## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `210bed286f9e000ddb2721958faa4a0b52a82075`. Diff base, resolved live: `db91c840ea729c1b3f662ae1eb01643ac1739e2d` (origin/main).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (a test shows the 55-pipeline call stays within budget): `contextRequestBudget.test.ts` asserts exactly 84 requests (≤120) on the batch path. I re-measured independently with `scripts/measureContextRequests.ts`. On a scratch copy with `context.ts` restored from db91c840e I got 339 total and 220 peak in every mode. At HEAD I got 84 total / peak 6 (serve), 194 / 6 (404) and 86 / 6 (missing-one). These match the executor's claims.
- AC2 (no default-payload field dropped): the payload is byte-identical (C1, below). Nothing is dropped and no opt-in is needed.
- All tasks are marked done and match the diff. There is no scope creep. Existing routes are unchanged: the new route class is mounted before `PipelineRoutes`, and no existing constructor or response changed. The schema lands in the same change (C2).
- Constraints:
  - **C1:** I regenerated the golden from db91c840e's `context.ts` in a scratch copy, using HEAD's fixture, `helioApi.ts` and `types.ts` (the only `helioApi.ts` change is the added method). The files differ byte-wise only in prettier indentation. Under compact `JSON.stringify` (key order preserved) both full and concise are identical to the committed goldens. So the goldens really did come from the pre-change code. The tests compare via `JSON.stringify`, not `toEqual`, so key order is enforced.
  - **C2:** holds.
  - **C3:** `PipelineContextDetailsRoutesSpec` runs on `TwoUserRlsApiFixture` (non-BYPASSRLS pool) and includes a cross-user leak test. It ran green in my testFull.
  - **C4:** N/A (no migration).
  - **C5:** followed in this evaluation.
  - **C6:** both schema guards include a permanent in-test negative: a renamed key at envelope, item and step level is rejected. The live probe and its red transcript are in measurements.md. See Phase 3 for why I did not re-run the probe.
- Ordering parity (asked specifically):
  - **Run tie-break:** `latestRunIdsInternalBatch` uses the same `ORDER BY started_at DESC`, with no secondary key, as `listByPipelineInternal`. It takes the first row per pipeline, so the rule is the same.
  - **`failures[]`:** `listAssertionsByRunsInternalBatch` has no ORDER BY, the same as `listAssertionsByRunInternal`, and keeps row order within each `groupBy` bucket. `summarizeAssertions` is reused, not copied.
  - **Equal timestamps:** neither the old nor the new query orders exact `started_at` ties or assertion rows deterministically. That is the same as before, not a regression (see suggestions).
  - **Steps:** they go through `listByPipelineInternalBatch` + `rootIdsOfBatch`, the same `executionOrder` and `PipelineStepResponse.fromDomain` mapper as `/steps`. The parity spec deep-equals the two reads on a multi-root, branched pipeline.

### Phase 2: Code Review — FAIL
Gates I ran myself in WORKTREE_PATH:
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `helio-mcp` `npm run typecheck`: clean.
- Root `jest`, run as `nice -n 19 npx jest --maxWorkers=2`: 61 suites, 524 tests passed. The 4 new or changed MCP suites ran and passed (71 tests).
- `check:scala-quality`: clean (soft warnings only).
- `check:schemas`: clean.
- `check:no-credential-leak`: 0 violations.
- `cd backend && sbt testFull`, under the sbtfull.lock flock, `nice -n 19`, `-Xmx3g`: **8156 succeeded, 0 failed**, 4 canceled (the existing HELIO_MEASURE report-only specs). `PipelineContextDetailsRoutesSpec` ran all 6 tests green. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1619/eval-sbt-testFull.log`.
- The frontend `npm --prefix frontend` test and build were not triggered: no `frontend/**` change.

Proxy-based limiter (asked specifically):
- `limitApi(unlimitedApi, createLimiter(6))` builds a new Proxy inside each `buildWorkspaceContext` call, around the api argument only. No other `HelioApi` instance, tool or caller (`server.ts:92`, `tools/read.ts:350`, or any write tool) sees it.
- Methods run with `this = target`, so composite methods (`getPipeline`, paginated `listAllOutputs`) hold one slot and never re-enter the limiter.
- Every `api.*` method `context.ts` and `contextControls.ts` call is async (14 call sites checked), so wrapping in a Promise changes no return type.
- Slots are acquired per leaf call, never held across an await on another limited call, so the deduped snapshot cannot deadlock. A unit test covers this at cap 1.

Fixture hook (asked specifically): `TwoUserRlsApiFixture.pipelineRunRepoFor` defaults to `null`, which is the previous wiring. Every other subclass is untouched, and the full suite is green.

Issues:
1. `helio-mcp/src/types.ts:514-523`: the new `PipelineContextDetailsItemResponse` and `PipelineContextDetailsResponse` were inserted between the existing JSDoc for `AssertionSummaryResponse` ("Per-run pass/fail-by-severity assertion summary ... never omitted.", lines 514-518) and the interface it documents. That doc block is now orphaned: it sits directly above another JSDoc, and `AssertionSummaryResponse` (now line 534) has no doc. This is a misattached-documentation defect (CONTRIBUTING "Comments": a comment is the one part the compiler never checks).
2. `helio-mcp/scripts/contextDetailsLiveProbe.ts:44-45`: the probe mints a real bootstrap PAT (`mintBootstrapPat`, 1-day expiry) and never revokes it. `revokePat` already exists in `scripts/isolatedAuth.ts:54` and is not called. CONTRIBUTING "Credential handling in delivery evidence (HEL-846)", obligation 2, is mandatory: "the same credential is revoked once the verification run is finished". As committed, every run of the probe (including the executor's two recorded runs) leaves a live PAT behind.

### Phase 3: UI Review — PASS
Triggered by `schemas/**`; no `frontend/**` file changed.
- I started servers with `start-servers.sh` on ports 7051/9958 (`READY`, `assert-phase.sh servers` PASS) and stopped them with `stop-servers.sh`.
- Live, unauthenticated: `GET /api/pipelines/context-details` returns 401, the same as `GET /api/pipelines`. This shows the literal path is not swallowed as a pipeline id, which would have been a 404 or other path, and auth parity holds.
- The app shell loads at `/`. The only console errors were the two 401s from my own probe fetches.
- Breakpoint and interaction checks are N/A: no UI surface changed.
- I did not re-run the authenticated live probe. This worktree's `backend/.env` points at the shared dev DB `helio`, and the probe registers a user and seeds 12 pipelines, which would leave residue there. The executor's probe ran against the isolated `helio_hel1619`. Instead, I rely on its recorded transcript plus my own fresh run of the full-route-tree spec (`PipelineContextDetailsRoutesSpec`) and the schema seam tests.

### Overall: FAIL

### Change Requests
1. `helio-mcp/src/types.ts`: move the new `PipelineContextDetailsItemResponse` and `PipelineContextDetailsResponse` declarations, with their own JSDoc, so they no longer split `AssertionSummaryResponse` from its doc. For example, place them after the closing `}` of `AssertionSummaryResponse`. The "Per-run pass/fail-by-severity assertion summary ..." block must sit directly above `export interface AssertionSummaryResponse` again.
2. `helio-mcp/scripts/contextDetailsLiveProbe.ts`: revoke the minted PAT when the run ends, whether it passes or fails. Wrap the body after `mintBootstrapPat` in `try { ... } finally { ... }`, call `revokePat(baseUrl, { email, userId, cookie, patId: pat.id, pat: pat.token })` from `./isolatedAuth.js` (`register` already returns `userId`), and fail the probe (`process.exitCode = 1`, print the message) if `revokePat` returns a non-null error. Also confirm that the PAT(s) left by the executor's recorded runs in `helio_hel1619` are revoked, or note in measurements.md that the DB holding them is isolated and will be dropped.

### Non-blocking Suggestions
- Tie determinism (old behavior, not a regression): neither `listByPipelineInternal` nor `latestRunIdsInternalBatch` has a secondary sort key for equal `started_at`. Neither assertion read has an ORDER BY, so `failures[]` order follows heap order on both paths. Consider a follow-up that adds `id` as a tie-break to both reads together. Changing only one side would break parity.
- `helio-mcp/src/context.ts:245` adds a `// ── ... ──` section divider in a 735-line file. CONTRIBUTING reserves dividers for files of about 1,000+ lines. It matches the four existing dividers there, so this is noted only.
- D8 said the fixed fetches sit outside the limiter. The implementation routes all of them through it, so peak is ≤6 including the fixed group. This is stricter than designed and documented in the README and `MAX_IN_FLIGHT`. Fine.
- Environment notes for the orchestrator:
  - The executor symlinked the worktree root `node_modules` to `/home/matt/Development/helio/node_modules`. `helio-mcp/node_modules` is a real directory.
  - The isolated DB `helio_hel1619` is still present. It was not dropped, per instructions.
  - My golden-regeneration scratch copy is at `/home/matt/Development/helio/.concertino/scratch/HEL-1619/eval-golden/`.
